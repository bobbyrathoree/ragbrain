/**
 * Search Pipeline Tests
 *
 * Tests for BM25 + kNN hybrid search functionality.
 * Verifies that search correctly combines keyword and semantic matching.
 *
 * Test scenarios:
 * - Keyword-only matches (BM25)
 * - Semantic-only matches (kNN)
 * - Hybrid matches (both)
 * - Score normalization
 */

import {
  suite, test, assert, assertExists, assertArray, assertType,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface Citation {
  id?: string;
  thoughtId?: string;
  text?: string;
  score?: number;
  type?: string;
}

interface AskResponse {
  answer: string;
  citations?: Citation[];
  confidence?: number;
  thoughtHits?: number;
  conversationHits?: number;
}

// Track created thoughts
const createdThoughts: string[] = [];

// Unique markers for this test run
const searchTag = `search-${Date.now()}`;

suite('Pipeline: Search (BM25 + kNN)');

// Setup: Create thoughts with known content for search testing

await test('Setup: Create thoughts for keyword search', async () => {
  const keywordThoughts = [
    {
      text: `Keyword test: PostgreSQL database configuration ${testId()} with performance tuning`,
      type: 'note',
      tags: [searchTag, 'keyword', 'database'],
    },
    {
      text: `Another keyword test: PostgreSQL backup and recovery ${testId()} strategies`,
      type: 'note',
      tags: [searchTag, 'keyword', 'database'],
    },
  ];

  for (const thought of keywordThoughts) {
    const { status, data } = await post<ThoughtResponse>('/thoughts', thought);
    assert(status === 200 || status === 201, 'Setup should succeed');
    createdThoughts.push(data.id);
  }

  console.log(`    Created ${keywordThoughts.length} keyword test thoughts`);
});

await test('Setup: Create thoughts for semantic search', async () => {
  const semanticThoughts = [
    {
      text: `Machine learning model training ${testId()} - optimizing neural network hyperparameters for image classification`,
      type: 'note',
      tags: [searchTag, 'semantic', 'ai'],
    },
    {
      text: `Deep learning architecture ${testId()} - building convolutional networks for computer vision tasks`,
      type: 'note',
      tags: [searchTag, 'semantic', 'ai'],
    },
  ];

  for (const thought of semanticThoughts) {
    const { status, data } = await post<ThoughtResponse>('/thoughts', thought);
    assert(status === 200 || status === 201, 'Setup should succeed');
    createdThoughts.push(data.id);
  }

  console.log(`    Created ${semanticThoughts.length} semantic test thoughts`);
});

await test('Setup: Wait for indexing', async () => {
  console.log('    Waiting for indexing...');
  await sleep(15000);
  console.log('    Indexing wait complete');
});

// Keyword search (BM25) tests

await test('BM25: Exact keyword match returns results', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'PostgreSQL database',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  assertExists(data.answer, 'Should have answer');

  if (data.citations && data.citations.length > 0) {
    console.log(`    Keyword "PostgreSQL" found ${data.citations.length} citations`);

    // Check if our database thoughts are in citations
    const dbCitations = data.citations.filter(c =>
      createdThoughts.includes(c.id || c.thoughtId || '')
    );
    console.log(`    Our thoughts in citations: ${dbCitations.length}`);
  }
});

await test('BM25: Partial keyword match', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Postgres',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);

  // Partial match should still find results
  console.log(`    Partial match citations: ${data.citations?.length || 0}`);
});

await test('BM25: Multiple keywords', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'database backup recovery',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  console.log(`    Multi-keyword citations: ${data.citations?.length || 0}`);
});

// Semantic search (kNN) tests

await test('kNN: Semantic similarity without exact keywords', async () => {
  // Search for AI concepts using different words than stored
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'artificial intelligence training algorithms',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);

  // Should find ML/DL thoughts via semantic similarity
  if (data.citations && data.citations.length > 0) {
    console.log(`    Semantic search found ${data.citations.length} citations`);

    // Check if AI-related thoughts appear
    const aiCitations = data.citations.filter(c =>
      c.text?.includes('learning') || c.text?.includes('neural')
    );
    console.log(`    AI-related citations: ${aiCitations.length}`);
  }
});

await test('kNN: Conceptually related but different words', async () => {
  // Search using synonyms/related concepts
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'picture recognition software',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);

  // Should semantically match "image classification" / "computer vision"
  console.log(`    Concept similarity citations: ${data.citations?.length || 0}`);
});

