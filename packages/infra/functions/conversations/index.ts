import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateConversationRequest,
  CreateConversationResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetConversationResponse,
  ListConversationsResponse,
  UpdateConversationRequest,
  ConversationMessage,
  ConversationSummary,
  Citation,
  parseTimeWindow,
  calculateRecencyScore,
} from '@ragbrain/shared';
import { encryptContent, decryptContent, EncryptionContext } from './encryption';

const dynamodb = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const cloudwatch = new CloudWatchClient({});
const sqs = new SQSClient({});

const {
  TABLE_NAME,
  SEARCH_ENDPOINT,
  SEARCH_COLLECTION,
  PROJECT_NAME,
  ENVIRONMENT,
  AWS_REGION,
  QUEUE_URL,
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

// ============ DynamoDB Types ============

interface DynamoConversation {
  pk: string;
  sk: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: string;
  gsi3pk: string;
  gsi3sk: string;
  ttl?: number;
}

interface DynamoMessage {
  pk: string;
  sk: string;
  id: string;
  conversationId: string;
  role: string;
  content: string; // Encrypted
  citations?: any[];
  searchedThoughts?: string[];
  confidence?: number;
  createdAt: number;
  user: string;
}

// ============ Search Types ============

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
    user: string;
  };
  highlight?: {
    text?: string[];
    summary?: string[];
  };
}

// ============ Helper Functions ============

function jsonResponse(statusCode: number, body: any): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode: number, error: string, message: string): APIGatewayProxyResultV2 {
  return jsonResponse(statusCode, { error, message });
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
  filters: { user: string; tags?: string[]; timeWindow?: string }
): Promise<SearchHit[]> {
  const must: any[] = [
    { term: { user: filters.user } },
  ];

  if (filters.tags && filters.tags.length > 0) {
    must.push({ terms: { tags: filters.tags } });
  }

  if (filters.timeWindow) {
    const fromDate = parseTimeWindow(filters.timeWindow);
    must.push({
      range: {
        created_at_epoch: { gte: fromDate.getTime() },
      },
    });
  }

  try {
    // Try hybrid search first
    const searchBody = {
      size: 50,
      query: {
        hybrid: {
          queries: [
            {
              multi_match: {
                query,
                fields: ['text^2', 'summary^1.5', 'tags'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
            {
              knn: {
                embedding: {
                  vector: embedding,
                  k: 25,
                },
              },
            },
          ],
        },
      },
      filter: { bool: { must } },
    };

    const response = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: searchBody,
    });

    return response.body.hits.hits as SearchHit[];
  } catch (error) {
    console.error('Hybrid search failed, falling back to BM25:', error);

    // Fallback to BM25 only
    const fallbackBody = {
      size: 25,
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
    };

    const fallbackResponse = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: fallbackBody,
    });

    return fallbackResponse.body.hits.hits as SearchHit[];
  }
}

function scoreAndRank(hits: SearchHit[]): SearchHit[] {
  const scoredHits = hits.map(hit => {
    const baseScore = hit._score || 0;
    const recencyScore = calculateRecencyScore(new Date(hit._source.created_at_epoch));
    const decisionScore = hit._source.decision_score || 0;

    const finalScore =
      baseScore * 0.4 +
      recencyScore * 0.15 +
      decisionScore * 0.05;

    return { ...hit, _score: finalScore };
  });

  return scoredHits.sort((a, b) => b._score - a._score);
}

