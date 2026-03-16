import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutItemCommand, QueryCommand, DeleteItemCommand, UpdateItemCommand, GetItemCommand, BatchWriteItemCommand } from '@aws-sdk/client-dynamodb';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
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
} from '@ragbrain/shared';
import { encryptContent, decryptContent, EncryptionContext } from './encryption';
import {
  createBedrockClient,
  createCloudWatchClient,
  createDynamoDBClient,
  createOpenSearchClient,
  createSQSClient,
  MODELS,
  generateEmbedding,
  hybridSearch,
  scoreAndRank,
  extractCitations,
  calculateConfidence,
  emitMetrics,
  getAuthUser,
  jsonResponse,
  validationError,
  notFoundError,
  internalError,
  errorResponse,
} from '../../lib/shared';
import type { SearchHit } from '../../lib/shared';

const dynamodb = createDynamoDBClient();
const bedrock = createBedrockClient();
const cloudwatch = createCloudWatchClient();
const sqs = createSQSClient();
const opensearch = createOpenSearchClient();

const TABLE_NAME = process.env.TABLE_NAME!;
const SEARCH_COLLECTION = process.env.SEARCH_COLLECTION!;
const QUEUE_URL = process.env.QUEUE_URL;

// ── DynamoDB Types ──────────────────────────────────────────────

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
  indexedAt?: number;
}

interface DynamoMessage {
  pk: string;
  sk: string;
  id: string;
  conversationId: string;
  role: string;
  content: string; // Encrypted
  citations?: Citation[];
  searchedThoughts?: string[];
  confidence?: number;
  createdAt: number;
  user: string;
}

// ── Encryption Helpers ──────────────────────────────────────────

function encryptionContext(conversationId: string, messageId: string, userId: string): EncryptionContext {
  return { conversationId, messageId, userId };
}

async function decryptMessage(msg: DynamoMessage, user: string): Promise<string> {
  try {
    return await decryptContent(msg.content, encryptionContext(msg.conversationId, msg.id, user));
  } catch (error) {
    console.error('Decryption failed for message:', msg.id);
    return '[Decryption failed]';
  }
}

// ── Pagination Helper ───────────────────────────────────────────

function decodeCursor(cursor?: string): Record<string, any> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString());
  } catch {
    console.error('Invalid cursor');
    return undefined;
  }
}

function encodeCursor(key?: Record<string, any>): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key)).toString('base64');
}

// ── Answer Generation ───────────────────────────────────────────