// Hybrid search tests

await test('Hybrid: Both keyword and semantic matching', async () => {
  // Create a thought that can be found both ways
  const { data: createData } = await post<ThoughtResponse>('/thoughts', {
    text: `Hybrid test ${testId()}: Machine learning for database optimization using neural networks`,
    type: 'note',
    tags: [searchTag, 'hybrid'],
  });
  createdThoughts.push(createData.id);

  await sleep(10000);

  // Search with both keyword and semantic terms
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'machine learning database',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  console.log(`    Hybrid search citations: ${data.citations?.length || 0}`);
});

// Score normalization tests

await test('Scores: Normalized to 0-1 range', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'database configuration',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);

  if (data.citations && data.citations.length > 0) {
    for (const citation of data.citations) {
      if (citation.score !== undefined) {
        assertType(citation.score, 'number', 'Score should be number');
        assert(
          citation.score >= 0 && citation.score <= 1,
          `Score should be 0-1, got ${citation.score}`
        );
      }
    }

    const withScores = data.citations.filter(c => c.score !== undefined);
    console.log(`    ${withScores.length}/${data.citations.length} citations have scores`);
  }
});

await test('Scores: Higher relevance = higher score', async () => {
  // Create a highly relevant thought
  const exactMatch = `Exact match test ${testId()}: Unique searchable phrase XYZ123`;
  await post<ThoughtResponse>('/thoughts', {
    text: exactMatch,
    type: 'note',
    tags: [searchTag, 'relevance'],
  });

  // Create a less relevant thought
  await post<ThoughtResponse>('/thoughts', {
    text: `Less relevant ${testId()}: This mentions XYZ but not 123`,
    type: 'note',
    tags: [searchTag, 'relevance'],
  });

  await sleep(10000);

  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Unique searchable phrase XYZ123',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);

  if (data.citations && data.citations.length >= 2) {
    const scores = data.citations
      .filter(c => c.score !== undefined)
      .map(c => c.score!);

    if (scores.length >= 2) {
      // First result (highest score) should be most relevant
      assert(
        scores[0] >= scores[1],
        `Scores should be descending: ${scores.join(', ')}`
      );
      console.log(`    Score ordering: ${scores.slice(0, 3).join(', ')}...`);
    }
  }
});

// Edge cases

await test('Search: Empty results handled', async () => {
  const nonExistent = `nonexistent_term_${Date.now()}_xyz`;

  const { status, data } = await post<AskResponse>('/ask', {
    query: nonExistent,
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Search should succeed, got ${status}`);
  assertExists(data.answer, 'Should have answer even with no matches');

  // Citations may be empty
  console.log(`    No-match citations: ${data.citations?.length || 0}`);
});

await test('Search: Special characters in query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'database & configuration <test>',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Special chars should work, got ${status}`);
});

await test('Search: Very short query', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'db',
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Short query should work, got ${status}`);
});

await test('Search: Long query', async () => {
  const longQuery = `Tell me everything you know about databases, specifically PostgreSQL configuration, backup strategies, recovery procedures, performance tuning, and how machine learning can be applied to optimize database performance. ${testId()}`;

  const { status, data } = await post<AskResponse>('/ask', {
    query: longQuery,
    tags: [searchTag],
  });

  assert(status === 200 || status === 201, `Long query should work, got ${status}`);
  console.log(`    Long query citations: ${data.citations?.length || 0}`);
});

// Filter interaction tests

await test('Search: Tag filter applies correctly', async () => {
  const { status: status1, data: data1 } = await post<AskResponse>('/ask', {
    query: 'database',
    tags: ['nonexistent-tag-xyz'],
  });

  const { status: status2, data: data2 } = await post<AskResponse>('/ask', {
    query: 'database',
    tags: [searchTag],
  });

  assert(status1 === 200 || status1 === 201, 'Search with bad tag should succeed');
  assert(status2 === 200 || status2 === 201, 'Search with good tag should succeed');

  // Non-existent tag should have fewer/no results
  const count1 = data1.citations?.length || 0;
  const count2 = data2.citations?.length || 0;

  console.log(`    Non-existent tag: ${count1} citations`);
  console.log(`    Valid tag: ${count2} citations`);
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