async function generateConversationalAnswer(
  query: string,
  context: SearchHit[],
  history: ConversationMessage[]
): Promise<{ answer: string; citations: Citation[]; confidence: number }> {
  // Build history section
  const historySection = history.length > 0
    ? `Previous conversation:\n${history.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n\n')}\n\n`
    : '';

  // Build context snippets from search results
  const contextSnippets = context.slice(0, 6).map((hit, index) => {
    const date = new Date(hit._source.created_at_epoch).toISOString().split('T')[0];
    const preview = hit._source.summary || hit._source.text.substring(0, 150);
    return `[${index + 1}] ${date} - ${preview}`;
  }).join('\n\n');

  const systemPrompt = `You are my memory assistant with access to my personal notes and our conversation history.

${historySection}Guidelines:
1. Use ONLY the provided notes to answer questions - cite sources using [1], [2], etc.
2. Consider conversation history for context and follow-up questions
3. If the user refers to "that", "it", or previous topics, use conversation context
4. If notes don't contain the answer, say so honestly
5. Keep answers concise (2-3 sentences max) unless asked for more detail
6. Never fabricate information - only reference actual notes`;

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
      max_tokens: 400,
      temperature: 0.3,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  };

  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));

    const answer = result.content[0].text.trim();

    // Extract citations
    const citationPattern = /\[(\d+)\]/g;
    const usedCitations = new Set<number>();
    let match;
    while ((match = citationPattern.exec(answer)) !== null) {
      usedCitations.add(parseInt(match[1]) - 1);
    }

    const citations: Citation[] = [];
    for (const index of usedCitations) {
      if (index < context.length) {
        const hit = context[index];
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

    const confidence = citations.length > 0
      ? Math.min(0.95, citations.reduce((sum, c) => sum + c.score, 0) / citations.length)
      : 0.3;

    return { answer, citations, confidence };
  } catch (error) {
    console.error('Answer generation failed:', error);

    // Fallback
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

// ============ Conversation Handlers ============

async function createConversation(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  let body: CreateConversationRequest;
  try {
    body = JSON.parse(event.body || '{}') as CreateConversationRequest;
  } catch (e) {
    return errorResponse(400, 'ValidationError', 'Invalid JSON in request body');
  }

  const conversationId = `conv_${uuidv4()}`;
  const now = Date.now();
  const title = body.title || `Conversation ${new Date().toLocaleDateString()}`;

  const conversation: DynamoConversation = {
    pk: `user#${user}`,
    sk: `conv#${conversationId}`,
    id: conversationId,
    title,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    status: 'active',
    gsi3pk: `user#${user}`,
    gsi3sk: `updated#${now}`,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(conversation),
  }));

  let messages: ConversationMessage[] | undefined;

  // Handle initial message if provided
  if (body.initialMessage) {
    const sendResult = await processMessage(
      conversationId,
      user,
      body.initialMessage,
      body.context?.tags,
      body.context?.timeWindow,
      10
    );
    messages = [sendResult.userMessage, sendResult.assistantMessage];
  }

  const response: CreateConversationResponse = {
    id: conversationId,
    title,
    createdAt: new Date(now).toISOString(),
    messages,
  };

  return jsonResponse(201, response);
}

async function listConversations(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const limit = parseInt(event.queryStringParameters?.limit || '20');
  const cursor = event.queryStringParameters?.cursor;
  const status = event.queryStringParameters?.status || 'active';

  const queryParams: any = {
    TableName: TABLE_NAME,
    IndexName: 'gsi3',
    KeyConditionExpression: 'gsi3pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `user#${user}` },
    },
    Limit: limit,
    ScanIndexForward: false, // Most recent first
  };

  if (status !== 'all') {
    queryParams.FilterExpression = '#status = :status';
    queryParams.ExpressionAttributeNames = { '#status': 'status' };
    queryParams.ExpressionAttributeValues[':status'] = { S: status };
  }

  if (cursor) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch (e) {
      console.error('Invalid cursor:', e);
    }
  }

  const result = await dynamodb.send(new QueryCommand(queryParams));

  const conversations: ConversationSummary[] = (result.Items || []).map(item => {
    const conv = unmarshall(item) as DynamoConversation;
    return {
      id: conv.id,
      title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messageCount: conv.messageCount,
      status: conv.status as 'active' | 'archived',
    };
  });

  let nextCursor: string | undefined;
  if (result.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  const response: ListConversationsResponse = {
    conversations,
    cursor: nextCursor,
    hasMore: !!nextCursor,
  };

  return jsonResponse(200, response);
}

