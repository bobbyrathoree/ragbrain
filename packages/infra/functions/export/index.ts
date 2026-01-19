import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import {
  generateThoughtSmartId,
  generateConversationSmartId,
} from '@ragbrain/shared';

const dynamodb = new DynamoDBClient({});
const kms = new KMSClient({});

const { TABLE_NAME, KMS_KEY_ARN } = process.env;

// ============ Types ============

interface ThoughtExport {
  id: string;
  smartId: string;
  text: string;
  type: string;
  tags: string[];
  category?: string;
  intent?: string;
  context?: {
    app?: string;
    repo?: string;
    file?: string;
  };
  relatedIds: string[];
  createdAt: string;
  updatedAt?: string;
}

interface MessageExport {
  role: 'user' | 'assistant';
  content: string;
  citations?: Array<{
    id: string;
    preview: string;
    createdAt: string;
  }>;
  createdAt: string;
}

interface ConversationExport {
  id: string;
  smartId: string;
  title: string;
  messages: MessageExport[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ExportResponse {
  thoughts: ThoughtExport[];
  conversations: ConversationExport[];
  deleted: string[]; // IDs that were deleted since last sync
  syncTimestamp: number;
}

// ============ DynamoDB Types ============

interface DynamoThought {
  pk: string;
  sk: string;
  id: string;
  text: string;
  type: string;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
  context?: any;
  summary?: string;
  autoTags?: string[];
  category?: string;
  intent?: string;
  entities?: string[];
  relatedIds?: string[];
  deletedAt?: number;
}

interface DynamoConversation {
  pk: string;
  sk: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: string;
  deletedAt?: number;
}

interface DynamoMessage {
  pk: string;
  sk: string;
  id: string;
  conversationId: string;
  role: string;
  content: string; // Encrypted
  citations?: any[];
  createdAt: number;
  user: string;
}

interface EncryptionContext {
  conversationId: string;
  messageId: string;
  userId: string;
}

// ============ Helpers ============

function jsonResponse(statusCode: number, body: any): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function decryptContent(ciphertext: string, context: EncryptionContext): Promise<string> {
  const response = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    EncryptionContext: {
      conversationId: context.conversationId,
      messageId: context.messageId,
      userId: context.userId,
    },
  }));

  if (!response.Plaintext) {
    throw new Error('KMS decryption failed');
  }

  return new TextDecoder().decode(response.Plaintext);
}

// ============ Main Export Logic ============

