import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import {
  AskRequest,
  AskResponse,
  Citation,
  ConversationHit,
  parseTimeWindow,
  calculateRecencyScore,
} from '@ragbrain/shared';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const cloudwatch = new CloudWatchClient({});

const {
  SEARCH_ENDPOINT,
  SEARCH_COLLECTION,
  PROJECT_NAME,
  ENVIRONMENT,
  AWS_REGION,
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

interface SearchHit {
  _id: string;
  _score: number;
  _source: {
    id: string;
    text: string;
    summary: string;
    tags: string[];
    type: string;
    created_at_epoch: number;
    decision_score: number;
    embedding: number[];
    user: string;
    // Conversation-specific fields
    docType?: 'thought' | 'conversation';
    title?: string;
    messageCount?: number;
    citedThoughtIds?: string[];
    updated_at_epoch?: number;
  };
  highlight?: {
    text?: string[];
    summary?: string[];
  };
}

async function rewriteQuery(query: string): Promise<{
  expandedQuery: string;
  keywords: string[];
  timeHints: string[];
  tags: string[];
}> {
  // Extract tags from query
  const tagPattern = /#(\w+)/g;
  const tags: string[] = [];
  let match;
  while ((match = tagPattern.exec(query)) !== null) {
    tags.push(match[1].toLowerCase());
  }
  
  // Time hints
  const timeHints: string[] = [];
  const timePatterns = [
    /yesterday/gi,
    /last\s+week/gi,
    /last\s+month/gi,
    /today/gi,
    /this\s+week/gi,
  ];
  
  for (const pattern of timePatterns) {
    if (pattern.test(query)) {
      timeHints.push(pattern.source);
    }
  }
  
  // Expand query with synonyms
  const expansions: Record<string, string[]> = {
    'why': ['reason', 'rationale', 'because', 'decision', 'chose'],
    'how': ['method', 'approach', 'implementation', 'process'],
    'what': ['definition', 'meaning', 'description'],
    'bug': ['error', 'issue', 'problem', 'broken', 'fix'],
    'performance': ['speed', 'slow', 'optimize', 'fast', 'latency'],
  };
  
  let expandedQuery = query.toLowerCase();
  const keywords: string[] = [];
  
  for (const [key, synonyms] of Object.entries(expansions)) {
    if (expandedQuery.includes(key)) {
      keywords.push(...synonyms);
    }
  }
  
  // Add original terms as keywords
  const words = query.toLowerCase().split(/\s+/);
  keywords.push(...words.filter(w => w.length > 2 && !w.startsWith('#')));
  
  return {
    expandedQuery: [...new Set([query, ...keywords])].join(' '),
    keywords: [...new Set(keywords)],
    timeHints,
    tags,
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  const input = {
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.substring(0, 8192),
    }),
  };
  
  const command = new InvokeModelCommand(input);
  const response = await bedrock.send(command);
  
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

async function hybridSearch(
  query: string,
  embedding: number[],
  filters: {
    tags?: string[];
    timeWindow?: string;
    user: string;
  }
): Promise<SearchHit[]> {
  // Build filter query
  const must: any[] = [
    { term: { user: filters.user } },
  ];
  
  if (filters.tags && filters.tags.length > 0) {
    must.push({
      terms: { tags: filters.tags },
    });
  }
  
  if (filters.timeWindow) {
    const fromDate = parseTimeWindow(filters.timeWindow);
    must.push({
      range: {
        created_at_epoch: {
          gte: fromDate.getTime(),
        },
      },
    });
  }
  
  // Hybrid query combining BM25 and k-NN
  const searchBody = {
    size: 100, // Get more results for reranking
    query: {
      hybrid: {
        queries: [
          // BM25 text search
          {
            multi_match: {
              query,
              fields: ['text^2', 'summary^1.5', 'tags'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
          // k-NN vector search
          {
            knn: {
              embedding: {
                vector: embedding,
                k: 50,
              },
            },
          },
        ],
      },
    },
    filter: {
      bool: { must },
    },
    highlight: {
      fields: {
        text: { fragment_size: 150, number_of_fragments: 2 },
        summary: {},
      },
    },
  };
  
  try {
    const response = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: searchBody,
    });
    
    return response.body.hits.hits as SearchHit[];
  } catch (error) {
    console.error('Search error:', error);
    
    // Fallback to BM25 only
    const fallbackBody = {
      size: 50,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query,
                fields: ['text', 'summary', 'tags'],
              },
            },
            ...must,
          ],
        },
      },
      highlight: {
        fields: {
          text: { fragment_size: 150 },
        },
      },
    };
    
    const fallbackResponse = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: fallbackBody,
    });
    
    return fallbackResponse.body.hits.hits as SearchHit[];
  }
}

