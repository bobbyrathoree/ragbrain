import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { v4 as uuidv4 } from 'uuid';
import { 
  CaptureRequest, 
  CaptureResponse, 
  ThoughtType,
  validateThoughtText,
  validateTags,
  validateThoughtType,
  extractTags,
  sanitizeText,
  calculateDecisionScore,
  detectThoughtType
} from '@ultrathink/shared';

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const sqs = new SQSClient({});
const cloudwatch = new CloudWatchClient({});

const {
  BUCKET_NAME,
  TABLE_NAME,
  QUEUE_URL,
  PROJECT_NAME,
  ENVIRONMENT,
} = process.env;

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();
  
  try {
    // Parse and validate request
    const body = JSON.parse(event.body || '{}') as CaptureRequest;
    
    // Extract user from authorizer context
    const user = event.requestContext.authorizer?.lambda?.user || 'dev';
    
    // Validate input
    if (!body.text || !validateThoughtText(body.text)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Text is required and must be between 1 and 50000 characters',
        }),
      };
    }
    
    // Validate tags if provided
    if (body.tags && !validateTags(body.tags)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Invalid tags format',
        }),
      };
    }
    
    // Validate type if provided
    if (body.type && !validateThoughtType(body.type)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Invalid thought type',
        }),
      };
    }
    
    // Generate or use provided ID
    const thoughtId = body.id || `t_${uuidv4()}`;
    const createdAt = body.createdAt || new Date().toISOString();
    const createdAtEpoch = new Date(createdAt).getTime();
    
    // Auto-detect type if not provided
    const thoughtType = body.type || detectThoughtType(body.text);
    
    // Extract and merge tags
    const extractedTags = extractTags(body.text);
    const allTags = Array.from(new Set([...(body.tags || []), ...extractedTags]));
    
    // Sanitize text for security
    const sanitizedText = sanitizeText(body.text);
    
    // Calculate decision score
    const decisionScore = calculateDecisionScore(body.text);
    
    // Prepare thought object
    const thought = {
      id: thoughtId,
      user,
      createdAt,
      text: sanitizedText,
      originalText: body.text, // Keep original for reference
      type: thoughtType,
      tags: allTags,
      context: body.context || {},
      derived: {
        decisionScore,
        containsSensitive: sanitizedText !== body.text,
      },
    };
    
    // Store raw JSON to S3
    const s3Key = `thoughts/${user}/${new Date(createdAt).toISOString().split('T')[0]}/${thoughtId}.json`;
    
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(thought, null, 2),
      ContentType: 'application/json',
      ServerSideEncryption: 'aws:kms',
      Metadata: {
        user,
        type: thoughtType,
        createdAt,
      },
    }));
    
    // Store metadata in DynamoDB
    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: { S: `user#${user}` },
        sk: { S: `ts#${createdAtEpoch}#${thoughtId}` },
        id: { S: thoughtId },
        text: { S: sanitizedText.substring(0, 1000) }, // Store first 1000 chars
        type: { S: thoughtType },
        tags: { SS: allTags.length > 0 ? allTags : ['untagged'] },
        createdAt: { N: createdAtEpoch.toString() },
        createdAtIso: { S: createdAt },
        decisionScore: { N: decisionScore.toString() },
        s3Key: { S: s3Key },
        gsi1pk: { S: `type#${thoughtType}` },
        gsi1sk: { S: `ts#${createdAtEpoch}` },
        ttl: { N: (Math.floor(Date.now() / 1000) + 31536000).toString() }, // 1 year TTL
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    })).catch((error: any) => {
      // Handle duplicate (idempotency)
      if (error.name === 'ConditionalCheckFailedException') {
        console.log('Thought already exists, treating as success for idempotency');
      } else {
        throw error;
      }
    });
    
    // Queue for indexing
    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        thoughtId,
        user,
        s3Key,
        createdAt,
      }),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: thoughtType,
        },
        user: {
          DataType: 'String',
          StringValue: user,
        },
      },
    }));
    
    // Emit metrics
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'CaptureLatency',
          Value: Date.now() - startTime,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
            { Name: 'Type', Value: thoughtType },
          ],
        },
        {
          MetricName: 'ThoughtCaptured',
          Value: 1,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
            { Name: 'Type', Value: thoughtType },
          ],
        },
        {
          MetricName: 'ThoughtLength',
          Value: body.text.length,
          Unit: 'Bytes',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
      ],
    })).catch(err => {
      console.error('Failed to emit metrics:', err);
      // Don't fail the request for metrics
    });
    
    // Return success response
    const response: CaptureResponse = {
      id: thoughtId,
      createdAt,
      message: 'Thought captured successfully',
    };
    
    return {
      statusCode: 201,
      headers: { 
        'Content-Type': 'application/json',
        'X-Thought-Id': thoughtId,
      },
      body: JSON.stringify(response),
    };
    
  } catch (error) {
    console.error('Error capturing thought:', error);
    
    // Emit error metric
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'CaptureError',
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
        message: 'Failed to capture thought',
        requestId: event.requestContext.requestId,
      }),
    };
  }
};