async function generateConversationalAnswer(
  query: string,
  context: SearchHit[],
  history: ConversationMessage[],
): Promise<{ answer: string; citations: Citation[]; confidence: number }> {
  const historySection = history.length > 0
    ? `Previous conversation:\n${history.map(m =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      ).join('\n\n')}\n\n`
    : '';

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

  const userPrompt = `Based on these notes, ${query}\n\nNotes:\n${contextSnippets}\n\nAnswer with citations:`;

  try {
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: MODELS.FAST,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 400,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    }));

    const result = JSON.parse(new TextDecoder().decode(response.body));
    const answer = result.content[0].text.trim();
    const citations = extractCitations(answer, context);
    const confidence = calculateConfidence(citations);

    return { answer, citations, confidence };
  } catch (error) {
    console.error('Answer generation failed:', error);

    if (context.length > 0) {
      const top = context[0];
      return {
        answer: `Based on your notes: ${top._source.summary || top._source.text.substring(0, 200)}`,
        citations: [{
          id: top._source.id,
          createdAt: new Date(top._source.created_at_epoch).toISOString(),
          preview: top._source.text.substring(0, 200),
          score: top._score,
          type: top._source.type,
          tags: top._source.tags,
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

// ── Message Processing ──────────────────────────────────────────

async function processMessage(
  conversationId: string,
  user: string,
  content: string,
  tags?: string[],
  timeWindow?: string,
  includeHistory: number = 10,
): Promise<{ userMessage: ConversationMessage; assistantMessage: ConversationMessage }> {
  const now = Date.now();

  // 1. Fetch and decrypt conversation history
  const historyResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: { ':pk': { S: `conv#${conversationId}` }, ':skPrefix': { S: 'msg#' } },
    Limit: includeHistory,
    ScanIndexForward: false,
  }));

  const history: ConversationMessage[] = [];
  for (const item of (historyResult.Items || []).reverse()) {
    const msg = unmarshall(item) as DynamoMessage;
    const decrypted = await decryptMessage(msg, user);
    if (decrypted !== '[Decryption failed]') {
      history.push({
        id: msg.id,
        conversationId: msg.conversationId,
        role: msg.role as 'user' | 'assistant',
        content: decrypted,
        citations: msg.citations,
        createdAt: new Date(msg.createdAt).toISOString(),
      });
    }
  }

  // 2. Encrypt and store user message
  const userMessageId = `msg_${uuidv4()}`;
  const encryptedUser = await encryptContent(content, encryptionContext(conversationId, userMessageId, user));

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `conv#${conversationId}`,
      sk: `msg#${now}#${userMessageId}`,
      id: userMessageId,
      conversationId,
      role: 'user',
      content: encryptedUser,
      createdAt: now,
      user,
    }),
  }));

  // 3. Search for relevant thoughts
  const embedding = await generateEmbedding(bedrock, content);
  const searchResults = await hybridSearch(
    opensearch, SEARCH_COLLECTION, content, embedding,
    { user, tags, timeWindow },
    { size: 50, knnK: 25 },
  );
  const rankedResults = scoreAndRank(searchResults);

  // 4. Generate answer with conversation context
  const { answer, citations, confidence } = await generateConversationalAnswer(content, rankedResults, history);

  // 5. Encrypt and store assistant message
  const assistantMessageId = `msg_${uuidv4()}`;
  const assistantNow = Date.now();
  const encryptedAssistant = await encryptContent(answer, encryptionContext(conversationId, assistantMessageId, user));
  const searchedThoughtIds = rankedResults.slice(0, 6).map(r => r._source.id);

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `conv#${conversationId}`,
      sk: `msg#${assistantNow}#${assistantMessageId}`,
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: encryptedAssistant,
      citations,
      searchedThoughts: searchedThoughtIds,
      confidence,
      createdAt: assistantNow,
      user,
    }),
  }));

  // 6. Update conversation metadata
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
    UpdateExpression: 'SET updatedAt = :now, messageCount = messageCount + :inc, gsi3sk = :gsi3sk',
    ExpressionAttributeValues: {
      ':now': { N: assistantNow.toString() },
      ':inc': { N: '2' },
      ':gsi3sk': { S: `updated#${assistantNow}` },
    },
  }));

  // 7. Queue for indexing (debounced)
  if (QUEUE_URL) {
    try {
      const convCheck = await dynamodb.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
        ProjectionExpression: 'indexedAt',
      }));
      const lastIndexed = convCheck.Item?.indexedAt?.N ? parseInt(convCheck.Item.indexedAt.N) : 0;

      if (Date.now() - lastIndexed > 10000) {
        await sqs.send(new SendMessageCommand({
          QueueUrl: QUEUE_URL,
          MessageBody: JSON.stringify({ type: 'conversation', conversationId, user }),
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
      content,
      createdAt: new Date(now).toISOString(),
    },
    assistantMessage: {
      id: assistantMessageId,
      conversationId,
      role: 'assistant',
      content: answer,
      citations,
      searchedThoughts: searchedThoughtIds,
      confidence,
      createdAt: new Date(assistantNow).toISOString(),
    },
  };
}

// ── Route Handlers ──────────────────────────────────────────────

async function createConversation(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  let body: CreateConversationRequest;
  try { body = JSON.parse(event.body || '{}'); } catch { return validationError('Invalid JSON'); }

  const conversationId = `conv_${uuidv4()}`;
  const now = Date.now();
  const title = body.title || `Conversation ${new Date().toLocaleDateString()}`;

  await dynamodb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `user#${user}`, sk: `conv#${conversationId}`,
      id: conversationId, title, createdAt: now, updatedAt: now,
      messageCount: 0, status: 'active',
      gsi3pk: `user#${user}`, gsi3sk: `updated#${now}`,
    }),
  }));

  let messages: ConversationMessage[] | undefined;
  if (body.initialMessage) {
    const result = await processMessage(conversationId, user, body.initialMessage, body.context?.tags, body.context?.timeWindow, 10);
    messages = [result.userMessage, result.assistantMessage];
  }

  return jsonResponse(201, {
    id: conversationId,
    title,
    createdAt: new Date(now).toISOString(),
    messages,
  } as CreateConversationResponse);
}