/**
 * Normalize scores to 0-1 range using min-max scaling
 */
function normalizeScores<T extends { score: number }>(items: T[]): T[] {
  if (items.length === 0) return items;

  const scores = items.map(item => item.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1; // Avoid division by zero

  return items.map(item => ({
    ...item,
    score: Number(((item.score - min) / range).toFixed(3)),
  }));
}

function scoreAndRank(hits: SearchHit[]): SearchHit[] {
  // Score fusion: combine different signals
  const scoredHits = hits.map(hit => {
    const baseScore = hit._score || 0;
    const recencyScore = calculateRecencyScore(new Date(hit._source.created_at_epoch));
    const decisionScore = hit._source.decision_score || 0;
    
    // Weighted combination
    const finalScore = 
      baseScore * 0.4 +          // Search relevance
      recencyScore * 0.15 +       // Recency
      decisionScore * 0.05;       // Decision importance
    
    return {
      ...hit,
      _score: finalScore,
    };
  });
  
  // Sort by final score
  return scoredHits.sort((a, b) => b._score - a._score);
}

async function generateAnswer(
  query: string,
  context: SearchHit[]
): Promise<{ answer: string; citations: Citation[]; confidence: number }> {
  // Prepare context snippets
  const contextSnippets = context.slice(0, 6).map((hit, index) => {
    const date = new Date(hit._source.created_at_epoch).toISOString().split('T')[0];
    const preview = hit.highlight?.text?.[0] || hit._source.summary || hit._source.text.substring(0, 150);
    return `[${index + 1}] ${date} - ${preview}`;
  }).join('\n\n');
  
  const systemPrompt = `You are my memory assistant. Use ONLY the provided notes to answer questions. 
Always cite your sources using [1], [2], etc. If the notes don't contain the answer, say so.
Keep answers concise (2-3 sentences max) and directly address the question.`;
  
  const userPrompt = `Based on these notes, ${query}

Notes:
${contextSnippets}

Answer with citations:`;
  
  const input = {
    modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 300,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  };
  
  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    
    const answer = result.content[0].text.trim();
    
    // Extract which citations were used
    const citationPattern = /\[(\d+)\]/g;
    const usedCitations = new Set<number>();
    let match;
    while ((match = citationPattern.exec(answer)) !== null) {
      usedCitations.add(parseInt(match[1]) - 1);
    }
    
    // Build citation list with relevance threshold
    const MIN_CITATION_SCORE = 0.3;
    const citations: Citation[] = [];
    for (const index of usedCitations) {
      if (index < context.length) {
        const hit = context[index];
        // Only include citations above minimum relevance threshold
        if (hit._score >= MIN_CITATION_SCORE) {
          citations.push({
            id: hit._source.id,
            createdAt: new Date(hit._source.created_at_epoch).toISOString(),
            preview: hit._source.summary || hit._source.text.substring(0, 200),
            score: hit._score,
            type: hit._source.type,
            tags: hit._source.tags,
          });
        }
      }
    }
    
    // Calculate confidence based on citation count and scores
    const confidence = citations.length > 0 
      ? Math.min(0.95, citations.reduce((sum, c) => sum + c.score, 0) / citations.length)
      : 0.3;
    
    return { answer, citations, confidence };
    
  } catch (error) {
    console.error('Generation error:', error);
    
    // Fallback to extractive answer
    if (context.length > 0) {
      const topHit = context[0];
      return {
        answer: `Based on your notes: ${topHit._source.summary || topHit._source.text.substring(0, 200)}`,
        citations: [{
          id: topHit._source.id,
          createdAt: new Date(topHit._source.created_at_epoch).toISOString(),
          preview: topHit._source.text.substring(0, 200),
          score: topHit._score,
          type: topHit._source.type,
          tags: topHit._source.tags,
        }],
        confidence: 0.5,
      };
    }
    
    return {
      answer: "I couldn't find relevant information in your notes to answer this question.",
      citations: [],
      confidence: 0.1,
    };
  }
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();
  
  try {
    // Parse request
    let body: AskRequest;
    try {
      body = JSON.parse(event.body || '{}') as AskRequest;
    } catch (e) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Invalid JSON in request body',
        }),
      };
    }
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
    
    if (!body.query) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Query is required',
        }),
      };
    }
    
    // Rewrite and expand query
    const { expandedQuery, keywords, tags } = await rewriteQuery(body.query);
    
    // Generate embedding for semantic search
    const queryEmbedding = await generateEmbedding(body.query);
    
    // Perform hybrid search
    const searchResults = await hybridSearch(
      expandedQuery,
      queryEmbedding,
      {
        tags: [...(body.tags || []), ...tags],
        timeWindow: body.timeWindow,
        user,
      }
    );
    
    // Score and rank results
    const rankedResults = scoreAndRank(searchResults);

    // Separate thoughts from conversations
    const thoughtResults = rankedResults.filter(hit => hit._source.docType !== 'conversation');
    const conversationResults = rankedResults.filter(hit => hit._source.docType === 'conversation');

    // Generate answer with citations (using only thoughts for primary answer)
    const { answer, citations, confidence } = await generateAnswer(
      body.query,
      thoughtResults.length > 0 ? thoughtResults : rankedResults // Fallback to all if no thoughts
    );

    // Build conversation hits for response
    const conversationHits: ConversationHit[] = conversationResults.slice(0, 3).map(hit => {
      // Extract last Q&A exchange as preview
      const text = hit._source.text || '';
      const exchanges = text.split('\n\n');
      const lastExchange = exchanges.slice(-2).join(' → ').substring(0, 150);

      return {
        id: hit._source.id,
        title: hit._source.title || 'Untitled Conversation',
        preview: lastExchange || hit._source.summary || text.substring(0, 150),
        messageCount: hit._source.messageCount || 0,
        score: hit._score,
        createdAt: new Date(hit._source.created_at_epoch).toISOString(),
      };
    });
    
    // Emit metrics
    const processingTime = Date.now() - startTime;
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'AskLatency',
          Value: processingTime,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'CitationCount',
          Value: citations.length,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'AnswerConfidence',
          Value: confidence,
          Unit: 'None',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'AbstainRate',
          Value: citations.length === 0 ? 1 : 0,
          Unit: 'None',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
      ],
    })).catch(err => {
      console.error('Failed to emit metrics:', err);
    });
    
    // Normalize citation scores to 0-1 range for consistent API response
    const normalizedCitations = normalizeScores(citations.slice(0, body.limit || 5));
    const normalizedConversationHits = conversationHits.length > 0
      ? normalizeScores(conversationHits)
      : undefined;

    // Return response
    const response: AskResponse = {
      answer,
      citations: normalizedCitations,
      conversationHits: normalizedConversationHits,
      confidence,
      processingTime,
    };
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'X-Processing-Time': processingTime.toString(),
      },
      body: JSON.stringify(response),
    };
    
  } catch (error) {
    console.error('Error processing ask request:', error);
    
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'AskError',
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
        message: 'Failed to process question',
        requestId: event.requestContext.requestId,
      }),
    };
  }
};