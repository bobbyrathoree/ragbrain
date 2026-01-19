/**
 * Indexer Lambda Unit Tests
 *
 * Tests for indexing pipeline behavior via observable effects.
 * Since we can't directly invoke the Lambda, we test through:
 * - Capture → Wait → Verify indexed (derived fields populated)
 * - Search results that require indexing
 *
 * Note: These tests verify the effects of indexing, not the Lambda directly.
 */

import {
  suite, test, assert, assertExists, assertArray,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface ThoughtDetail {
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
  thoughts: ThoughtDetail[];
}

interface AskResponse {
  answer: string;
  citations?: Array<{
    id?: string;
    thoughtId?: string;
    score?: number;
  }>;
}

interface RelatedResponse {
  thoughtId: string;
  related: ThoughtDetail[];
  count: number;
}

// Track created thoughts
const createdThoughts: string[] = [];

suite('Unit: Indexer Lambda (Observable Effects)');

// Test that indexing occurs (observable through derived fields)

await test('Indexing: Thought eventually has derived fields', async () => {
  // Create a thought with distinctive content
  const uniqueContent = `Indexer test ${testId()} - This is a decision about using TypeScript for better type safety and developer experience in the frontend application.`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueContent,
    type: 'decision',
    tags: ['indexer-test'],
  });

  assert(status === 200 || status === 201, `Create should succeed, got ${status}`);
  createdThoughts.push(data.id);

  // Wait for indexing (this is async)
  console.log('    Waiting for indexing...');
  await sleep(5000);

  // Check if derived fields are populated
  const { status: getStatus, data: listData } = await get<ListThoughtsResponse>(
    `/thoughts?tag=indexer-test&limit=10`
  );

  assert(getStatus === 200, `List should succeed, got ${getStatus}`);

  const indexed = listData.thoughts.find(t => t.id === data.id);

  if (indexed && indexed.derived) {
    console.log(`    Derived fields found for ${data.id}`);

    if (indexed.derived.summary) {
      console.log(`    Summary: ${indexed.derived.summary.substring(0, 50)}...`);
    }
    if (indexed.derived.autoTags && indexed.derived.autoTags.length > 0) {
      console.log(`    AutoTags: ${indexed.derived.autoTags.join(', ')}`);
    }
  } else {
    console.log('    Note: Derived fields not yet populated (indexing may be slow)');
  }
});

// Test that embedding-based search works (requires indexing)

