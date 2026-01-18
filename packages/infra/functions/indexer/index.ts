import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { KMSClient, DecryptCommand } from '@aws-sdk/client-kms';
import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const kms = new KMSClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const cloudwatch = new CloudWatchClient({});

const {
  BUCKET_NAME,
  TABLE_NAME,
  SEARCH_ENDPOINT,
  SEARCH_COLLECTION,
  PROJECT_NAME,
  ENVIRONMENT,
  AWS_REGION,
  KMS_KEY_ARN,
} = process.env;

// OpenSearch client with SigV4 signing
const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION!,
    service: 'aoss',
    getCredentials: defaultProvider(),
  }),
  node: SEARCH_ENDPOINT,
});

interface ThoughtIndexMessage {
  type?: 'thought';
  thoughtId: string;
  user: string;
  s3Key: string;
  createdAt: string;
}

interface ConversationIndexMessage {
  type: 'conversation';
  conversationId: string;
  user: string;
  userMessageId?: string;
  assistantMessageId?: string;
}

type IndexMessage = ThoughtIndexMessage | ConversationIndexMessage;

// DynamoDB types for conversations
interface DynamoConversation {
  pk: string;
  sk: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: string;
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

// Encryption context for KMS
interface EncryptionContext {
  conversationId: string;
  messageId: string;
  userId: string;
}

// Decrypt message content using KMS
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
    throw new Error('KMS decryption failed - no plaintext returned');
  }

  return new TextDecoder().decode(response.Plaintext);
}

interface ThoughtDocument {
  id: string;
  user: string;
  createdAt: string;
  text: string;
  type: string;
  tags: string[];
  context: any;
  derived: {
    decisionScore: number;
    containsSensitive: boolean;
  };
}

async function generateEmbedding(text: string): Promise<number[]> {
  const input = {
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.substring(0, 8192), // Titan limit
    }),
  };
  
  const command = new InvokeModelCommand(input);
  const response = await bedrock.send(command);
  
  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

async function generateSummary(text: string): Promise<string> {
  // Skip summary for short texts
  if (text.length < 100) {
    return text.substring(0, 50);
  }
  
  const input = {
    modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 100,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: `Summarize this thought in one concise sentence (max 15 words): "${text}"`,
        },
      ],
    }),
  };
  
  try {
    const command = new InvokeModelCommand(input);
    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.content[0].text.trim();
  } catch (error) {
    console.error('Summary generation failed:', error);
    return text.substring(0, 100) + '...';
  }
}

// Types for smart tagging
interface SmartTagResult {
  tags: string[];
  category: string;
  intent: string;
  entities: string[];
}

interface ThoughtContext {
  app?: string;
  windowTitle?: string;
  repo?: string;
  branch?: string;
  file?: string;
}

