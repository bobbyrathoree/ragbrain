import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  GraphRequest,
  GraphResponse,
  GraphNode,
  GraphEdge,
  GraphTheme,
  GalaxyOverview,
  GalaxyTheme,
  ThemeAffinity,
  ConstellationView,
  ConstellationNode,
  ConstellationEdge,
} from '@ragbrain/shared';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const cloudwatch = new CloudWatchClient({});
const bedrock = new BedrockRuntimeClient({});

const {
  BUCKET_NAME,
  TABLE_NAME,
  SEARCH_ENDPOINT,
  SEARCH_COLLECTION,
  PROJECT_NAME,
  ENVIRONMENT,
  AWS_REGION,
  GRAPH_BUCKET,
} = process.env;

// Theme colors for visualization
const THEME_COLORS = [
  '#FF6B6B', // Coral red
  '#4ECDC4', // Teal
  '#45B7D1', // Sky blue
  '#96CEB4', // Sage green
  '#FECA57', // Golden yellow
  '#DDA0DD', // Plum
  '#87CEEB', // Light blue
  '#F0E68C', // Khaki
];

// OpenSearch client
const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION!,
    service: 'aoss',
    getCredentials: defaultProvider(),
  }),
  node: SEARCH_ENDPOINT,
});

interface ThoughtWithEmbedding {
  id: string;
  embedding: number[];
  text: string;
  tags: string[];
  type: string;
  createdAt: number;
  decisionScore: number;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trim() + '…';
}

// ============ Seeded PRNG (deterministic clustering) ============

/** Simple mulberry32 PRNG — same seed always produces same sequence */
function createSeededRandom(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** Generate a deterministic seed from thought IDs */
function hashThoughtIds(ids: string[]): number {
  let hash = 0
  const str = ids.sort().join('')
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash |= 0
  }
  return hash
}

// ============ K-means Clustering ============

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function vectorMean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      mean[i] += v[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= vectors.length;
  }
  return mean;
}

function initializeCentroidsKMeansPlusPlus(
  embeddings: number[][],
  k: number,
  random: () => number = Math.random,
): number[][] {
  const centroids: number[][] = [];
  const n = embeddings.length;

  // Choose first centroid deterministically
  const firstIdx = Math.floor(random() * n);
  centroids.push([...embeddings[firstIdx]]);

  // Choose remaining centroids with probability proportional to distance²
  for (let c = 1; c < k; c++) {
    const distances: number[] = [];
    let totalDist = 0;

    for (const embedding of embeddings) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const sim = cosineSimilarity(embedding, centroid);
        const dist = 1 - sim;
        if (dist < minDist) minDist = dist;
      }
      distances.push(minDist * minDist);
      totalDist += minDist * minDist;
    }

    let threshold = random() * totalDist;
    let cumSum = 0;
    for (let i = 0; i < n; i++) {
      cumSum += distances[i];
      if (cumSum >= threshold) {
        centroids.push([...embeddings[i]]);
        break;
      }
    }

    if (centroids.length <= c) {
      centroids.push([...embeddings[Math.floor(random() * n)]]);
    }
  }

  return centroids;
}

function kMeansClustering(
  thoughts: ThoughtWithEmbedding[],
  k: number,
  random: () => number = Math.random,
): Map<number, string[]> {
  if (thoughts.length === 0) return new Map();
  if (thoughts.length <= k) {
    // If fewer thoughts than clusters, assign each to its own cluster
    const result = new Map<number, string[]>();
    thoughts.forEach((t, i) => {
      result.set(i, [t.id]);
    });
    return result;
  }

  const embeddings = thoughts.map(t => t.embedding);
  const n = embeddings.length;
  const maxIterations = 50;

  // Initialize centroids using k-means++
  let centroids = initializeCentroidsKMeansPlusPlus(embeddings, k, random);
  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assignment step: assign each point to nearest centroid
    const newAssignments = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let bestCluster = 0;
      let bestSimilarity = -Infinity;

      for (let c = 0; c < k; c++) {
        const sim = cosineSimilarity(embeddings[i], centroids[c]);
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestCluster = c;
        }
      }
      newAssignments[i] = bestCluster;
    }

    // Check for convergence
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (newAssignments[i] !== assignments[i]) {
        changed = true;
        break;
      }
    }

    assignments = newAssignments;

    if (!changed) break;

    // Update step: recompute centroids
    const clusterEmbeddings: number[][][] = Array(k).fill(null).map(() => []);
    for (let i = 0; i < n; i++) {
      clusterEmbeddings[assignments[i]].push(embeddings[i]);
    }

    for (let c = 0; c < k; c++) {
      if (clusterEmbeddings[c].length > 0) {
        centroids[c] = vectorMean(clusterEmbeddings[c]);
      }
    }
  }

  // Build result map
  const result = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    const clusterId = assignments[i];
    if (!result.has(clusterId)) {
      result.set(clusterId, []);
    }
    result.get(clusterId)!.push(thoughts[i].id);
  }

  return result;
}

