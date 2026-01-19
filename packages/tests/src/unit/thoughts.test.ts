/**
 * Thoughts Lambda Unit Tests
 *
 * Tests for GET /thoughts endpoint logic validation.
 * Verifies query parameters, filtering, pagination, and response structure.
 */

import {
  suite, test, assert, assertExists, assertArray, assertType,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ThoughtItem {
  id: string;
  text: string;
  type: string;
  tags?: string[];
  createdAt: string;
  derived?: {
    summary?: string;
    autoTags?: string[];
  };
}

interface ListThoughtsResponse {
  thoughts: ThoughtItem[];
  cursor?: string;
  hasMore?: boolean;
  count?: number;
}

// Create test data
const testTag = `unit-thoughts-${Date.now()}`;
const createdThoughts: string[] = [];

suite('Unit: Thoughts Lambda');

// Setup: Create test data
await test('Setup: Create test thoughts for filtering', async () => {
  const testData = [
    { text: `Unit test note 1 ${testId()}`, type: 'note', tags: [testTag, 'first'] },
    { text: `Unit test code ${testId()}`, type: 'code', tags: [testTag, 'programming'] },
    { text: `Unit test decision ${testId()}`, type: 'decision', tags: [testTag] },
  ];

  for (const thought of testData) {
    const { status, data } = await post<ThoughtResponse>('/thoughts', thought);
    assert(status === 200 || status === 201, `Setup thought creation should succeed`);
    if (data.id) {
      createdThoughts.push(data.id);
    }
    await sleep(100);
  }

  // Wait for indexing
  await sleep(2000);
  console.log(`    Created ${createdThoughts.length} test thoughts`);
});

// Query parameter tests

await test('Query: Default limit applied', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts');

  assert(status === 200, `Expected 200, got ${status}`);
  assertExists(data.thoughts, 'Should have thoughts array');
  assertArray(data.thoughts, 'thoughts should be array');

  // Default limit should be reasonable (not unbounded)
  assert(
    data.thoughts.length <= 100,
    `Default limit should be bounded, got ${data.thoughts.length}`
  );
});

await test('Query: Limit parameter works', async () => {
  const limits = [1, 5, 10];

  for (const limit of limits) {
    const { status, data } = await get<ListThoughtsResponse>(`/thoughts?limit=${limit}`);

    assert(status === 200, `Expected 200 for limit=${limit}`);
    assert(
      data.thoughts.length <= limit,
      `Should return at most ${limit} thoughts, got ${data.thoughts.length}`
    );
  }
});

await test('Query: Invalid limit handled', async () => {
  const invalidLimits = ['abc', '-1', '0', '1000000'];

  for (const limit of invalidLimits) {
    const { status } = await get(`/thoughts?limit=${limit}`);

    // Should either use default or return error
    assert(
      status === 200 || status === 400,
      `Invalid limit "${limit}" should be handled, got ${status}`
    );
  }
});

// Filtering tests

await test('Filter: By type parameter', async () => {
  const { status, data } = await get<ListThoughtsResponse>(`/thoughts?type=note&limit=20`);

  assert(status === 200, `Expected 200, got ${status}`);

  // All returned thoughts should be notes
  for (const thought of data.thoughts) {
    assert(
      thought.type === 'note',
      `Filtered by type=note should only return notes, got ${thought.type}`
    );
  }
});

await test('Filter: By tag parameter', async () => {
  const { status, data } = await get<ListThoughtsResponse>(`/thoughts?tag=${testTag}&limit=20`);

  assert(status === 200, `Expected 200, got ${status}`);

  // Should find our test thoughts
  console.log(`    Found ${data.thoughts.length} thoughts with tag "${testTag}"`);
});

await test('Filter: Combined type and tag', async () => {
  const { status, data } = await get<ListThoughtsResponse>(
    `/thoughts?type=note&tag=${testTag}&limit=20`
  );

  assert(status === 200, `Expected 200, got ${status}`);

  // All should be notes with our tag
  for (const thought of data.thoughts) {
    assert(thought.type === 'note', 'Should only return notes');
  }
});

await test('Filter: Non-existent tag returns empty', async () => {
  const nonExistentTag = `nonexistent-${Date.now()}-xyz`;
  const { status, data } = await get<ListThoughtsResponse>(`/thoughts?tag=${nonExistentTag}`);

  assert(status === 200, `Expected 200, got ${status}`);
  assertArray(data.thoughts, 'Should return array');
  assert(
    data.thoughts.length === 0,
    `Non-existent tag should return empty array, got ${data.thoughts.length}`
  );
});