async function listConversations(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters || {};
  const limit = parseInt(params.limit || '20');
  const status = params.status || 'active';

  const queryParams: any = {
    TableName: TABLE_NAME,
    IndexName: 'gsi3',
    KeyConditionExpression: 'gsi3pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `user#${user}` } },
    Limit: limit,
    ScanIndexForward: false,
    ExclusiveStartKey: decodeCursor(params.cursor),
  };

  if (status !== 'all') {
    queryParams.FilterExpression = '#status = :status';
    queryParams.ExpressionAttributeNames = { '#status': 'status' };
    queryParams.ExpressionAttributeValues[':status'] = { S: status };
  }

  const result = await dynamodb.send(new QueryCommand(queryParams));

  const conversations: ConversationSummary[] = (result.Items || []).map(item => {
    const conv = unmarshall(item) as DynamoConversation;
    return {
      id: conv.id, title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messageCount: conv.messageCount,
      status: conv.status as 'active' | 'archived',
    };
  });

  const nextCursor = encodeCursor(result.LastEvaluatedKey);
  return jsonResponse(200, { conversations, cursor: nextCursor, hasMore: !!nextCursor } as ListConversationsResponse);
}

async function getConversation(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) return validationError('Conversation ID is required');

  const convResult = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
  }));

  if (!convResult.Item) return notFoundError('Conversation not found');
  const conv = unmarshall(convResult.Item) as DynamoConversation;

  const params = event.queryStringParameters || {};
  const limit = parseInt(params.limit || '50');

  const msgResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: { ':pk': { S: `conv#${conversationId}` }, ':skPrefix': { S: 'msg#' } },
    Limit: limit,
    ScanIndexForward: true,
    ExclusiveStartKey: decodeCursor(params.cursor),
  }));

  const messages: ConversationMessage[] = [];
  for (const item of msgResult.Items || []) {
    const msg = unmarshall(item) as DynamoMessage;
    const content = await decryptMessage(msg, user);

    const message: ConversationMessage = {
      id: msg.id, conversationId: msg.conversationId,
      role: msg.role as 'user' | 'assistant',
      content,
      createdAt: new Date(msg.createdAt).toISOString(),
    };
    if (msg.citations?.length) message.citations = msg.citations;
    if (msg.searchedThoughts?.length) message.searchedThoughts = msg.searchedThoughts;
    if (msg.confidence != null) message.confidence = msg.confidence;

    messages.push(message);
  }

  const nextCursor = encodeCursor(msgResult.LastEvaluatedKey);
  return jsonResponse(200, {
    conversation: {
      id: conv.id, user, title: conv.title,
      createdAt: new Date(conv.createdAt).toISOString(),
      updatedAt: new Date(conv.updatedAt).toISOString(),
      messageCount: conv.messageCount,
      status: conv.status as 'active' | 'archived',
    },
    messages, cursor: nextCursor, hasMore: !!nextCursor,
  } as GetConversationResponse);
}