async function generateSmartTags(text: string, context?: ThoughtContext): Promise<SmartTagResult> {
  // Build context section if available
  const contextSection = context ? `
<context>
App: ${context.app || 'unknown'}
${context.repo ? `Repo: ${context.repo}` : ''}
${context.file ? `File: ${context.file}` : ''}
</context>` : '';

  const prompt = `Analyze this thought and extract structured metadata.

<thought>
${text.substring(0, 2000)}
</thought>
${contextSection}

Return ONLY valid JSON (no markdown, no explanation) with:
1. "tags": array of 3-5 concise tags (lowercase, hyphenated, e.g. "api-design")
2. "category": exactly one of ["engineering", "design", "product", "personal", "learning", "decision", "other"]
3. "intent": exactly one of ["note", "question", "decision", "todo", "idea", "bug-report", "feature-request", "rationale"]
4. "entities": array of 1-3 key names/terms/technologies mentioned

Example response:
{"tags":["api-design","rest","authentication"],"category":"engineering","intent":"decision","entities":["OAuth2","JWT"]}`;

  try {
    const input = {
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    let responseText = result.content[0].text.trim();

    // Strip markdown code fences if present
    if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    // Parse JSON response
    const parsed = JSON.parse(responseText);

    return {
      tags: (parsed.tags || []).slice(0, 5).map((t: string) => t.toLowerCase().replace(/\s+/g, '-')),
      category: parsed.category || 'other',
      intent: parsed.intent || 'note',
      entities: (parsed.entities || []).slice(0, 3),
    };
  } catch (error) {
    console.error('Smart tag generation failed:', error);
    // Fallback to basic extraction
    return fallbackTagExtraction(text);
  }
}

function fallbackTagExtraction(text: string): SmartTagResult {
  const tags: string[] = [];
  const lowerText = text.toLowerCase();

  // Basic keyword detection as fallback
  const patterns: [RegExp, string][] = [
    [/\b(aws|azure|gcp)\b/i, 'cloud'],
    [/\b(react|vue|angular)\b/i, 'frontend'],
    [/\b(api|rest|graphql)\b/i, 'api'],
    [/\bbug\b/i, 'bug'],
    [/\bfeature\b/i, 'feature'],
  ];

  for (const [pattern, tag] of patterns) {
    if (pattern.test(text)) tags.push(tag);
  }

  // Detect intent from keywords
  let intent = 'note';
  if (lowerText.includes('?')) intent = 'question';
  else if (lowerText.includes('decided') || lowerText.includes('decision')) intent = 'decision';
  else if (lowerText.includes('todo') || lowerText.includes('need to')) intent = 'todo';
  else if (lowerText.includes('bug') || lowerText.includes('error')) intent = 'bug-report';

  return {
    tags: tags.slice(0, 5),
    category: 'other',
    intent,
    entities: [],
  };
}

async function findRelatedThoughts(thoughtId: string, embedding: number[], user: string): Promise<string[]> {
  try {
    // Query OpenSearch for k-nearest neighbors
    const results = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: {
        size: 6, // Get 6 to exclude self
        query: {
          bool: {
            must: [
              {
                knn: {
                  embedding: {
                    vector: embedding,
                    k: 6,
                  },
                },
              },
            ],
            filter: [
              { term: { user } }, // Only same user's thoughts
            ],
          },
        },
        _source: ['id'],
      },
    });

    // Extract IDs, excluding the current thought
    const relatedIds = results.body.hits.hits
      .map((hit: any) => hit._source.id)
      .filter((id: string) => id !== thoughtId)
      .slice(0, 5);

    return relatedIds;
  } catch (error) {
    console.error('Failed to find related thoughts:', error);
    return [];
  }
}

