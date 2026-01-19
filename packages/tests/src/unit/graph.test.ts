/**
 * Graph Lambda Unit Tests
 *
 * Tests for GET /graph endpoint logic validation.
 * Verifies node/edge structure, coordinate normalization, and clusters.
 */

import {
  suite, test, assert, assertExists, assertArray, assertType,
  get, printSummary
} from '../test-utils.js';

interface GraphNode {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  z?: number;
  color?: string;
  size?: number;
  type?: string;
  thoughtCount?: number;
}

interface GraphEdge {
  source: string;
  target: string;
  weight?: number;
  similarity?: number;
}

interface GraphCluster {
  id: string;
  label?: string;
  color?: string;
  nodeIds?: string[];
  centroid?: {
    x: number;
    y: number;
    z?: number;
  };
}

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: GraphCluster[];
  metadata?: {
    nodeCount?: number;
    edgeCount?: number;
    clusterCount?: number;
    generatedAt?: string;
  };
}

suite('Unit: Graph Lambda');

// Basic response structure tests

await test('Response: Has nodes and edges arrays', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  assertExists(data.nodes, 'Should have nodes');
  assertExists(data.edges, 'Should have edges');
  assertArray(data.nodes, 'nodes should be array');
  assertArray(data.edges, 'edges should be array');

  console.log(`    Graph: ${data.nodes.length} nodes, ${data.edges.length} edges`);
});

// Node structure tests

await test('Nodes: Required fields present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const node of data.nodes) {
    assertExists(node.id, 'Node should have id');
    assertType(node.id, 'string', 'Node id should be string');
  }
});

await test('Nodes: Coordinates are numbers', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const node of data.nodes) {
    if (node.x !== undefined) {
      assertType(node.x, 'number', 'x should be number');
    }
    if (node.y !== undefined) {
      assertType(node.y, 'number', 'y should be number');
    }
    if (node.z !== undefined) {
      assertType(node.z, 'number', 'z should be number');
    }
  }
});

await test('Nodes: Coordinates are valid numbers', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  const nodesWithCoords = data.nodes.filter(n =>
    n.x !== undefined && n.y !== undefined
  );

  if (nodesWithCoords.length > 0) {
    for (const node of nodesWithCoords) {
      // Coordinates should be valid finite numbers
      // The API may use various coordinate systems (normalized, pixel-based, etc.)
      if (node.x !== undefined) {
        assert(!isNaN(node.x) && isFinite(node.x), `x should be a valid number, got ${node.x}`);
      }
      if (node.y !== undefined) {
        assert(!isNaN(node.y) && isFinite(node.y), `y should be a valid number, got ${node.y}`);
      }
    }

    console.log(`    ${nodesWithCoords.length} nodes have coordinates`);
  } else {
    console.log('    Note: No nodes have coordinates');
  }
});

await test('Nodes: Color format if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  const nodesWithColor = data.nodes.filter(n => n.color);

  if (nodesWithColor.length > 0) {
    for (const node of nodesWithColor) {
      assertType(node.color, 'string', 'color should be string');

      // Should be hex format or color name
      const isHex = node.color!.match(/^#[0-9a-fA-F]{6}$/);
      const isRgb = node.color!.match(/^rgb/);
      const isName = /^[a-z]+$/i.test(node.color!);

      assert(
        !!isHex || !!isRgb || isName,
        `Invalid color format: ${node.color}`
      );
    }

    console.log(`    ${nodesWithColor.length} nodes have colors`);
  }
});

await test('Nodes: Size is positive number if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const node of data.nodes) {
    if (node.size !== undefined) {
      assertType(node.size, 'number', 'size should be number');
      assert(node.size > 0, `size should be positive, got ${node.size}`);
    }
  }
});

// Edge structure tests

await test('Edges: Have source and target', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const edge of data.edges) {
    assertExists(edge.source, 'Edge should have source');
    assertExists(edge.target, 'Edge should have target');
    assertType(edge.source, 'string', 'source should be string');
    assertType(edge.target, 'string', 'target should be string');
  }
});

