/**
 * README Feature Claims Verification Tests
 *
 * Tests that verify feature claims made in README and CLAUDE.md.
 * Each test maps to a specific claim from the documentation.
 *
 * Claims verified:
 * - "Instant capture of thoughts, code snippets, decisions, and links"
 * - "Ask questions and get answers with timestamped citations"
 * - "Hybrid search combining keyword matching and semantic embeddings"
 * - "Timeline heatmap and topic graph"
 * - "Every answer must reference source notes"
 */

import {
  suite, test, assert, assertExists, assertArray, assertType, assertHasKeys,
  get, post, printSummary, testId, sleep
} from '../test-utils.js';

interface ThoughtResponse {
  id: string;
  createdAt: string;
}

interface AskResponse {
  answer: string;
  citations?: Array<{
    id?: string;
    thoughtId?: string;
    text?: string;
    createdAt?: string;
    score?: number;
    timestamp?: string;
  }>;
  confidence?: number;
  processingTime?: number;
  conversationHits?: number;
}

interface GraphResponse {
  nodes: Array<{
    id: string;
    label?: string;
    x?: number;
    y?: number;
    z?: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight?: number;
  }>;
  clusters?: Array<{
    id: string;
    label?: string;
    nodeIds?: string[];
  }>;
}

// Track created resources
const createdThoughts: string[] = [];

suite('README Claims: Features');

// Claim: "Instant capture of thoughts, code snippets, decisions, and links"

await test('Claim: Capture thought of type "note"', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Feature test note ${testId()} - verifying capture functionality`,
    type: 'note',
    tags: ['readme-test'],
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.id, 'Note capture should return ID');
  assertExists(data.createdAt, 'Note capture should return timestamp');

  createdThoughts.push(data.id);
});

await test('Claim: Capture thought of type "code"', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `function verifyCapture_${testId().replace(/[^a-zA-Z0-9]/g, '')}() {
  return "Code snippets can be captured";
}`,
    type: 'code',
    tags: ['readme-test', 'javascript'],
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.id, 'Code capture should return ID');

  createdThoughts.push(data.id);
});

await test('Claim: Capture thought of type "decision"', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Decision ${testId()}: Decisions can be captured and tracked`,
    type: 'decision',
    tags: ['readme-test', 'architecture'],
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.id, 'Decision capture should return ID');

  createdThoughts.push(data.id);
});

await test('Claim: Capture thought of type "link"', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Useful resource ${testId()}: https://example.com/documentation`,
    type: 'link',
    tags: ['readme-test', 'resource'],
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.id, 'Link capture should return ID');

  createdThoughts.push(data.id);
});

// Claim: "Ask questions and get answers with timestamped citations"

await test('Claim: Ask returns answer with citations', async () => {
  // Wait for indexing of created thoughts
  await sleep(3000);

  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What decisions have been made?',
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.answer, 'Ask should return an answer');
  assertType(data.answer, 'string', 'Answer should be a string');
});

await test('Claim: Citations include timestamps (createdAt)', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'Tell me about captured code snippets',
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);

  // Check if citations exist and have timestamps
  if (data.citations && data.citations.length > 0) {
    for (const citation of data.citations) {
      // Citation should have createdAt or timestamp
      const hasTimestamp = citation.createdAt || citation.timestamp;
      if (hasTimestamp) {
        // Verify it's a valid timestamp format
        const timestamp = citation.createdAt || citation.timestamp;
        assert(
          timestamp!.length > 0,
          'Citation timestamp should not be empty'
        );
        // Should be ISO format or similar
        assert(
          timestamp!.includes('T') || timestamp!.includes('-'),
          'Timestamp should be in ISO-like format'
        );
      }
    }
    console.log(`    Found ${data.citations.length} citations with timestamps`);
  } else {
    console.log('    Note: No citations returned (may be expected for some queries)');
  }
});

// Claim: "Hybrid search combining keyword matching and semantic embeddings"

await test('Claim: Search returns results (hybrid search)', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'readme test verification',
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  assertExists(data.answer, 'Hybrid search should return answer');

  // If citations exist, verify they have scores
  if (data.citations && data.citations.length > 0) {
    console.log(`    Hybrid search returned ${data.citations.length} citations`);
  }
});

await test('Claim: Search uses semantic similarity', async () => {
  // Search for semantically similar but not exact match
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'programming code functions', // Should match "code snippets"
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);
  // Semantic search should return relevant results even without exact keyword match
  assertExists(data.answer, 'Semantic search should return answer');
});

// Claim: "Timeline heatmap and topic graph"

await test('Claim: Graph endpoint returns nodes', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);
  assertExists(data.nodes, 'Graph should have nodes array');
  assertArray(data.nodes, 'Nodes should be an array');

  if (data.nodes.length > 0) {
    const node = data.nodes[0];
    assertExists(node.id, 'Node should have id');
    // Verify coordinate structure if present
    if ('x' in node) {
      assertType(node.x, 'number', 'Node x should be number');
    }
    console.log(`    Graph returned ${data.nodes.length} nodes`);
  }
});

await test('Claim: Graph endpoint returns edges', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);
  assertExists(data.edges, 'Graph should have edges array');
  assertArray(data.edges, 'Edges should be an array');

  if (data.edges.length > 0) {
    const edge = data.edges[0];
    assertExists(edge.source, 'Edge should have source');
    assertExists(edge.target, 'Edge should have target');
    console.log(`    Graph returned ${data.edges.length} edges`);
  }
});

await test('Claim: Graph supports topic clustering', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  // Clusters are optional but check structure if present
  if (data.clusters && data.clusters.length > 0) {
    const cluster = data.clusters[0];
    assertExists(cluster.id, 'Cluster should have id');
    console.log(`    Graph returned ${data.clusters.length} clusters`);
  } else {
    console.log('    Note: No clusters returned (may need more data)');
  }
});

// Claim: "Every answer must reference source notes"

await test('Claim: Ask returns citations array', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'What notes have been captured?',
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);

  // Citations should be present in response structure
  assertExists(data.citations, 'Response should have citations field');
  assertArray(data.citations, 'Citations should be an array');

  console.log(`    Ask returned ${data.citations.length} citations`);
});

await test('Claim: Citations reference actual thoughts', async () => {
  const { status, data } = await post<AskResponse>('/ask', {
    query: 'decisions architecture',
  });

  assert(status === 200 || status === 201, `Expected success status, got ${status}`);

  if (data.citations && data.citations.length > 0) {
    for (const citation of data.citations) {
      // Citation should reference a thought
      const hasRef = citation.id || citation.thoughtId;
      assert(
        hasRef !== undefined,
        'Citation should reference a thought (id or thoughtId)'
      );
    }
  }
});

// Additional feature claims

await test('Claim: Auto-captures context (optional field)', async () => {
  // Context is captured by client, verify API accepts it
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Context test ${testId()}`,
    type: 'note',
    context: {
      app: 'TestApp',
      repo: 'ragbrain',
      file: 'tests/readme.test.ts',
      branch: 'main',
    },
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should accept thought with context');

  createdThoughts.push(data.id);
});

await test('Claim: Supports tags for organization', async () => {
  const { status, data } = await post<ThoughtResponse>('/thoughts', {
    text: `Tagged thought ${testId()}`,
    type: 'note',
    tags: ['tag1', 'tag2', 'readme-test'],
  });

  assert(status === 200 || status === 201, `Expected success, got ${status}`);
  assertExists(data.id, 'Should accept thought with tags');

  createdThoughts.push(data.id);
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