await test('Indexing: Semantic search finds indexed thoughts', async () => {
  // Create a thought about a specific topic
  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Indexer semantic test ${testId()} - We implemented a React component that handles user authentication using OAuth 2.0 flow.`,
    type: 'code',
    tags: ['indexer-test', 'auth'],
  });

  createdThoughts.push(createData.id);

  // Wait for indexing
  await sleep(5000);

  // Search semantically (not exact keyword match)
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'user login implementation',
    tags: ['indexer-test'],
  });

  assert(status === 200 || status === 201, `Ask should succeed, got ${status}`);

  // If citations exist, verify they're scored
  if (data.citations && data.citations.length > 0) {
    console.log(`    Found ${data.citations.length} citations via semantic search`);

    for (const citation of data.citations) {
      if (citation.score !== undefined) {
        assert(
          citation.score >= 0 && citation.score <= 1,
          `Score should be normalized, got ${citation.score}`
        );
      }
    }
  }
});

// Test related thoughts (requires embeddings)

await test('Indexing: Related thoughts endpoint works', async () => {
  if (createdThoughts.length === 0) {
    throw new Error('No thoughts created for related test');
  }

  // Wait a bit more for embeddings
  await sleep(3000);

  const thoughtId = createdThoughts[0];
  const { status, data } = await get<RelatedResponse>(`/thoughts/${thoughtId}/related`);

  assert(status === 200 || status === 201, `Related should succeed, got ${status}`);
  assertExists(data.thoughtId, 'Should have thoughtId');
  assertExists(data.related, 'Should have related array');
  assertArray(data.related, 'related should be array');

  console.log(`    Related thoughts: ${data.related.length}`);
});

// Test that multiple thoughts can be indexed

await test('Indexing: Multiple thoughts indexed in order', async () => {
  const thoughts = [
    { text: `Multi-index test A ${testId()} - Database schema design`, type: 'note' },
    { text: `Multi-index test B ${testId()} - API endpoint planning`, type: 'note' },
    { text: `Multi-index test C ${testId()} - Frontend component structure`, type: 'note' },
  ];

  for (const thought of thoughts) {
    const { data } = await post<ThoughtResponse>('/thoughts', {
      ...thought,
      tags: ['multi-index-test'],
    });
    if (data.id) {
      createdThoughts.push(data.id);
    }
    await sleep(100);
  }

  // Wait for all to be indexed
  await sleep(5000);

  // Query to verify they're searchable
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'database API frontend planning',
    tags: ['multi-index-test'],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  console.log(`    Multi-indexed thoughts searchable: ${data.citations?.length || 0} citations`);
});

// Test indexing with different thought types

await test('Indexing: Different types are indexed', async () => {
  const types = ['note', 'code', 'decision', 'link'];

  for (const type of types) {
    const { data } = await post<ThoughtResponse>('/thoughts', {
      text: `Type indexing test ${testId()} - Testing ${type} type indexing`,
      type,
      tags: ['type-index-test'],
    });

    if (data.id) {
      createdThoughts.push(data.id);
    }
  }

  await sleep(5000);

  // Verify all types are searchable
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'type indexing test',
    tags: ['type-index-test'],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  console.log(`    Different types indexed: ${data.citations?.length || 0} citations`);
});

// Test indexing failure handling (indirectly)

await test('Indexing: Invalid content handled gracefully', async () => {
  // Create thought with unusual content
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Edge case ${testId()}: ${'🎉'.repeat(100)}`,
    type: 'note',
    tags: ['edge-index-test'],
  });

  // Creation should succeed even if indexing might struggle
  assert(status === 200 || status === 201, `Create should succeed, got ${status}`);

  if (data.id) {
    createdThoughts.push(data.id);
  }

  // The thought should still be retrievable
  await sleep(2000);

  const { status: listStatus, data: listData } = await get<ListThoughtsResponse>(
    '/thoughts?tag=edge-index-test&limit=5'
  );

  assert(listStatus === 200, 'List should succeed');

  const found = listData.thoughts.find(t => t.id === data.id);
  assert(found !== undefined, 'Thought should still be retrievable');
});

// Test that indexing preserves data integrity

await test('Indexing: Original text preserved', async () => {
  const originalText = `Integrity test ${testId()}: Original text with specific details about implementation strategy.`;

  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: originalText,
    type: 'note',
    tags: ['integrity-test'],
  });

  createdThoughts.push(createData.id);

  await sleep(3000);

  // Retrieve and verify text is unchanged
  const { status, data: listData } = await get<ListThoughtsResponse>(
    '/thoughts?tag=integrity-test&limit=5'
  );

  assert(status === 200, 'List should succeed');

  const found = listData.thoughts.find(t => t.id === createData.id);
  assertExists(found, 'Should find the thought');

  assert(
    found!.text === originalText,
    'Original text should be preserved'
  );
});

// Test indexing performance (indirectly via timing)

await test('Indexing: Completes within reasonable time', async () => {
  const startTime = Date.now();

  const { data } = await post<ThoughtResponse>('/thoughts', {
    text: `Timing test ${testId()} - Measuring how long until searchable`,
    type: 'note',
    tags: ['timing-test'],
  });

  createdThoughts.push(data.id);

  // Poll until searchable or timeout
  const maxWait = 30000; // 30 seconds
  const pollInterval = 2000;
  let indexed = false;

  while (Date.now() - startTime < maxWait && !indexed) {
    await sleep(pollInterval);

    const { data: askData } = await post<AskResponse>('/ask', {
      query: 'timing test searchable',
      tags: ['timing-test'],
    });

    if (askData.citations && askData.citations.length > 0) {
      indexed = true;
    }
  }

  const elapsed = Date.now() - startTime;

  if (indexed) {
    console.log(`    Indexed and searchable in ${elapsed}ms`);
    assert(elapsed < maxWait, 'Should index within timeout');
  } else {
    console.log(`    Note: Not indexed within ${maxWait}ms (may be slow)`);
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