async function sendMessage(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  const startTime = Date.now();
  const conversationId = event.pathParameters?.id;
  if (!conversationId) return validationError('Conversation ID is required');

  let body: SendMessageRequest;
  try { body = JSON.parse(event.body || '{}'); } catch { return validationError('Invalid JSON'); }
  if (!body.content) return validationError('Message content is required');

  // Verify conversation exists
  const convResult = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
  }));
  if (!convResult.Item) return notFoundError('Conversation not found');

  try {
    const result = await processMessage(conversationId, user, body.content, body.tags, body.timeWindow, body.includeHistory || 10);
    const processingTime = Date.now() - startTime;

    await emitMetrics(cloudwatch, [
      { name: 'ConversationMessageLatency', value: processingTime, unit: 'Milliseconds' },
    ]);

    return jsonResponse(200, {
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      processingTime,
    } as SendMessageResponse);
  } catch (error) {
    console.error('Error processing message:', error);
    return internalError('Failed to process message');
  }
}

async function updateConversation(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) return validationError('Conversation ID is required');

  let body: UpdateConversationRequest;
  try { body = JSON.parse(event.body || '{}'); } catch { return validationError('Invalid JSON'); }

  const updates: string[] = [];
  const values: any = {};
  const names: any = {};

  if (body.title) { updates.push('#title = :title'); names['#title'] = 'title'; values[':title'] = { S: body.title }; }
  if (body.status) { updates.push('#status = :status'); names['#status'] = 'status'; values[':status'] = { S: body.status }; }
  if (updates.length === 0) return validationError('No fields to update');

  try {
    await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(pk)',
    }));
    return jsonResponse(200, { message: 'Conversation updated' });
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') return notFoundError('Conversation not found');
    throw error;
  }
}

async function deleteConversation(event: APIGatewayProxyEventV2, user: string): Promise<APIGatewayProxyResultV2> {
  const conversationId = event.pathParameters?.id;
  if (!conversationId) return validationError('Conversation ID is required');

  const existing = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
  }));
  if (!existing.Item) return notFoundError('Conversation not found');

  // Batch delete messages
  const msgResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: `conv#${conversationId}` } },
  }));

  const messages = msgResult.Items || [];
  for (let i = 0; i < messages.length; i += 25) {
    await dynamodb.send(new BatchWriteItemCommand({
      RequestItems: {
        [TABLE_NAME]: messages.slice(i, i + 25).map(item => ({
          DeleteRequest: { Key: { pk: item.pk, sk: item.sk } },
        })),
      },
    }));
  }

  try {
    await dynamodb.send(new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: `user#${user}`, sk: `conv#${conversationId}` }),
      ConditionExpression: 'attribute_exists(pk)',
    }));
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') return notFoundError('Conversation not found');
    throw error;
  }

  return jsonResponse(200, { message: 'Conversation deleted' });
}

// ── Router ──────────────────────────────────────────────────────

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath || '';

  const userOrError = getAuthUser(event);
  if (typeof userOrError !== 'string') return userOrError;
  const user = userOrError;

  console.log(`${method} ${path} - user: ${user}`);

  try {
    if (method === 'POST' && path.includes('/messages')) return sendMessage(event, user);
    if (method === 'POST' && path.match(/\/conversations$/)) return createConversation(event, user);
    if (method === 'GET' && path.match(/\/conversations$/)) return listConversations(event, user);
    if (method === 'GET' && path.includes('/conversations/') && !path.includes('/messages')) return getConversation(event, user);
    if (method === 'PUT' && path.includes('/conversations/')) return updateConversation(event, user);
    if (method === 'DELETE' && path.includes('/conversations/')) return deleteConversation(event, user);

    return errorResponse(404, 'NotFound', 'Route not found');
  } catch (error) {
    console.error('Handler error:', error);
    return internalError('An unexpected error occurred');
  }
};
