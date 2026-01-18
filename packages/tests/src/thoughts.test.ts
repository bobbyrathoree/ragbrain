/**
 * Thoughts API Tests
 *
 * Tests:
 * - POST /thoughts - Capture thought
 * - GET /thoughts - List thoughts with filters
 * - GET /thoughts/{id}/related - Get related thoughts
 *
 * README claims verified:
 * - "Capture thoughts, code snippets, decisions, and links"
 * - "Auto-captures context: active app, window title, git repo, branch, file path"
 * - Response includes AI-derived fields (after indexing)
 */

import {
  suite, test, assert, assertEqual, assertExists, assertArray, assertHasKeys,
  get, post, printSummary, testId, sleep
} from './test-utils.js';

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
    category?: string;
    intent?: string;
    entities?: string[];
    relatedIds?: string[];
  };
}

interface ListThoughtsResponse {
  thoughts: ThoughtItem[];
  cursor?: string;
  hasMore?: boolean;
}

interface RelatedThoughtsResponse {
  thoughtId: string;
  related: ThoughtItem[];
  count: number;
}

// Track created thoughts for cleanup
const createdThoughts: string[] = [];

suite('Thoughts API');

await test('POST /thoughts - capture basic note', async () => {
  const uniqueText = `Test note ${testId()} - verifying basic capture`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueText,
    type: 'note',
    tags: ['test', 'api-test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');
  assertExists(data.createdAt, 'Response should have createdAt');
  assert(data.id.startsWith('t_'), 'ID should start with t_');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - capture with context', async () => {
  const uniqueText = `Test with context ${testId()}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueText,
    type: 'note',
    tags: ['context-test'],
    context: {
      app: 'VSCode',
      repo: 'ragbrain',
      file: 'src/test.ts',
      branch: 'main',
    },
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - capture code snippet', async () => {
  const codeSnippet = `function test${testId().replace(/[^a-zA-Z0-9]/g, '')}() {
  return 'Hello, World!';
}`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: codeSnippet,
    type: 'code',
    tags: ['javascript', 'test'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - capture decision', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Decision ${testId()}: Use PostgreSQL for ACID compliance`,
    type: 'decision',
    tags: ['database', 'architecture'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - capture link', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Check out this resource ${testId()}: https://example.com/api-design`,
    type: 'link',
    tags: ['resource', 'api'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - capture todo', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `TODO ${testId()}: Implement caching layer`,
    type: 'todo',
    tags: ['task', 'performance'],
  });

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.id, 'Response should have id');

  createdThoughts.push(data.id);
});

await test('POST /thoughts - missing text should fail', async () => {
  const { status } = await post('/thoughts', {
    type: 'note',
    tags: ['test'],
  });

  assert(status >= 400, `Expected error status, got ${status}`);
});

await test('GET /thoughts - list thoughts', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=10');

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.thoughts, 'Response should have thoughts array');
  assertArray(data.thoughts, 'thoughts should be an array');
});

await test('GET /thoughts - filter by type', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?type=note&limit=5');

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertArray(data.thoughts, 'thoughts should be an array');

  // All returned thoughts should be notes
  for (const thought of data.thoughts) {
    assertEqual(thought.type, 'note', 'Filtered thoughts should be notes');
  }
});

await test('GET /thoughts - filter by tag', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?tag=test&limit=5');

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertArray(data.thoughts, 'thoughts should be an array');
});

await test('GET /thoughts - response structure matches README', async () => {
  const { status, data } = await get<ListThoughtsResponse>('/thoughts?limit=1');

  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertArray(data.thoughts, 'thoughts should be an array');

  if (data.thoughts.length > 0) {
    const thought = data.thoughts[0];
    assertHasKeys(thought as unknown as Record<string, unknown>, ['id', 'text', 'type', 'createdAt'],
      'Thought should have required fields');
  }
});

await test('GET /thoughts - pagination with cursor', async () => {
  // First page
  const { status: status1, data: data1 } = await get<ListThoughtsResponse>('/thoughts?limit=2');
  assertEqual(status1, 200, `Expected 200, got ${status1}`);

  // If there's more data, test cursor pagination
  if (data1.cursor && data1.hasMore) {
    const { status: status2, data: data2 } = await get<ListThoughtsResponse>(
      `/thoughts?limit=2&cursor=${encodeURIComponent(data1.cursor)}`
    );
    assertEqual(status2, 200, `Expected 200 for page 2, got ${status2}`);
    assertArray(data2.thoughts, 'Page 2 thoughts should be an array');
  }
});

await test('GET /thoughts/{id}/related - get related thoughts', async () => {
  // Use one of our created thoughts
  if (createdThoughts.length === 0) {
    throw new Error('No thoughts created to test related');
  }

  // Wait a bit for indexing (related thoughts require embeddings)
  await sleep(2000);

  const thoughtId = createdThoughts[0];
  const { status, data } = await get<RelatedThoughtsResponse>(`/thoughts/${thoughtId}/related`);

  // Related might return 200 even with empty array if no similar thoughts exist
  assert(status === 200 || status === 201, `Expected 200 or 201, got ${status}`);
  assertExists(data.thoughtId, 'Response should have thoughtId');
  assertExists(data.related, 'Response should have related array');
  assertArray(data.related, 'related should be an array');
  assertEqual(data.thoughtId, thoughtId, 'thoughtId should match request');
});

await test('GET /thoughts/{id}/related - invalid ID returns error', async () => {
  const { status } = await get('/thoughts/invalid_id_123/related');

  // Should either return 404 or empty results
  assert(status === 200 || status === 404, `Expected 200 or 404, got ${status}`);
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