async function getConversation(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) {
    return errorResponse(400, 'ValidationError', 'Conversation ID is required');
  }

  // Get conversation metadata
  const convResult = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
  }));

  if (!convResult.Item) {
    return errorResponse(404, 'NotFound', 'Conversation not found');
  }

  const conv = unmarshall(convResult.Item) as DynamoConversation;

  // Get messages
  const limit = parseInt(event.queryStringParameters?.limit || '50');
  const cursor = event.queryStringParameters?.cursor;

  const msgQueryParams: any = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `conv#${conversationId}` },
      ':skPrefix': { S: 'msg#' },
    },
    Limit: limit,
    ScanIndexForward: true, // Chronological order
  };

  if (cursor) {
    try {
      msgQueryParams.ExclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
    } catch (e) {
      console.error('Invalid cursor:', e);
    }
  }

  const msgResult = await dynamodb.send(new QueryCommand(msgQueryParams));

  // Decrypt messages
  const messages: ConversationMessage[] = [];
  for (const item of msgResult.Items || []) {
    const msg = unmarshall(item) as DynamoMessage;
    const encContext: EncryptionContext = {
      conversationId: msg.conversationId,
      messageId: msg.id,
      userId: user,
    };

    let content: string;
    try {
      content = await decryptContent(msg.content, encContext);
    } catch (error) {
      console.error('Decryption failed for message:', msg.id);
      content = '[Decryption failed]';
    }

    // Build message with only defined fields (avoid null/undefined in response)
    const message: ConversationMessage = {
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role as 'user' | 'assistant',
      content,
      createdAt: new Date(msg.createdAt).toISOString(),
    };

    // Only include optional fields if they exist
    if (msg.citations && msg.citations.length > 0) {
      message.citations = msg.citations;
    }
    if (msg.searchedThoughts && msg.searchedThoughts.length > 0) {
      message.searchedThoughts = msg.searchedThoughts;
    }
    if (msg.confidence !== undefined && msg.confidence !== null) {
      message.confidence = msg.confidence;
    }

    messages.push(message);
  }

  let nextCursor: string | undefined;
  if (msgResult.LastEvaluatedKey) {
    nextCursor = Buffer.from(JSON.stringify(msgResult.LastEvaluatedKey)).toString('base64');
  }

  const response: GetConversationResponse = {
    conversation: {
      id: conv.id,
      user,
      title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messageCount: conv.messageCount,
      status: conv.status as 'active' | 'archived',
    },
    messages,
    cursor: nextCursor,
    hasMore: !!nextCursor,
  };

  return jsonResponse(200, response);
}

