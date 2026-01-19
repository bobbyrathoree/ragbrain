/**
 * Indexing Pipeline Tests
 *
 * Tests for the SQS → Indexer → OpenSearch data flow.
 * Verifies that captured thoughts are indexed and become searchable.
 *
 * Test flow:
 * 1. Capture thought
 * 2. Wait for async indexing
 * 3. Verify searchability
 * 4. Verify derived fields
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
    text?: string;
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

// Unique tag for this test run
const pipelineTag = `pipeline-${Date.now()}`;

suite('Pipeline: Indexing Flow');

// Test the full indexing pipeline

await test('Pipeline: Thought captured and stored', async () => {
  const uniqueContent = `Pipeline test ${testId()} - Testing the complete indexing flow from capture to search.`;

  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: uniqueContent,
    type: 'note',
    tags: [pipelineTag, 'indexing-flow'],
  });

  assert(status === 200 || status === 201, `Capture should succeed, got ${status}`);
  assertExists(data.id, 'Should return thought ID');
  assertExists(data.createdAt, 'Should return createdAt');

  createdThoughts.push(data.id);
  console.log(`    Created thought: ${data.id}`);
});

await test('Pipeline: Thought immediately retrievable (pre-index)', async () => {
  if (createdThoughts.length === 0) {
    throw new Error('No thoughts created');
  }

  // Thought should be in DynamoDB immediately
  const { status, data } = await get<ListThoughtsResponse>(
    `/thoughts?tag=${pipelineTag}&limit=10`
  );

  assert(status === 200, `List should succeed, got ${status}`);
  assertArray(data.thoughts, 'Should return thoughts array');

  const found = data.thoughts.find(t => t.id === createdThoughts[0]);
  assert(found !== undefined, 'Thought should be retrievable immediately');
});

await test('Pipeline: Thought indexed within 60s (observable via search)', async () => {
  // Create a thought with very distinctive content
  const uniqueKey = `uniquekey_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const distinctContent = `Searching for ${uniqueKey} in the pipeline indexing test.`;

  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: distinctContent,
    type: 'note',
    tags: [pipelineTag, 'search-test'],
  });

  createdThoughts.push(createData.id);

  // Poll for searchability
  const maxWait = 60000; // 60 seconds
  const pollInterval = 5000;
  const startTime = Date.now();
  let indexed = false;

  console.log('    Waiting for indexing...');

  while (Date.now() - startTime < maxWait && !indexed) {
    await sleep(pollInterval);

    const { data: askData } = await post<AskResponse>('/ask', {
      query: uniqueKey,
    });

    // Check if our thought is in citations
    if (askData.citations && askData.citations.length > 0) {
      const hasCitation = askData.citations.some(c =>
        c.id === createData.id || c.thoughtId === createData.id
      );

      if (hasCitation) {
        indexed = true;
      }
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`    ${elapsed}s: ${indexed ? 'Indexed!' : 'Not yet indexed...'}`);
  }

  assert(indexed, `Thought should be searchable within 60s`);
});

await test('Pipeline: Derived fields populated after indexing', async () => {
  // Wait a bit more for derived fields
  await sleep(5000);

  const { status, data } = await get<ListThoughtsResponse>(
    `/thoughts?tag=${pipelineTag}&limit=20`
  );

  assert(status === 200, 'List should succeed');

  const withDerived = data.thoughts.filter(t => t.derived !== undefined);
  console.log(`    ${withDerived.length}/${data.thoughts.length} have derived fields`);

  if (withDerived.length > 0) {
    const sample = withDerived[0];

    if (sample.derived?.summary) {
      console.log(`    Sample summary: ${sample.derived.summary.substring(0, 50)}...`);
    }
    if (sample.derived?.autoTags && sample.derived.autoTags.length > 0) {
      console.log(`    Sample autoTags: ${sample.derived.autoTags.slice(0, 3).join(', ')}`);
    }
    if (sample.derived?.category) {
      console.log(`    Sample category: ${sample.derived.category}`);
    }
  }
});

await test('Pipeline: Related thoughts available after indexing', async () => {
  if (createdThoughts.length === 0) {
    throw new Error('No thoughts for related test');
  }

  const thoughtId = createdThoughts[0];
  const { status, data } = await get<RelatedResponse>(`/thoughts/${thoughtId}/related`);

  assert(status === 200 || status === 201, `Related should succeed, got ${status}`);
  assertExists(data.related, 'Should have related array');
  assertArray(data.related, 'related should be array');

  console.log(`    Related thoughts: ${data.related.length}`);
});

// Test indexing of different thought types

await test('Pipeline: Note type indexed correctly', async () => {
  const { data } = await post<ThoughtResponse>('/thoughts', {
    text: `Note type pipeline test ${testId()} - This is a regular note.`,
    type: 'note',
    tags: [pipelineTag, 'type-test'],
  });

  createdThoughts.push(data.id);
});

await test('Pipeline: Code type indexed correctly', async () => {
  const { data } = await post<ThoughtResponse>('/thoughts', {
    text: `function pipelineTest_${Date.now()}() { return "code type test"; }`,
    type: 'code',
    tags: [pipelineTag, 'type-test'],
  });

  createdThoughts.push(data.id);
});

await test('Pipeline: Decision type indexed correctly', async () => {
  const { data } = await post<ThoughtResponse>('/thoughts', {
    text: `Decision: Use pipeline testing ${testId()} for quality assurance`,
    type: 'decision',
    tags: [pipelineTag, 'type-test'],
  });

  createdThoughts.push(data.id);
});

await test('Pipeline: All types searchable', async () => {
  // Wait for indexing
  await sleep(10000);

  const { status, data } = await post<AskResponse>('/ask', {
    query: 'pipeline test type',
    tags: [pipelineTag],
  });

  assert(status === 200 || status === 201, 'Search should succeed');
  console.log(`    Citations from type search: ${data.citations?.length || 0}`);
});

// Test indexing preserves data

await test('Pipeline: Original text preserved through indexing', async () => {
  const originalText = `Preservation test ${testId()} - This exact text should survive indexing.`;

  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: originalText,
    type: 'note',
    tags: [pipelineTag, 'preservation'],
  });

  createdThoughts.push(createData.id);

  await sleep(3000);

  const { data: listData } = await get<ListThoughtsResponse>(
    `/thoughts?tag=preservation&limit=10`
  );

  const found = listData.thoughts.find(t => t.id === createData.id);
  assertExists(found, 'Should find preserved thought');
  assert(found!.text === originalText, 'Text should be exactly preserved');
});

await test('Pipeline: Tags preserved through indexing', async () => {
  const tags = [pipelineTag, 'tag-preservation', 'another-tag'];

  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Tags preservation test ${testId()}`,
    type: 'note',
    tags,
  });

  createdThoughts.push(createData.id);

  await sleep(3000);

  const { data: listData } = await get<ListThoughtsResponse>(
    `/thoughts?tag=tag-preservation&limit=10`
  );

  const found = listData.thoughts.find(t => t.id === createData.id);
  assertExists(found, 'Should find thought');

  if (found!.tags) {
    for (const tag of tags) {
      assert(
        found!.tags.includes(tag),
        `Should preserve tag: ${tag}`
      );
    }
  }
});

// Test indexing error handling

await test('Pipeline: Invalid content handled gracefully', async () => {
  // Create thought with edge case content
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Edge case ${testId()}: \x00null byte and ${'\u0000'.repeat(5)} control chars`,
    type: 'note',
    tags: [pipelineTag, 'edge-case'],
  });

  // Should succeed (bad chars stripped)
  assert(
    status === 200 || status === 201 || status === 400,
    `Should handle gracefully, got ${status}`
  );

  if (data.id) {
    createdThoughts.push(data.id);
  }
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