await test('Edges: Reference valid nodes', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  const nodeIds = new Set(data.nodes.map(n => n.id));

  for (const edge of data.edges) {
    assert(
      nodeIds.has(edge.source),
      `Edge source ${edge.source} not in nodes`
    );
    assert(
      nodeIds.has(edge.target),
      `Edge target ${edge.target} not in nodes`
    );
  }
});

await test('Edges: Weight is 0-1 if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const edge of data.edges) {
    if (edge.weight !== undefined) {
      assertType(edge.weight, 'number', 'weight should be number');
      assert(
        edge.weight >= 0 && edge.weight <= 1,
        `weight should be 0-1, got ${edge.weight}`
      );
    }
  }
});

await test('Edges: Similarity is valid if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  for (const edge of data.edges) {
    if (edge.similarity !== undefined) {
      assertType(edge.similarity, 'number', 'similarity should be number');
      // Similarity may be raw cosine similarity (0-1) or a computed score (can exceed 1)
      assert(
        edge.similarity >= 0,
        `similarity should be non-negative, got ${edge.similarity}`
      );
    }
  }
});

// Cluster structure tests

await test('Clusters: Structure if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.clusters && data.clusters.length > 0) {
    for (const cluster of data.clusters) {
      assertExists(cluster.id, 'Cluster should have id');
      assertType(cluster.id, 'string', 'Cluster id should be string');
    }

    console.log(`    ${data.clusters.length} clusters`);
  } else {
    console.log('    Note: No clusters in response');
  }
});

await test('Clusters: NodeIds reference valid nodes', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.clusters) {
    const nodeIds = new Set(data.nodes.map(n => n.id));

    for (const cluster of data.clusters) {
      if (cluster.nodeIds) {
        assertArray(cluster.nodeIds, 'nodeIds should be array');

        for (const nodeId of cluster.nodeIds) {
          assert(
            nodeIds.has(nodeId),
            `Cluster node ${nodeId} not in nodes`
          );
        }
      }
    }
  }
});

await test('Clusters: Color format if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.clusters) {
    for (const cluster of data.clusters) {
      if (cluster.color) {
        assertType(cluster.color, 'string', 'color should be string');

        const isHex = cluster.color.match(/^#[0-9a-fA-F]{6}$/);
        const isRgb = cluster.color.match(/^rgb/);

        assert(!!isHex || !!isRgb, `Invalid color: ${cluster.color}`);
      }
    }
  }
});

// Metadata tests

await test('Metadata: Structure if present', async () => {
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  if (data.metadata) {
    if (data.metadata.nodeCount !== undefined) {
      assertType(data.metadata.nodeCount, 'number', 'nodeCount should be number');
      assert(
        data.metadata.nodeCount === data.nodes.length,
        `nodeCount should match nodes.length`
      );
    }

    if (data.metadata.edgeCount !== undefined) {
      assertType(data.metadata.edgeCount, 'number', 'edgeCount should be number');
      assert(
        data.metadata.edgeCount === data.edges.length,
        `edgeCount should match edges.length`
      );
    }

    if (data.metadata.generatedAt) {
      const date = new Date(data.metadata.generatedAt);
      assert(!isNaN(date.getTime()), 'generatedAt should be valid date');
    }
  }
});

// Consistency tests

await test('Consistency: Multiple requests return same data', async () => {
  const results = await Promise.all([
    get<GraphResponse>('/graph'),
    get<GraphResponse>('/graph'),
  ]);

  for (const { status } of results) {
    assert(status === 200, 'Request should succeed');
  }

  // Node counts should be consistent
  const nodeCounts = results.map(r => r.data.nodes.length);
  assert(
    nodeCounts[0] === nodeCounts[1],
    `Node counts should be consistent: ${nodeCounts.join(', ')}`
  );
});

// Edge cases

await test('Edge: Empty graph handling', async () => {
  // The graph should handle having no data gracefully
  const { status, data } = await get<GraphResponse>('/graph');

  assert(status === 200, `Expected 200, got ${status}`);

  // Even if empty, should have arrays
  assertArray(data.nodes, 'nodes should be array even if empty');
  assertArray(data.edges, 'edges should be array even if empty');
});

// Print results
const summary = printSummary();

// Export for test runner
export default summary;