async function processThought(message: ThoughtIndexMessage): Promise<void> {
  const startTime = Date.now();
  
  // Fetch thought from S3
  const s3Response = await s3.send(new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: message.s3Key,
  }));
  
  const thoughtData = JSON.parse(
    await s3Response.Body!.transformToString()
  ) as ThoughtDocument;
  
  // Generate embedding
  const embedding = await generateEmbedding(thoughtData.text);
  
  // Generate summary
  const summary = await generateSummary(thoughtData.text);

  // Generate smart tags using Claude
  const smartTags = await generateSmartTags(thoughtData.text, thoughtData.context);
  const allTags = [...new Set([...thoughtData.tags, ...smartTags.tags])]; // Dedupe

  // Index to OpenSearch
  const searchDocument = {
    id: thoughtData.id,
    text: thoughtData.text,
    summary,
    tags: allTags,
    type: thoughtData.type,
    category: smartTags.category,
    intent: smartTags.intent,
    entities: smartTags.entities,
    created_at_epoch: new Date(thoughtData.createdAt).getTime(),
    decision_score: thoughtData.derived.decisionScore,
    embedding,
    user: thoughtData.user,
    context: thoughtData.context,
  };

  // For OpenSearch Serverless, use bulk API or index without explicit ID in params
  // The ID is already in the document body
  await opensearchClient.index({
    index: `${SEARCH_COLLECTION}-thoughts`,
    body: searchDocument,
    refresh: false,
  });

  // Find related thoughts using embedding similarity
  const relatedIds = await findRelatedThoughts(thoughtData.id, embedding, thoughtData.user);

  // Update DynamoDB with derived fields
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: `user#${thoughtData.user}` },
      sk: { S: `ts#${new Date(thoughtData.createdAt).getTime()}#${thoughtData.id}` },
    },
    UpdateExpression: 'SET #summary = :summary, #autoTags = :autoTags, #category = :category, #intent = :intent, #entities = :entities, #relatedIds = :relatedIds, #embeddingId = :embeddingId, #indexedAt = :indexedAt',
    ExpressionAttributeNames: {
      '#summary': 'summary',
      '#autoTags': 'autoTags',
      '#category': 'category',
      '#intent': 'intent',
      '#entities': 'entities',
      '#relatedIds': 'relatedIds',
      '#embeddingId': 'embeddingId',
      '#indexedAt': 'indexedAt',
    },
    ExpressionAttributeValues: {
      ':summary': { S: summary },
      ':autoTags': { SS: smartTags.tags.length > 0 ? smartTags.tags : ['none'] },
      ':category': { S: smartTags.category },
      ':intent': { S: smartTags.intent },
      ':entities': { SS: smartTags.entities.length > 0 ? smartTags.entities : ['none'] },
      ':relatedIds': { SS: relatedIds.length > 0 ? relatedIds : ['none'] },
      ':embeddingId': { S: thoughtData.id },
      ':indexedAt': { N: Date.now().toString() },
    },
  }));
  
  // Emit metrics
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: PROJECT_NAME,
    MetricData: [
      {
        MetricName: 'IndexLatency',
        Value: Date.now() - startTime,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT },
        ],
      },
      {
        MetricName: 'ThoughtIndexed',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT },
          { Name: 'Type', Value: thoughtData.type },
        ],
      },
      {
        MetricName: 'EmbeddingDimensions',
        Value: embedding.length,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT },
        ],
      },
    ],
  })).catch(err => {
    console.error('Failed to emit metrics:', err);
  });
}

// Process conversation for indexing
async function processConversation(message: ConversationIndexMessage): Promise<void> {
  const startTime = Date.now();
  const { conversationId, user } = message;

  // Fetch conversation metadata
  const convResult = await dynamodb.send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
  }));

  if (!convResult.Item) {
    console.error(`Conversation not found: ${conversationId}`);
    return;
  }

  const conversation = unmarshall(convResult.Item) as DynamoConversation;

  // Fetch all messages
  const msgResult = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
    ExpressionAttributeValues: {
      ':pk': { S: `conv#${conversationId}` },
      ':skPrefix': { S: 'msg#' },
    },
    ScanIndexForward: true, // Chronological order
  }));

  if (!msgResult.Items || msgResult.Items.length === 0) {
    console.log(`No messages to index for conversation: ${conversationId}`);
    return;
  }

  // Decrypt and concatenate messages
  const decryptedMessages: Array<{ role: string; content: string; citations?: any[] }> = [];
  const allCitedThoughtIds: Set<string> = new Set();
  const allTags: Set<string> = new Set();

  for (const item of msgResult.Items) {
    const msg = unmarshall(item) as DynamoMessage;
    const encContext: EncryptionContext = {
      conversationId: msg.conversationId,
      messageId: msg.id,
      userId: user,
    };

    try {
      const decryptedContent = await decryptContent(msg.content, encContext);
      decryptedMessages.push({
        role: msg.role,
        content: decryptedContent,
        citations: msg.citations,
      });

      // Collect cited thought IDs and their tags
      if (msg.citations) {
        for (const citation of msg.citations) {
          if (citation.id) allCitedThoughtIds.add(citation.id);
          if (citation.tags) {
            for (const tag of citation.tags) {
              allTags.add(tag);
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to decrypt message ${msg.id}:`, error);
    }
  }

  if (decryptedMessages.length === 0) {
    console.log(`No messages could be decrypted for conversation: ${conversationId}`);
    return;
  }

  // Build concatenated text for embedding and search
  const concatenatedText = decryptedMessages
    .map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`)
    .join('\n\n');

  // Generate embedding
  const embedding = await generateEmbedding(concatenatedText);

  // Generate summary of the conversation
  const summary = await generateConversationSummary(conversation.title, decryptedMessages);

  // Index to OpenSearch with docType discriminator
  const searchDocument = {
    id: conversationId,
    docType: 'conversation',
    title: conversation.title,
    text: concatenatedText,
    summary,
    tags: Array.from(allTags),
    messageCount: decryptedMessages.length,
    citedThoughtIds: Array.from(allCitedThoughtIds),
    created_at_epoch: conversation.createdAt,
    updated_at_epoch: conversation.updatedAt,
    embedding,
    user,
  };

  await opensearchClient.index({
    index: `${SEARCH_COLLECTION}-thoughts`, // Same index, distinguished by docType
    id: conversationId, // Use conversation ID to enable upsert
    body: searchDocument,
    refresh: false,
  });

  // Update conversation with indexedAt timestamp
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({
      pk: `user#${user}`,
      sk: `conv#${conversationId}`,
    }),
    UpdateExpression: 'SET #indexedAt = :indexedAt',
    ExpressionAttributeNames: {
      '#indexedAt': 'indexedAt',
    },
    ExpressionAttributeValues: {
      ':indexedAt': { N: Date.now().toString() },
    },
  }));

  // Emit metrics
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: PROJECT_NAME,
    MetricData: [
      {
        MetricName: 'IndexLatency',
        Value: Date.now() - startTime,
        Unit: 'Milliseconds',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT },
          { Name: 'Type', Value: 'conversation' },
        ],
      },
      {
        MetricName: 'ConversationIndexed',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT },
        ],
      },
    ],
  })).catch(err => {
    console.error('Failed to emit metrics:', err);
  });

  console.log(`Successfully indexed conversation: ${conversationId} with ${decryptedMessages.length} messages`);
}