async function exportThoughts(user: string, since: number): Promise<ThoughtExport[]> {
  const thoughts: ThoughtExport[] = [];
  let lastEvaluatedKey: any = undefined;

  do {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
      FilterExpression: since > 0
        ? '(attribute_not_exists(deletedAt) OR deletedAt = :zero) AND (createdAt >= :since OR (attribute_exists(updatedAt) AND updatedAt >= :since))'
        : 'attribute_not_exists(deletedAt) OR deletedAt = :zero',
      ExpressionAttributeValues: {
        ':pk': { S: `user#${user}` },
        ':skPrefix': { S: 'ts#' },
        ':zero': { N: '0' },
        ...(since > 0 ? { ':since': { N: since.toString() } } : {}),
      },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 100,
    }));

    for (const item of result.Items || []) {
      const thought = unmarshall(item) as DynamoThought;

      // Combine user tags and auto-generated tags
      // Handle both array and Set formats from DynamoDB
      const userTags = Array.isArray(thought.tags) ? thought.tags : [...(thought.tags || [])];
      const autoTags = Array.isArray(thought.autoTags) ? thought.autoTags : [...(thought.autoTags || [])];
      const allTags = [...new Set([...userTags, ...autoTags])].filter(t => t && t !== 'none');

      // Combine related IDs - handle both array and Set formats
      const rawRelatedIds = thought.relatedIds;
      const relatedIds = (Array.isArray(rawRelatedIds) ? rawRelatedIds : [...(rawRelatedIds || [])])
        .filter(id => id && id !== 'none');

      thoughts.push({
        id: thought.id,
        smartId: generateThoughtSmartId(thought.text, thought.id),
        text: thought.text,
        type: thought.type,
        tags: allTags,
        category: thought.category,
        intent: thought.intent,
        context: thought.context,
        relatedIds,
        createdAt: new Date(thought.createdAt).toISOString(),
        updatedAt: thought.updatedAt
          ? new Date(thought.updatedAt).toISOString()
          : undefined,
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return thoughts;
}

async function exportConversations(user: string, since: number): Promise<ConversationExport[]> {
  const conversations: ConversationExport[] = [];

  // Query conversations using GSI3
  let lastEvaluatedKey: any = undefined;

  do {
    const result = await dynamodb.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'gsi3',
      KeyConditionExpression: 'gsi3pk = :pk',
      FilterExpression: since > 0
        ? '(attribute_not_exists(deletedAt) OR deletedAt = :zero) AND updatedAt >= :since'
        : 'attribute_not_exists(deletedAt) OR deletedAt = :zero',
      ExpressionAttributeValues: {
        ':pk': { S: `user#${user}` },
        ':zero': { N: '0' },
        ...(since > 0 ? { ':since': { N: since.toString() } } : {}),
      },
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: 50,
    }));

    for (const item of result.Items || []) {
      const conv = unmarshall(item) as DynamoConversation;

      // Skip if it's a thought (GSI3 might have mixed content)
      if (!conv.id?.startsWith('conv_')) continue;

      // Fetch and decrypt messages
      const messages = await fetchConversationMessages(conv.id, user);

      conversations.push({
        id: conv.id,
        smartId: generateConversationSmartId(conv.title, conv.id),
        title: conv.title,
        messages,
        status: conv.status,
        createdAt: new Date(conv.createdAt).toISOString(),
        updatedAt: new Date(conv.updatedAt).toISOString(),
      });
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return conversations;
}

// Batch size for parallel KMS decryption (avoid overwhelming KMS)
const DECRYPT_BATCH_SIZE = 10;

async function fetchConversationMessages(
  conversationId: string,
  user: string
): Promise<MessageExport[]> {
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `conv#${conversationId}` },
      ':skPrefix': { S: 'msg#' },
    },
    ScanIndexForward: true, // Chronological order
  }));

  const rawMessages = (result.Items || []).map(item => unmarshall(item) as DynamoMessage);

  // Batch decrypt messages in parallel for better performance
  const decryptedMessages: MessageExport[] = [];

  for (let i = 0; i < rawMessages.length; i += DECRYPT_BATCH_SIZE) {
    const batch = rawMessages.slice(i, i + DECRYPT_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (msg): Promise<MessageExport> => {
        let content: string;
        try {
          const encContext: EncryptionContext = {
            conversationId: msg.conversationId,
            messageId: msg.id,
            userId: user,
          };
          content = await decryptContent(msg.content, encContext);
        } catch (error) {
          console.error(`Failed to decrypt message ${msg.id}:`, error);
          content = '[Decryption failed]';
        }

        return {
          role: msg.role as 'user' | 'assistant',
          content,
          citations: msg.citations?.map(c => ({
            id: c.id,
            preview: c.preview,
            createdAt: c.createdAt,
          })),
          createdAt: new Date(msg.createdAt).toISOString(),
        };
      })
    );

    decryptedMessages.push(...batchResults);
  }

  return decryptedMessages;
}

async function getDeletedIds(user: string, since: number): Promise<string[]> {
  if (since === 0) return [];

  const deleted: string[] = [];

  // Query for items with deletedAt > since
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    FilterExpression: 'deletedAt > :since',
    ExpressionAttributeValues: {
      ':pk': { S: `user#${user}` },
      ':since': { N: since.toString() },
    },
  }));

  for (const item of result.Items || []) {
    const data = unmarshall(item);
    if (data.id) {
      deleted.push(data.id);
    }
  }

  return deleted;
}

// ============ Handler ============

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
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
    const since = parseInt(event.queryStringParameters?.since || '0');

    console.log(`Export request for user: ${user}, since: ${since}`);

    // Fetch all data in parallel
    const [thoughts, conversations, deleted] = await Promise.all([
      exportThoughts(user, since),
      exportConversations(user, since),
      getDeletedIds(user, since),
    ]);

    const response: ExportResponse = {
      thoughts,
      conversations,
      deleted,
      syncTimestamp: Date.now(),
    };

    console.log(`Exported ${thoughts.length} thoughts, ${conversations.length} conversations`);

    return jsonResponse(200, response);
  } catch (error) {
    console.error('Export error:', error);
    return jsonResponse(500, {
      error: 'InternalServerError',
      message: 'Failed to export data',
    });
  }
};