async function processMessage(
  conversationId: string,
  user: string,
  content: string,
  tags?: string[],
  timeWindow?: string,
  includeHistory: number = 10
): Promise<{ userMessage: ConversationMessage; assistantMessage: ConversationMessage }> {
  const now = Date.now();

  // Fetch conversation history
  const historyResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `conv#${conversationId}` },
      ':skPrefix': { S: 'msg#' },
    },
    Limit: includeHistory,
    ScanIndexForward: false, // Most recent first
  }));

  // Decrypt and reverse to chronological order
  const history: ConversationMessage[] = [];
  const historyItems = (historyResult.Items || []).reverse();
  for (const item of historyItems) {
    const msg = unmarshall(item) as DynamoMessage;
    const encContext: EncryptionContext = {
      conversationId: msg.conversationId,
      messageId: msg.id,
      userId: user,
    };

    try {
      const decryptedContent = await decryptContent(msg.content, encContext);
      history.push({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role as 'user' | 'assistant',
        content: decryptedContent,
        citations: msg.citations,
        createdAt: new Date(msg.createdAt).toISOString(),
      });
    } catch (error) {
      console.error('Failed to decrypt history message:', msg.id);
    }
  }

  // Generate user message
  const userMessageId = `msg_${uuidv4()}`;
  const userEncContext: EncryptionContext = {
    conversationId,
    messageId: userMessageId,
    userId: user,
  };
  const encryptedUserContent = await encryptContent(content, userEncContext);

  const userDynamoMsg: DynamoMessage = {
    pk: `conv#${conversationId}`,
    sk: `msg#${now}#${userMessageId}`,
    id: userMessageId,
    conversationId,
    role: 'user',
    content: encryptedUserContent,
    createdAt: now,
    user,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(userDynamoMsg),
  }));

  // Search for relevant thoughts
  const embedding = await generateEmbedding(content);
  const searchResults = await hybridSearch(content, embedding, {
    user,
    tags,
    timeWindow,
  });
  const rankedResults = scoreAndRank(searchResults);

  // Generate answer with conversation context
  const { answer, citations, confidence } = await generateConversationalAnswer(
    content,
    rankedResults,
    history
  );

  // Store assistant message
  const assistantMessageId = `msg_${uuidv4()}`;
  const assistantNow = Date.now();
  const assistantEncContext: EncryptionContext = {
    conversationId,
    messageId: assistantMessageId,
    userId: user,
  };
  const encryptedAssistantContent = await encryptContent(answer, assistantEncContext);

  const assistantDynamoMsg: DynamoMessage = {
    pk: `conv#${conversationId}`,
    sk: `msg#${assistantNow}#${assistantMessageId}`,
    id: assistantMessageId,
    conversationId,
    role: 'assistant',
    content: encryptedAssistantContent,
    citations,
    searchedThoughts: rankedResults.slice(0, 6).map(r => r._source.id),
    confidence,
    createdAt: assistantNow,
    user,
  };

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(assistantDynamoMsg),
  }));

  // Update conversation metadata
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
    UpdateExpression: 'SET updatedAt = :now, messageCount = messageCount + :inc, gsi3sk = :gsi3sk',
    ExpressionAttributeValues: {
      ':now': { N: assistantNow.toString() },
      ':inc': { N: '2' },
      ':gsi3sk': { S: `updated#${assistantNow}` },
    },
  }));

  // Queue for indexing with debouncing (10 second minimum between re-indexes)
  // Safe margin: indexer has 10 reserved concurrency and SQS batching (5 msgs/5s)
  const INDEXING_DEBOUNCE_MS = 10000;

  if (QUEUE_URL) {
    try {
      // Check last indexed timestamp to debounce
      const convCheck = await dynamodb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({
          pk: `user#${user}`,
          sk: `conv#${conversationId}`,
        }),
        ProjectionExpression: 'indexedAt',
      }));

      const lastIndexed = convCheck.Item?.indexedAt?.N
        ? parseInt(convCheck.Item.indexedAt.N)
        : 0;

      // Only queue if last index was > debounce threshold ago
      if (Date.now() - lastIndexed > INDEXING_DEBOUNCE_MS) {
        await sqs.send(new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({
            type: 'conversation',
            conversationId,
            user,
          }),
        }));
      }
    } catch (error) {
      console.error('Failed to queue conversation for indexing:', error);
    }
  }

  return {
    userMessage: {
      id: userMessageId,
      conversationId,
      role: 'user',
      content, // Return plaintext
      createdAt: new Date(now).toISOString(),
    },
    assistantMessage: {
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: answer, // Return plaintext
      citations,
      searchedThoughts: rankedResults.slice(0, 6).map(r => r._source.id),
      confidence,
      createdAt: new Date(assistantNow).toISOString(),
    },
  };
}

async function sendMessage(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const startTime = Date.now();
  const conversationId = event.pathParameters?.id;

  if (!conversationId) {
    return errorResponse(400, 'ValidationError', 'Conversation ID is required');
  }

  let body: SendMessageRequest;
  try {
    body = JSON.parse(event.body || '{}') as SendMessageRequest;
  } catch (e) {
    return errorResponse(400, 'ValidationError', 'Invalid JSON in request body');
  }
  if (!body.content) {
    return errorResponse(400, 'ValidationError', 'Message content is required');
  }

  // Verify conversation exists and belongs to user
  const convResult = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
  }));

  if (!convResult.Item) {
    return errorResponse(404, 'NotFound', 'Conversation not found');
  }

  try {
    const result = await processMessage(
      conversationId,
      user,
      body.content,
      body.tags,
      body.timeWindow,
      body.includeHistory || 10
    );

    const processingTime = Date.now() - startTime;

    // Emit metrics
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'ConversationMessageLatency',
          Value: processingTime,
          Unit: 'Milliseconds',
          Dimensions: [{ Name: 'Environment', Value: ENVIRONMENT }],
        },
      ],
    })).catch(err => console.error('Metrics error:', err));

    const response: SendMessageResponse = {
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      processingTime,
    };

    return jsonResponse(200, response);
  } catch (error) {
    console.error('Error processing message:', error);
    return errorResponse(500, 'InternalServerError', 'Failed to process message');
  }
}