function calculateOptimalK(n: number): number {
  // K = min(6, max(3, floor(sqrt(n/5))))
  // For 50 thoughts: K = 3
  // For 200 thoughts: K = 6
  // For 500 thoughts: K = 6
  return Math.min(6, Math.max(3, Math.floor(Math.sqrt(n / 5))));
}

// ============ LLM Theme Labeling ============

async function generateThemeLabel(
  sampleThoughts: string[]
): Promise<{ label: string; description: string }> {
  const prompt = `Analyze these related thoughts from a personal knowledge base and generate a concise theme:

Thoughts:
${sampleThoughts.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Generate a theme that captures what connects these thoughts. Respond in JSON format only:
{"label": "2-4 word theme title", "description": "One sentence describing what connects these thoughts"}`;

  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const content = responseBody.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        label: parsed.label || 'Miscellaneous',
        description: parsed.description || 'Various related thoughts',
      };
    }

    return { label: 'Miscellaneous', description: 'Various related thoughts' };
  } catch (error) {
    console.error('Failed to generate theme label:', error);
    return { label: 'Miscellaneous', description: 'Various related thoughts' };
  }
}

// ============ 2D Layout ============

function compute2DLayout(
  thoughts: ThoughtWithEmbedding[],
  clusterAssignments: Map<string, number>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Group thoughts by cluster
  const clusterGroups = new Map<number, ThoughtWithEmbedding[]>();
  for (const thought of thoughts) {
    const clusterId = clusterAssignments.get(thought.id) ?? 0;
    if (!clusterGroups.has(clusterId)) {
      clusterGroups.set(clusterId, []);
    }
    clusterGroups.get(clusterId)!.push(thought);
  }

  const numClusters = clusterGroups.size;
  const clusterRadius = 150; // Distance from center for cluster centers
  const nodeSpread = 80; // Spread of nodes within cluster

  let clusterIndex = 0;
  for (const [clusterId, clusterThoughts] of clusterGroups) {
    // Position cluster center around a circle
    const clusterAngle = (clusterIndex / numClusters) * 2 * Math.PI;
    const clusterCenterX = clusterRadius * Math.cos(clusterAngle);
    const clusterCenterY = clusterRadius * Math.sin(clusterAngle);

    // Position nodes within cluster
    const n = clusterThoughts.length;
    for (let i = 0; i < n; i++) {
      // Spiral layout within cluster
      const nodeAngle = (i / n) * 2 * Math.PI * 2; // 2 full rotations
      const nodeRadius = nodeSpread * (0.3 + 0.7 * (i / n)); // Growing spiral

      const x = clusterCenterX + nodeRadius * Math.cos(nodeAngle);
      const y = clusterCenterY + nodeRadius * Math.sin(nodeAngle);

      positions.set(clusterThoughts[i].id, { x, y });
    }

    clusterIndex++;
  }

  return positions;
}

// ============ Data Fetching ============

