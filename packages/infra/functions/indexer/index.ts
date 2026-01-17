import { SQSEvent, SQSBatchResponse, SQSBatchItemFailure } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { 
  BedrockRuntimeClient, 
  InvokeModelCommand 
} from '@aws-sdk/client-bedrock-runtime';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
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

interface IndexMessage {
  thoughtId: string;
  user: string;
  s3Key: string;
  createdAt: string;
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
    modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
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

async function extractAutoTags(text: string, existingTags: string[]): Promise<string[]> {
  // Simple keyword extraction for auto-tagging
  const keywords = new Set<string>();
  
  // Technical keywords
  const techPatterns = [
    /\b(aws|azure|gcp|cloud)\b/gi,
    /\b(react|vue|angular|svelte)\b/gi,
    /\b(python|javascript|typescript|go|rust)\b/gi,
    /\b(docker|kubernetes|k8s)\b/gi,
    /\b(api|rest|graphql|grpc)\b/gi,
    /\b(database|sql|nosql|postgres|mongodb)\b/gi,
  ];
  
  for (const pattern of techPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(match => keywords.add(match.toLowerCase()));
    }
  }
  
  // Topic detection
  if (text.toLowerCase().includes('bug') || text.toLowerCase().includes('error')) {
    keywords.add('bug');
  }
  if (text.toLowerCase().includes('feature') || text.toLowerCase().includes('implement')) {
    keywords.add('feature');
  }
  if (text.toLowerCase().includes('performance') || text.toLowerCase().includes('optimize')) {
    keywords.add('performance');
  }
  if (text.toLowerCase().includes('security') || text.toLowerCase().includes('vulnerability')) {
    keywords.add('security');
  }
  
  // Remove existing tags to avoid duplicates
  const newTags = Array.from(keywords).filter(tag => !existingTags.includes(tag));
  
  return newTags.slice(0, 5); // Limit to 5 auto-tags
}

async function processThought(message: IndexMessage): Promise<void> {
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
  
  // Extract auto-tags
  const autoTags = await extractAutoTags(thoughtData.text, thoughtData.tags);
  const allTags = [...thoughtData.tags, ...autoTags];
  
  // Index to OpenSearch
  const searchDocument = {
    id: thoughtData.id,
    text: thoughtData.text,
    summary,
    tags: allTags,
    type: thoughtData.type,
    created_at_epoch: new Date(thoughtData.createdAt).getTime(),
    decision_score: thoughtData.derived.decisionScore,
    embedding,
    user: thoughtData.user,
    context: thoughtData.context,
  };
  
  await opensearchClient.index({
    index: `${SEARCH_COLLECTION}-thoughts`,
    id: thoughtData.id,
    body: searchDocument,
    refresh: false, // Don't wait for refresh
  });
  
  // Update DynamoDB with derived fields
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: `user#${thoughtData.user}` },
      sk: { S: `ts#${new Date(thoughtData.createdAt).getTime()}#${thoughtData.id}` },
    },
    UpdateExpression: 'SET #summary = :summary, #autoTags = :autoTags, #embeddingId = :embeddingId, #indexedAt = :indexedAt',
    ExpressionAttributeNames: {
      '#summary': 'summary',
      '#autoTags': 'autoTags',
      '#embeddingId': 'embeddingId',
      '#indexedAt': 'indexedAt',
    },
    ExpressionAttributeValues: {
      ':summary': { S: summary },
      ':autoTags': { SS: autoTags.length > 0 ? autoTags : ['none'] },
      ':embeddingId': { S: thoughtData.id }, // Using same ID for simplicity
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

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchItemFailure[] = [];
  
  // Process messages in parallel with concurrency limit
  const processingPromises = event.Records.map(async (record) => {
    try {
      const message: IndexMessage = JSON.parse(record.body);
      console.log(`Processing thought: ${message.thoughtId}`);
      
      await processThought(message);
      
      console.log(`Successfully indexed thought: ${message.thoughtId}`);
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