async function updateConversation(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) {
    return errorResponse(400, 'ValidationError', 'Conversation ID is required');
  }

  let body: UpdateConversationRequest;
  try {
    body = JSON.parse(event.body || '{}') as UpdateConversationRequest;
  } catch (e) {
    return errorResponse(400, 'ValidationError', 'Invalid JSON in request body');
  }

  const updateExpressions: string[] = [];
  const expressionAttributeValues: any = {};
  const expressionAttributeNames: any = {};

  if (body.title) {
    updateExpressions.push('#title = :title');
    expressionAttributeNames['#title'] = 'title';
    expressionAttributeValues[':title'] = { S: body.title };
  }

  if (body.status) {
    updateExpressions.push('#status = :status');
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = { S: body.status };
  }

  if (updateExpressions.length === 0) {
    return errorResponse(400, 'ValidationError', 'No fields to update');
  }

  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `user#${user}`,
        sk: `conv#${conversationId}`,
      }),
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: 'attribute_exists(pk)',
    }));

    return jsonResponse(200, { message: 'Conversation updated' });
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return errorResponse(404, 'NotFound', 'Conversation not found');
    }
    throw error;
  }
}

async function deleteConversation(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) {
    return errorResponse(400, 'ValidationError', 'Conversation ID is required');
  }

  // First verify the conversation exists and belongs to user
  const existingConv = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
  }));

  if (!existingConv.Item) {
    return errorResponse(404, 'NotFound', 'Conversation not found');
  }

  // Get all messages to delete
  const msgResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: `conv#${conversationId}` },
    },
  }));

  // Batch delete messages (25 at a time - DynamoDB limit)
  const messages = msgResult.Items || [];
  for (let i = 0; i < messages.length; i += 25) {
    const batch = messages.slice(i, i + 25);
    await dynamodb.send(new BatchWriteItemCommand({
      RequestItems: {
        [TABLE_NAME!]: batch.map(item => ({
          DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
        })),
      },
    }));
  }

  // Delete conversation record with condition to ensure it still exists
  try {
    await dynamodb.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({
        pk: `user#${user}`,
        sk: `conv#${conversationId}`,
      }),
      ConditionExpression: 'attribute_exists(pk)',
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return errorResponse(404, 'NotFound', 'Conversation not found');
    }
    throw error;
  }

  return jsonResponse(200, { message: 'Conversation deleted' });
}

// ============ Main Handler ============

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath || '';
  const user = event.requestContext.authorizer?.lambda?.user;
  if (!user) {
    console.error('CRITICAL: User context missing from authorizer');
    return errorResponse(500, 'InternalServerError', 'Authentication context missing');
  }

  console.log(`${method} ${path} - user: ${user}`);

  try {
    // POST /conversations/{id}/messages - Send message (check first as it's most specific)
    if (method === 'POST' && path.includes('/messages')) {
      return sendMessage(event, user);
    }

    // POST /conversations - Create (path ends with /conversations)
    if (method === 'POST' && path.match(/\/conversations$/)) {
      return createConversation(event, user);
    }

    // GET /conversations - List (path ends with /conversations)
    if (method === 'GET' && path.match(/\/conversations$/)) {
      return listConversations(event, user);
    }

    // GET /conversations/{id} - Get with messages
    if (method === 'GET' && path.includes('/conversations/') && !path.includes('/messages')) {
      return getConversation(event, user);
    }

    // PUT /conversations/{id} - Update
    if (method === 'PUT' && path.includes('/conversations/')) {
      return updateConversation(event, user);
    }

    // DELETE /conversations/{id} - Delete
    if (method === 'DELETE' && path.includes('/conversations/')) {
      return deleteConversation(event, user);
    }

    return errorResponse(404, 'NotFound', 'Route not found');
  } catch (error) {
    console.error('Handler error:', error);
    return errorResponse(500, 'InternalServerError', 'An unexpected error occurred');
  }
};