async function fetchThoughtsWithEmbeddings(
  user: string,
  month?: string
): Promise<ThoughtWithEmbedding[]> {
  let dateRange: { from: number; to: number } | undefined;
  if (month) {
    const [year, monthNum] = month.split('-').map(Number);
    const startDate = new Date(year, monthNum - 1, 1);
    const endDate = new Date(year, monthNum, 0, 23, 59, 59, 999);
    dateRange = {
      from: startDate.getTime(),
      to: endDate.getTime(),
    };
  }

  const searchBody: any = {
    size: 1000,
    query: {
      bool: {
        must: [{ term: { user } }],
      },
    },
    _source: ['id', 'embedding', 'text', 'tags', 'type', 'created_at_epoch', 'decision_score'],
  };

  if (dateRange) {
    searchBody.query.bool.must.push({
      range: {
        created_at_epoch: {
          gte: dateRange.from,
          lte: dateRange.to,
        },
      },
    });
  }

  try {
    const response = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: searchBody,
    });

    return response.body.hits.hits.map((hit: any) => ({
      id: hit._source.id,
      embedding: hit._source.embedding,
      text: hit._source.text,
      tags: hit._source.tags || [],
      type: hit._source.type,
      createdAt: hit._source.created_at_epoch,
      decisionScore: hit._source.decision_score || 0,
    }));
  } catch (error) {
    console.error('Failed to fetch thoughts from OpenSearch:', error);

    // Fallback to DynamoDB (without embeddings)
    const scanParams: any = {
      TableName: TABLE_NAME,
      FilterExpression: 'begins_with(pk, :userKey)',
      ExpressionAttributeValues: {
        ':userKey': { S: `user#${user}` },
      },
      Limit: 500,
    };

    if (dateRange) {
      scanParams.FilterExpression += ' AND createdAt BETWEEN :from AND :to';
      scanParams.ExpressionAttributeValues[':from'] = { N: dateRange.from.toString() };
      scanParams.ExpressionAttributeValues[':to'] = { N: dateRange.to.toString() };
    }

    const scanResult = await dynamodb.send(new ScanCommand(scanParams));

    return (scanResult.Items || []).map(item => {
      const thought = unmarshall(item);
      // Generate random embeddings for visualization (fallback)
      const embedding = Array(1024).fill(0).map(() => Math.random() - 0.5);

      return {
        id: thought.id,
        embedding,
        text: thought.text,
        tags: Array.from(thought.tags || []),
        type: thought.type,
        createdAt: thought.createdAt,
        decisionScore: thought.decisionScore || 0,
      };
    });
  }
}

// ============ Edge Building ============

function buildEdges(
  thoughts: ThoughtWithEmbedding[],
  minSimilarity: number = 0.7
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (let i = 0; i < thoughts.length; i++) {
    for (let j = i + 1; j < thoughts.length; j++) {
      const similarity = cosineSimilarity(
        thoughts[i].embedding,
        thoughts[j].embedding
      );

      if (similarity >= minSimilarity) {
        edges.push({
          source: thoughts[i].id,
          target: thoughts[j].id,
          similarity,
        });
      }
    }
  }

  // Limit edges per node to avoid overcrowding
  const edgeCountPerNode = new Map<string, number>();
  const filteredEdges: GraphEdge[] = [];

  edges.sort((a, b) => b.similarity - a.similarity);

  for (const edge of edges) {
    const sourceCount = edgeCountPerNode.get(edge.source) || 0;
    const targetCount = edgeCountPerNode.get(edge.target) || 0;

    if (sourceCount < 5 && targetCount < 5) {
      filteredEdges.push(edge);
      edgeCountPerNode.set(edge.source, sourceCount + 1);
      edgeCountPerNode.set(edge.target, targetCount + 1);
    }
  }

  return filteredEdges;
}

// ============ LOD: Galaxy Overview (LOD 0) ============

function computeThemeAffinities(
  thoughts: ThoughtWithEmbedding[],
  clusterMap: Map<number, string[]>,
  thoughtsById: Map<string, ThoughtWithEmbedding>,
): ThemeAffinity[] {
  const clusterIds = Array.from(clusterMap.keys());
  const affinities: ThemeAffinity[] = [];

  for (let i = 0; i < clusterIds.length; i++) {
    for (let j = i + 1; j < clusterIds.length; j++) {
      const idsA = clusterMap.get(clusterIds[i])!;
      const idsB = clusterMap.get(clusterIds[j])!;

      // Compute mean cosine similarity between clusters (sample for speed)
      const sampleA = idsA.slice(0, 50).map(id => thoughtsById.get(id)).filter(Boolean) as ThoughtWithEmbedding[];
      const sampleB = idsB.slice(0, 50).map(id => thoughtsById.get(id)).filter(Boolean) as ThoughtWithEmbedding[];

      let totalSim = 0;
      let crossEdges = 0;
      let comparisons = 0;

      for (const a of sampleA) {
        for (const b of sampleB) {
          const sim = cosineSimilarity(a.embedding, b.embedding);
          totalSim += sim;
          comparisons++;
          if (sim >= 0.5) crossEdges++;
        }
      }

      const strength = comparisons > 0 ? totalSim / comparisons : 0;
      // Scale volume: estimate from sample
      const volumeScale = (idsA.length * idsB.length) / (sampleA.length * sampleB.length);
      const volume = Math.round(crossEdges * volumeScale);

      if (strength > 0.1 || volume > 0) {
        affinities.push({
          source: `theme-${clusterIds[i]}`,
          target: `theme-${clusterIds[j]}`,
          strength: Number(strength.toFixed(3)),
          volume,
        });
      }
    }
  }

  return affinities;
}