// Generate a summary of the conversation
async function generateConversationSummary(
  title: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  if (messages.length === 0) return title;

  // For short conversations, just use title + first exchange
  if (messages.length <= 2) {
    const firstQ = messages.find(m => m.role === 'user');
    return firstQ ? `${title}: ${firstQ.content.substring(0, 100)}` : title;
  }

  // For longer conversations, use Claude to summarize
  const conversationText = messages
    .slice(0, 6) // First 6 messages max
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  try {
    const input = {
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 100,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: `Summarize this conversation in one sentence (max 20 words). Focus on the main topic discussed:\n\n${conversationText}`,
          },
        ],
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrock.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return result.content[0].text.trim();
  } catch (error) {
    console.error('Conversation summary generation failed:', error);
    return title;
  }
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];

  // Process messages in parallel with concurrency limit
  const processingPromises = event.Records.map(async (record) => {
    try {
      const message: IndexMessage = JSON.parse(record.body);

      // Route based on message type
      if (message.type === 'conversation') {
        console.log(`Processing conversation: ${message.conversationId}`);
        await processConversation(message);
        console.log(`Successfully indexed conversation: ${message.conversationId}`);
      } else {
        // Default to thought processing (backwards compatible)
        const thoughtMessage = message as ThoughtIndexMessage;
        console.log(`Processing thought: ${thoughtMessage.thoughtId}`);
        await processThought(thoughtMessage);
        console.log(`Successfully indexed thought: ${thoughtMessage.thoughtId}`);
      }
    } catch (error) {
      console.error(`Failed to process message ${record.messageId}:`, error);
      
      // Add to batch failures for retry
      batchItemFailures.push({
        itemIdentifier: record.messageId,
      });
      
      // Emit error metric
      await cloudwatch.send(new PutMetricDataCommand({
        Namespace: PROJECT_NAME,
        MetricData: [
          {
            MetricName: 'IndexError',
            Value: 1,
            Unit: 'Count',
            Dimensions: [
              { Name: 'Environment', Value: ENVIRONMENT },
            ],
          },
        ],
      })).catch(() => {});
    }
  });
  
  await Promise.all(processingPromises);
  
  return {
    batchItemFailures,
  };
};