// Pagination tests

await test('Pagination: Cursor is returned when hasMore', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=2');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.hasMore === true) {
    assertExists(data.cursor, 'Should have cursor when hasMore is true');
    assertType(data.cursor, 'string', 'Cursor should be string');
  }
});

await test('Pagination: Second page with cursor', async () => {
  // Get first page
  const { status: status1, data: data1 } = await get<ListThoughtsResponse>('/thoughts?limit=2');
  assert(status1 === 200, 'First page should succeed');

  if (data1.cursor && data1.hasMore) {
    // Get second page
    const { status: status2, data: data2 } = await get<ListThoughtsResponse>(
      `/thoughts?limit=2&cursor=${encodeURIComponent(data1.cursor)}`
    );

    assert(status2 === 200, 'Second page should succeed');
    assertArray(data2.thoughts, 'Second page should have thoughts');

    // Pages should be different
    if (data1.thoughts.length > 0 && data2.thoughts.length > 0) {
      assert(
        data1.thoughts[0].id !== data2.thoughts[0].id,
        'Pages should have different thoughts'
      );
    }
  } else {
    console.log('    Note: Not enough data for pagination test');
  }
});

await test('Pagination: Invalid cursor handled', async () => {
  const { status } = await get('/thoughts?cursor=invalid-cursor-value');

  // Should either ignore invalid cursor or return error
  assert(
    status === 200 || status === 400,
    `Invalid cursor should be handled, got ${status}`
  );
});

// Response structure tests

await test('Response: Thought item structure', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=1');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.thoughts.length > 0) {
    const thought = data.thoughts[0];

    // Required fields
    assertExists(thought.id, 'Thought should have id');
    assertExists(thought.text, 'Thought should have text');
    assertExists(thought.type, 'Thought should have type');
    assertExists(thought.createdAt, 'Thought should have createdAt');

    // Type checks
    assertType(thought.id, 'string', 'id should be string');
    assertType(thought.text, 'string', 'text should be string');
    assertType(thought.type, 'string', 'type should be string');

    // ID format
    assert(
      thought.id.startsWith('t_'),
      `ID should start with t_, got ${thought.id}`
    );
  }
});

await test('Response: Tags are array if present', async () => {
  const { status, data } = await get<ListThoughtsResponse>(`/thoughts?tag=${testTag}&limit=5`);

  assert(status === 200, `Expected 200, got ${status}`);

  for (const thought of data.thoughts) {
    if (thought.tags !== undefined) {
      assertArray(thought.tags, 'Tags should be array');
    }
  }
});

await test('Response: Derived fields structure', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=10');

  assert(status === 200, `Expected 200, got ${status}`);

  // Check if any thoughts have derived fields
  const withDerived = data.thoughts.filter(t => t.derived);

  if (withDerived.length > 0) {
    console.log(`    ${withDerived.length}/${data.thoughts.length} have derived fields`);

    for (const thought of withDerived) {
      if (thought.derived?.summary) {
        assertType(thought.derived.summary, 'string', 'Summary should be string');
      }
      if (thought.derived?.autoTags) {
        assertArray(thought.derived.autoTags, 'autoTags should be array');
      }
    }
  } else {
    console.log('    Note: No thoughts with derived fields (may not be indexed yet)');
  }
});

// Ordering tests

await test('Response: Thoughts ordered by createdAt desc', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=10');

  assert(status === 200, `Expected 200, got ${status}`);

  // Check ordering
  for (let i = 1; i < data.thoughts.length; i++) {
    const prevTime = new Date(data.thoughts[i - 1].createdAt).getTime();
    const currTime = new Date(data.thoughts[i].createdAt).getTime();

    // Most recent should be first (descending)
    assert(
      prevTime >= currTime,
      `Thoughts should be ordered by createdAt desc`
    );
  }
});

// Edge cases

await test('Edge: URL-encoded tag', async () => {
  const specialTag = 'test tag with spaces';
  const encodedTag = encodeURIComponent(specialTag);

  const { status } = await get(`/thoughts?tag=${encodedTag}`);

  // Should handle URL-encoded parameters
  assert(status === 200, `URL-encoded tag should work, got ${status}`);
});

await test('Edge: Multiple parameters', async () => {
  const { status, data } = await get<ListThoughtsResponse>(
    `/thoughts?limit=5&type=note&tag=${testTag}`
  );

  assert(status === 200, `Multiple params should work, got ${status}`);
  assert(data.thoughts.length <= 5, 'Limit should be respected');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