function buildGalaxyOverview(
  themes: GraphTheme[],
  affinities: ThemeAffinity[],
  totalThoughts: number,
): GalaxyOverview {
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  return {
    level: 0,
    themes: themes.map(t => ({
      id: t.id,
      label: t.label,
      description: t.description,
      color: t.color,
      count: t.count,
      recentCount: 0, // computed below when we have thought timestamps
      topTags: [],     // computed below
      sampleThoughts: t.sampleThoughts,
    })),
    affinities,
    metadata: {
      totalThoughts,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ============ LOD: Constellation View (LOD 1) ============

function buildEdgesWithKNN(
  thoughts: ThoughtWithEmbedding[],
  minSimilarity: number = 0.4,
  kNearest: number = 3,
  maxEdgesPerNode: number = 5,
): ConstellationEdge[] {
  const edges: ConstellationEdge[] = [];
  const knnEdges = new Map<string, { target: string; similarity: number }[]>();

  // Compute all pairwise similarities and track k-NN
  for (let i = 0; i < thoughts.length; i++) {
    const neighbors: { target: string; similarity: number }[] = [];
    for (let j = 0; j < thoughts.length; j++) {
      if (i === j) continue;
      const sim = cosineSimilarity(thoughts[i].embedding, thoughts[j].embedding);
      neighbors.push({ target: thoughts[j].id, similarity: sim });
    }
    neighbors.sort((a, b) => b.similarity - a.similarity);
    knnEdges.set(thoughts[i].id, neighbors.slice(0, kNearest));
  }

  // Collect edges: k-NN guaranteed + threshold-based
  const edgeSet = new Set<string>();
  const addEdge = (src: string, tgt: string, sim: number) => {
    const key = src < tgt ? `${src}-${tgt}` : `${tgt}-${src}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push({ source: src, target: tgt, similarity: Number(sim.toFixed(3)) });
    }
  };

  // Add k-NN edges (guaranteed connectivity)
  for (const [srcId, neighbors] of knnEdges) {
    for (const { target, similarity } of neighbors) {
      addEdge(srcId, target, similarity);
    }
  }

  // Add threshold-based edges
  for (let i = 0; i < thoughts.length; i++) {
    for (let j = i + 1; j < thoughts.length; j++) {
      const sim = cosineSimilarity(thoughts[i].embedding, thoughts[j].embedding);
      if (sim >= minSimilarity) {
        addEdge(thoughts[i].id, thoughts[j].id, sim);
      }
    }
  }

  // Limit edges per node
  const edgeCountPerNode = new Map<string, number>();
  const filtered: ConstellationEdge[] = [];
  edges.sort((a, b) => b.similarity - a.similarity);

  for (const edge of edges) {
    const sc = edgeCountPerNode.get(edge.source) || 0;
    const tc = edgeCountPerNode.get(edge.target) || 0;
    if (sc < maxEdgesPerNode && tc < maxEdgesPerNode) {
      filtered.push(edge);
      edgeCountPerNode.set(edge.source, sc + 1);
      edgeCountPerNode.set(edge.target, tc + 1);
    }
  }

  return filtered;
}

function buildConstellationView(
  themeId: string,
  themeLabel: string,
  themeColor: string,
  thoughts: ThoughtWithEmbedding[],
): ConstellationView {
  const now = Date.now();
  const maxAge = 365 * 24 * 60 * 60 * 1000;

  // Sort by importance + recency, cap at 500
  const sorted = [...thoughts].sort((a, b) => {
    const scoreA = a.decisionScore + Math.max(0, 1 - (now - a.createdAt) / maxAge);
    const scoreB = b.decisionScore + Math.max(0, 1 - (now - b.createdAt) / maxAge);
    return scoreB - scoreA;
  });
  const capped = sorted.slice(0, 500);

  const nodes: ConstellationNode[] = capped.map(t => ({
    id: t.id,
    text: truncateText(t.text, 80),
    type: t.type,
    tags: t.tags,
    importance: t.decisionScore,
    recency: Math.max(0, 1 - (now - t.createdAt) / maxAge),
  }));

  const edges = buildEdgesWithKNN(capped, 0.4, 3, 5);

  return {
    level: 1,
    themeId,
    themeLabel,
    themeColor,
    thoughts: nodes,
    edges,
  };
}

// ============ LOD Request Handler ============

async function handleLODRequest(
  user: string,
  level: 'overview' | 'theme',
  themeId: string | undefined,
  startTime: number,
): Promise<APIGatewayProxyResultV2> {
  const cacheKey = level === 'overview'
    ? `graph/${user}/overview-v3.json`
    : `graph/${user}/theme-${themeId}-v3.json`;

  // Check cache
  let lastDataChange = 0;
  try {
    const metaResult = await dynamodb.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: `user#${user}` }, sk: { S: 'meta' } },
      ProjectionExpression: 'lastDataChange',
    }));
    lastDataChange = metaResult.Item?.lastDataChange?.N ? parseInt(metaResult.Item.lastDataChange.N) : 0;
  } catch {}

  try {
    const cached = await s3.send(new GetObjectCommand({
      Bucket: GRAPH_BUCKET || BUCKET_NAME,
      Key: cacheKey,
    }));
    const cacheAge = Date.now() - (cached.LastModified?.getTime() || 0);
    if (cacheAge < 3600000 && (cached.LastModified?.getTime() || 0) > lastDataChange) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
        body: await cached.Body!.transformToString(),
      };
    }
  } catch {}

  // Fetch thoughts and cluster
  const thoughts = await fetchThoughtsWithEmbeddings(user);
  if (thoughts.length === 0) {
    const empty = level === 'overview'
      ? { level: 0, themes: [], affinities: [], metadata: { totalThoughts: 0, generatedAt: new Date().toISOString() } }
      : { level: 1, themeId: themeId || '', themeLabel: '', themeColor: '', thoughts: [], edges: [] };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(empty) };
  }

  // Seeded PRNG so same thoughts always produce same clusters
  const seed = hashThoughtIds(thoughts.map(t => t.id));
  const random = createSeededRandom(seed);
  const k = calculateOptimalK(thoughts.length);
  const clusterMap = kMeansClustering(thoughts, k, random);
  const thoughtsById = new Map(thoughts.map(t => [t.id, t]));

  // Build cluster → theme mapping
  const thoughtToCluster = new Map<string, number>();
  for (const [clusterId, thoughtIds] of clusterMap) {
    for (const id of thoughtIds) thoughtToCluster.set(id, clusterId);
  }

  // Generate theme labels
  let colorIndex = 0;
  const themePromises: Promise<{ clusterId: number; theme: GraphTheme }>[] = [];
  for (const [clusterId, thoughtIds] of clusterMap) {
    const clusterThoughts = thoughtIds.map(id => thoughtsById.get(id)).filter(Boolean) as ThoughtWithEmbedding[];
    const sampleTexts = clusterThoughts.slice(0, 10).map(t => truncateText(t.text, 200));
    const color = THEME_COLORS[colorIndex++ % THEME_COLORS.length];

    themePromises.push(
      generateThemeLabel(sampleTexts).then(({ label, description }) => ({
        clusterId,
        theme: {
          id: `theme-${clusterId}`,
          label, description, color,
          count: thoughtIds.length,
          sampleThoughts: clusterThoughts.slice(0, 5).map(t => ({ id: t.id, text: truncateText(t.text, 100) })),
        },
      }))
    );
  }
  const themeResults = await Promise.all(themePromises);
  const themes = themeResults.map(r => r.theme);
  const clusterToTheme = new Map(themeResults.map(r => [r.clusterId, r.theme]));

  let responseBody: string;

  if (level === 'overview') {
    // Compute affinities
    const affinities = computeThemeAffinities(thoughts, clusterMap, thoughtsById);

    // Enrich themes with recentCount and topTags
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const galaxyThemes: GalaxyTheme[] = themes.map(t => {
      const clusterId = parseInt(t.id.replace('theme-', ''));
      const thoughtIds = clusterMap.get(clusterId) || [];
      const clusterThoughts = thoughtIds.map(id => thoughtsById.get(id)).filter(Boolean) as ThoughtWithEmbedding[];

      const recentCount = clusterThoughts.filter(ct => ct.createdAt > sevenDaysAgo).length;
      const tagCounts = new Map<string, number>();
      clusterThoughts.forEach(ct => ct.tags.forEach(tag => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
      const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag);

      return {
        id: t.id, label: t.label, description: t.description, color: t.color,
        count: t.count, recentCount, topTags,
        sampleThoughts: t.sampleThoughts,
      };
    });

    const overview: GalaxyOverview = {
      level: 0,
      themes: galaxyThemes,
      affinities,
      metadata: { totalThoughts: thoughts.length, generatedAt: new Date().toISOString() },
    };
    responseBody = JSON.stringify(overview);

  } else {
    // level === 'theme'
    if (!themeId) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'themeId is required' }) };
    }

    const clusterId = parseInt(themeId.replace('theme-', ''));
    const thoughtIds = clusterMap.get(clusterId);
    if (!thoughtIds) {
      return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Theme not found' }) };
    }

    const clusterThoughts = thoughtIds.map(id => thoughtsById.get(id)).filter(Boolean) as ThoughtWithEmbedding[];
    const theme = clusterToTheme.get(clusterId);

    const constellation = buildConstellationView(
      themeId,
      theme?.label || 'Unknown',
      theme?.color || '#888888',
      clusterThoughts,
    );
    responseBody = JSON.stringify(constellation);
  }

  // Cache
  await s3.send(new PutObjectCommand({
    Bucket: GRAPH_BUCKET || BUCKET_NAME,
    Key: cacheKey,
    Body: responseBody,
    ContentType: 'application/json',
  })).catch(err => console.error('Failed to cache:', err));

  // Metrics
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: PROJECT_NAME,
    MetricData: [{
      MetricName: 'GraphGenerationLatency',
      Value: Date.now() - startTime,
      Unit: 'Milliseconds',
      Dimensions: [{ Name: 'Environment', Value: ENVIRONMENT }, { Name: 'Level', Value: level }],
    }],
  })).catch(() => {});

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
    body: responseBody,
  };
}

