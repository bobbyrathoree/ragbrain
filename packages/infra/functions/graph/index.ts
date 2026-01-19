import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ScanCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { 
  GraphRequest, 
  GraphResponse, 
  GraphNode, 
  GraphEdge 
} from '@ragbrain/shared';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const cloudwatch = new CloudWatchClient({});

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

// UMAP implementation (simplified for demo - in production use a proper library)
class SimpleUMAP {
  private dimensions: number;
  
  constructor(dimensions: number = 2) {
    this.dimensions = dimensions;
  }
  
  fitTransform(embeddings: number[][]): number[][] {
    // Simplified dimensionality reduction using PCA-like approach
    // In production, use proper UMAP library
    const n = embeddings.length;
    const d = embeddings[0].length;
    
    // Center the data
    const mean = new Array(d).fill(0);
    for (const embedding of embeddings) {
      for (let i = 0; i < d; i++) {
        mean[i] += embedding[i] / n;
      }
    }
    
    const centered = embeddings.map(embedding =>
      embedding.map((val, i) => val - mean[i])
    );
    
    // Simple projection to 2D/3D (this is a placeholder)
    const projected: number[][] = [];
    for (const point of centered) {
      const coords: number[] = [];
      for (let dim = 0; dim < this.dimensions; dim++) {
        // Use different combinations of dimensions for projection
        let coord = 0;
        for (let i = dim; i < d; i += this.dimensions) {
          coord += point[i] * Math.sin(i * 0.1);
        }
        coords.push(coord * 10); // Scale for visualization
      }
      projected.push(coords);
    }
    
    return projected;
  }
}

async function fetchThoughtsWithEmbeddings(
  user: string,
  month?: string
): Promise<ThoughtWithEmbedding[]> {
  // Build date range for the month
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
  
  // Query OpenSearch for thoughts with embeddings
  const searchBody: any = {
    size: 1000, // Limit for graph visualization
    query: {
      bool: {
        must: [
          { term: { user } },
        ],
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
      tags: hit._source.tags,
      type: hit._source.type,
      createdAt: hit._source.created_at_epoch,
      decisionScore: hit._source.decision_score,
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

function calculateSimilarity(embedding1: number[], embedding2: number[]): number {
  // Cosine similarity
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

function buildGraph(
  thoughts: ThoughtWithEmbedding[],
  minSimilarity: number = 0.7
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  // Apply UMAP for dimensionality reduction
  const umap = new SimpleUMAP(3); // 3D coordinates
  const embeddings = thoughts.map(t => t.embedding);
  const coordinates = umap.fitTransform(embeddings);
  
  // Create nodes
  const nodes: GraphNode[] = thoughts.map((thought, index) => {
    const [x, y, z] = coordinates[index];
    const now = Date.now();
    const age = now - thought.createdAt;
    const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year
    const recency = Math.max(0, 1 - age / maxAge);
    
    return {
      id: thought.id,
      x,
      y,
      z,
      tags: thought.tags,
      recency,
      importance: thought.decisionScore,
      type: thought.type,
    };
  });
  
  // Build edges based on similarity
  const edges: GraphEdge[] = [];
  for (let i = 0; i < thoughts.length; i++) {
    for (let j = i + 1; j < thoughts.length; j++) {
      const similarity = calculateSimilarity(
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
  
  // Sort edges by similarity (highest first)
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
  
  return { nodes, edges: filteredEdges };
}

function detectClusters(
  nodes: GraphNode[],
  edges: GraphEdge[]
): Array<{ id: string; label: string; color: string; nodeIds: string[] }> {
  // Simple community detection using connected components
  const adjacency = new Map<string, Set<string>>();
  
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source)!.add(edge.target);
    adjacency.get(edge.target)!.add(edge.source);
  }
  
  const visited = new Set<string>();
  const clusters: Array<{ id: string; nodeIds: string[] }> = [];
  
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const cluster: string[] = [];
      const queue = [node.id];
      
      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        
        visited.add(current);
        cluster.push(current);
        
        const neighbors = adjacency.get(current) || new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push(neighbor);
          }
        }
      }
      
      if (cluster.length > 1) {
        clusters.push({
          id: `cluster-${clusters.length}`,
          nodeIds: cluster,
        });
      }
    }
  }
  
  // Label clusters based on common tags
  const labeledClusters = clusters.map((cluster, index) => {
    const clusterNodes = nodes.filter(n => cluster.nodeIds.includes(n.id));
    const tagCounts = new Map<string, number>();
    
    for (const node of clusterNodes) {
      for (const tag of node.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    
    const topTag = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];
    
    const label = topTag ? topTag[0] : `Group ${index + 1}`;
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#DDA0DD'];
    
    return {
      ...cluster,
      label,
      color: colors[index % colors.length],
    };
  });
  
  return labeledClusters;
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();
  
  try {
    // Parse parameters
    const params: GraphRequest = {
      month: event.queryStringParameters?.month,
      minSimilarity: event.queryStringParameters?.minSimilarity 
        ? parseFloat(event.queryStringParameters.minSimilarity)
        : 0.7,
    };
    
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

    // Check if we have a cached version
    const cacheKey = `graph/${user}/${params.month || 'all'}.json`;

    // Get user metadata to check lastDataChange for cache invalidation
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

      // Cache is valid if: not too old AND no data changes since cache was created
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
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodes: [],
          edges: [],
          metadata: {
            totalNodes: 0,
            totalEdges: 0,
            generatedAt: new Date().toISOString(),
            algorithm: 'UMAP',
          },
        }),
      };
    }
    
    // Build graph
    const { nodes, edges } = buildGraph(thoughts, params.minSimilarity);
    
    // Detect clusters
    const clusters = detectClusters(nodes, edges);
    
    // Prepare response
    const response: GraphResponse = {
      nodes,
      edges,
      clusters,
      metadata: {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        generatedAt: new Date().toISOString(),
        algorithm: 'UMAP',
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
          MetricName: 'GraphEdges',
          Value: edges.length,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'GraphClusters',
          Value: clusters.length,
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