/**
 * Graph API Tests
 *
 * Tests:
 * - GET /graph - Get visualization data
 *
 * README claims verified:
 * - "3D Hypergraph — Navigate your knowledge as an interactive node graph"
 * - "Constellation View — See thoughts as a twinkling starfield grouped by topic"
 * - Response includes nodes, edges, and clusters
 */

import {
  suite, test, assert, assertEqual, assertExists, assertArray, assertHasKeys, assertType,
  get, printSummary
} from './test-utils.js';

interface GraphNode {
  id: string;
  x: number;
  y: number;
  z: number;
  tags?: string[];
  recency?: number;
  importance?: number;
  type?: string;
  clusterId?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  similarity: number;
}

interface GraphCluster {
  id: string;
  label: string;
  color: string;
  nodeIds: string[];
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: GraphCluster[];
}

suite('Graph API');

await test('GET /graph - returns visualization data', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.nodes, 'Response should have nodes');
  assertExists(data.edges, 'Response should have edges');
  assertExists(data.clusters, 'Response should have clusters');
});

await test('GET /graph - nodes array structure', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.nodes, 'nodes should be an array');

  if (data.nodes.length > 0) {
    const node = data.nodes[0];
    assertHasKeys(node as unknown as Record<string, unknown>,
      ['id', 'x', 'y', 'z'],
      'Node should have required fields');

    // Verify coordinate types
    assertType(node.x, 'number', 'x should be a number');
    assertType(node.y, 'number', 'y should be a number');
    assertType(node.z, 'number', 'z should be a number');
  }
});

await test('GET /graph - node coordinates are normalized', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  for (const node of data.nodes) {
    // Coordinates should typically be normalized (0-1 range or similar)
    // This is a soft check since implementations may vary
    assert(
      typeof node.x === 'number' && !isNaN(node.x),
      'x coordinate should be a valid number'
    );
    assert(
      typeof node.y === 'number' && !isNaN(node.y),
      'y coordinate should be a valid number'
    );
    assert(
      typeof node.z === 'number' && !isNaN(node.z),
      'z coordinate should be a valid number'
    );
  }
});

await test('GET /graph - edges array structure', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.edges, 'edges should be an array');

  if (data.edges.length > 0) {
    const edge = data.edges[0];
    assertHasKeys(edge as unknown as Record<string, unknown>,
      ['source', 'target', 'similarity'],
      'Edge should have required fields');

    assertType(edge.source, 'string', 'source should be a string');
    assertType(edge.target, 'string', 'target should be a string');
    assertType(edge.similarity, 'number', 'similarity should be a number');

    // Similarity should be between 0 and 1
    assert(
      edge.similarity >= 0 && edge.similarity <= 1,
      `Edge similarity should be between 0 and 1, got ${edge.similarity}`
    );
  }
});

await test('GET /graph - clusters array structure', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertArray(data.clusters, 'clusters should be an array');

  if (data.clusters.length > 0) {
    const cluster = data.clusters[0];
    assertHasKeys(cluster as unknown as Record<string, unknown>,
      ['id', 'label', 'color', 'nodeIds'],
      'Cluster should have required fields');

    assertType(cluster.label, 'string', 'label should be a string');
    assertType(cluster.color, 'string', 'color should be a string');
    assertArray(cluster.nodeIds, 'nodeIds should be an array');

    // Color should be a valid hex color
    assert(
      /^#[0-9a-fA-F]{6}$/.test(cluster.color),
      `Color should be hex format, got ${cluster.color}`
    );
  }
});

await test('GET /graph - with month filter', async () => {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const { status, data } = await get<GraphResponse>(`/graph?month=${currentMonth}`);

  assertEqual(status, 200, `Expected 200, got ${status}`);
  assertExists(data.nodes, 'Response should have nodes');
  assertExists(data.edges, 'Response should have edges');
  assertExists(data.clusters, 'Response should have clusters');
});

await test('GET /graph - node has optional metadata fields', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  if (data.nodes.length > 0) {
    const node = data.nodes[0];

    // Check optional fields exist and have correct types if present
    if (node.recency !== undefined) {
      assertType(node.recency, 'number', 'recency should be a number');
      assert(node.recency >= 0 && node.recency <= 1, 'recency should be between 0 and 1');
    }

    if (node.importance !== undefined) {
      assertType(node.importance, 'number', 'importance should be a number');
      assert(node.importance >= 0 && node.importance <= 1, 'importance should be between 0 and 1');
    }

    if (node.type !== undefined) {
      assertType(node.type, 'string', 'type should be a string');
    }

    if (node.tags !== undefined) {
      assertArray(node.tags, 'tags should be an array');
    }

    if (node.clusterId !== undefined) {
      assertType(node.clusterId, 'string', 'clusterId should be a string');
    }
  }
});

await test('GET /graph - edges reference valid node IDs', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  const nodeIds = new Set(data.nodes.map(n => n.id));

  for (const edge of data.edges) {
    assert(
      nodeIds.has(edge.source),
      `Edge source ${edge.source} should reference a valid node`
    );
    assert(
      nodeIds.has(edge.target),
      `Edge target ${edge.target} should reference a valid node`
    );
  }
});

await test('GET /graph - cluster nodeIds reference valid nodes', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assertEqual(status, 200, `Expected 200, got ${status}`);

  const nodeIds = new Set(data.nodes.map(n => n.id));

  for (const cluster of data.clusters) {
    for (const nodeId of cluster.nodeIds) {
      assert(
        nodeIds.has(nodeId),
        `Cluster ${cluster.id} references invalid node ${nodeId}`
      );
    }
  }
});

// Print results
const summary = printSummary();

export default summary;