// ============ Main Handler ============

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  try {
    const user = event.requestContext.authorizer?.lambda?.user;
    if (!user) {
      console.error('CRITICAL: User context missing from authorizer');
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'InternalServerError',
          message: 'Authentication context missing',
        }),
      };
    }

    const level = event.queryStringParameters?.level;
    const themeIdParam = event.queryStringParameters?.themeId;

    // LOD routing: overview, theme, or legacy (default)
    if (level === 'overview' || level === 'theme') {
      return handleLODRequest(user, level, themeIdParam, startTime);
    }

    // Legacy path (backward compat)
    const params: GraphRequest = {
      month: event.queryStringParameters?.month,
      minSimilarity: event.queryStringParameters?.minSimilarity
        ? parseFloat(event.queryStringParameters.minSimilarity)
        : 0.7,
    };

    const cacheKey = `graph/${user}/${params.month || 'all'}-v2.json`;

    // Check cache
    let lastDataChange = 0;
    try {
      const metaResult = await dynamodb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: `user#${user}` },
          sk: { S: 'meta' },
        },
        ProjectionExpression: 'lastDataChange',
      }));
      lastDataChange = metaResult.Item?.lastDataChange?.N
        ? parseInt(metaResult.Item.lastDataChange.N)
        : 0;
    } catch (error) {
      console.error('Failed to get user metadata:', error);
    }

    try {
      const cachedGraph = await s3.send(new GetObjectCommand({
        Bucket: GRAPH_BUCKET || BUCKET_NAME,
        Key: cacheKey,
      }));

      const cacheAge = Date.now() - (cachedGraph.LastModified?.getTime() || 0);
      const cacheTimestamp = cachedGraph.LastModified?.getTime() || 0;
      const maxCacheAge = 3600000; // 1 hour

      const isCacheValid = cacheAge < maxCacheAge && cacheTimestamp > lastDataChange;

      if (isCacheValid) {
        const graphData = JSON.parse(
          await cachedGraph.Body!.transformToString()
        );

        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'max-age=3600',
            'X-Cache': 'HIT',
          },
          body: JSON.stringify(graphData),
        };
      }
    } catch (error) {
      // Cache miss, continue to generate
    }

    // Fetch thoughts with embeddings
    const thoughts = await fetchThoughtsWithEmbeddings(user, params.month);

    if (thoughts.length === 0) {
      const emptyResponse: GraphResponse = {
        themes: [],
        nodes: [],
        edges: [],
        metadata: {
          totalNodes: 0,
          totalEdges: 0,
          totalThemes: 0,
          generatedAt: new Date().toISOString(),
          algorithm: 'k-means',
        },
      };
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emptyResponse),
      };
    }

    // Seeded PRNG — same thoughts always produce same clusters
    const seed = hashThoughtIds(thoughts.map(t => t.id));
    const random = createSeededRandom(seed);
    const k = calculateOptimalK(thoughts.length);
    const clusterMap = kMeansClustering(thoughts, k, random);

    // Build reverse lookup: thoughtId -> clusterId
    const thoughtToCluster = new Map<string, number>();
    for (const [clusterId, thoughtIds] of clusterMap) {
      for (const thoughtId of thoughtIds) {
        thoughtToCluster.set(thoughtId, clusterId);
      }
    }

    // Generate LLM labels for each cluster (in parallel)
    const thoughtsById = new Map(thoughts.map(t => [t.id, t]));
    const themePromises: Promise<GraphTheme>[] = [];

    let colorIndex = 0;
    for (const [clusterId, thoughtIds] of clusterMap) {
      const clusterThoughts = thoughtIds
        .map(id => thoughtsById.get(id))
        .filter((t): t is ThoughtWithEmbedding => t !== undefined);

      // Sample up to 10 thoughts for LLM labeling
      const sampleSize = Math.min(10, clusterThoughts.length);
      const sampleThoughts = clusterThoughts
        .slice(0, sampleSize)
        .map(t => truncateText(t.text, 200));

      const themeId = `theme-${clusterId}`;
      const color = THEME_COLORS[colorIndex % THEME_COLORS.length];
      colorIndex++;

      themePromises.push(
        generateThemeLabel(sampleThoughts).then(({ label, description }) => ({
          id: themeId,
          label,
          description,
          color,
          count: thoughtIds.length,
          sampleThoughts: clusterThoughts.slice(0, 5).map(t => ({
            id: t.id,
            text: truncateText(t.text, 100),
          })),
        }))
      );
    }

    const themes = await Promise.all(themePromises);

    // Build theme ID lookup
    const clusterToThemeId = new Map<number, string>();
    let themeIndex = 0;
    for (const clusterId of clusterMap.keys()) {
      clusterToThemeId.set(clusterId, themes[themeIndex].id);
      themeIndex++;
    }

    // Compute 2D layout
    const positions = compute2DLayout(thoughts, thoughtToCluster);

    // Create nodes
    const now = Date.now();
    const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year

    const nodes: GraphNode[] = thoughts.map(thought => {
      const pos = positions.get(thought.id) || { x: 0, y: 0 };
      const clusterId = thoughtToCluster.get(thought.id) ?? 0;
      const themeId = clusterToThemeId.get(clusterId) || 'theme-0';
      const age = now - thought.createdAt;
      const recency = Math.max(0, 1 - age / maxAge);

      return {
        id: thought.id,
        label: truncateText(thought.text, 60),
        themeId,
        x: pos.x,
        y: pos.y,
        tags: thought.tags,
        recency,
        importance: thought.decisionScore,
        type: thought.type,
      };
    });

    // Build edges
    const edges = buildEdges(thoughts, params.minSimilarity);

    // Prepare response
    const response: GraphResponse = {
      themes,
      nodes,
      edges,
      metadata: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        totalThemes: themes.length,
        generatedAt: new Date().toISOString(),
        algorithm: 'k-means',
      },
    };

    // Cache the result
    await s3.send(new PutObjectCommand({
      Bucket: GRAPH_BUCKET || BUCKET_NAME,
      Key: cacheKey,
      Body: JSON.stringify(response),
      ContentType: 'application/json',
      Metadata: {
        user,
        month: params.month || 'all',
        generatedAt: new Date().toISOString(),
      },
    })).catch(err => {
      console.error('Failed to cache graph:', err);
    });

    // Emit metrics
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'GraphGenerationLatency',
          Value: Date.now() - startTime,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'GraphNodes',
          Value: nodes.length,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'GraphThemes',
          Value: themes.length,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
      ],
    })).catch(err => {
      console.error('Failed to emit metrics:', err);
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=3600',
        'X-Cache': 'MISS',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error generating graph:', error);

    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'GraphGenerationError',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
      ],
    })).catch(() => {});

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'InternalServerError',
        message: 'Failed to generate graph',
        requestId: event.requestContext.requestId,
      }),
    };
  }
};
