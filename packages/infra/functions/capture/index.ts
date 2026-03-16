import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  CaptureRequest,
  CaptureResponse,
  validateThoughtText,
  validateTags,
  validateThoughtType,
  extractTags,
  sanitizeText,
  calculateDecisionScore,
  detectThoughtType,
} from '@ragbrain/shared';
import {
  createS3Client,
  createDynamoDBClient,
  createSQSClient,
  createCloudWatchClient,
  emitMetrics,
  getAuthUser,
  validationError,
  internalError,
  createdResponse,
} from '../../lib/shared';

const s3 = createS3Client();
const dynamodb = createDynamoDBClient();
const sqs = createSQSClient();
const cloudwatch = createCloudWatchClient();

const { BUCKET_NAME, TABLE_NAME, QUEUE_URL } = process.env;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  try {
    let body: CaptureRequest;
    try { body = JSON.parse(event.body || '{}'); } catch { return validationError('Invalid JSON in request body'); }

    const userOrError = getAuthUser(event);
    if (typeof userOrError !== 'string') return userOrError;
    const user = userOrError;

    if (!body.text || !validateThoughtText(body.text)) {
      return validationError('Text is required and must be between 1 and 50000 characters');
    }
    if (body.tags && !validateTags(body.tags)) return validationError('Invalid tags format');
    if (body.type && !validateThoughtType(body.type)) return validationError('Invalid thought type');

    const thoughtId = body.id || `t_${uuidv4()}`;
    const createdAt = body.createdAt || new Date().toISOString();
    const createdAtEpoch = new Date(createdAt).getTime();
    const thoughtType = body.type || detectThoughtType(body.text);
    const extractedTags = extractTags(body.text);
    const allTags = Array.from(new Set([...(body.tags || []), ...extractedTags]));
    const sanitizedText = sanitizeText(body.text);
    const decisionScore = calculateDecisionScore(body.text);

    const thought = {
      id: thoughtId, user, createdAt,
      text: sanitizedText,
      originalText: body.text,
      type: thoughtType,
      tags: allTags,
      context: body.context || {},
      derived: { decisionScore, containsSensitive: sanitizedText !== body.text },
    };

    // Store to S3
    const s3Key = `thoughts/${user}/${new Date(createdAt).toISOString().split('T')[0]}/${thoughtId}.json`;
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(thought, null, 2),
      ContentType: 'application/json',
      ServerSideEncryption: 'aws:kms',
      Metadata: { user, type: thoughtType, createdAt },
    }));

    // Store metadata in DynamoDB
    await dynamodb.send(new PutItemCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: { S: `user#${user}` },
        sk: { S: `ts#${createdAtEpoch}#${thoughtId}` },
        id: { S: thoughtId },
        text: { S: sanitizedText.substring(0, 1000) },
        type: { S: thoughtType },
        tags: { SS: allTags.length > 0 ? allTags : ['untagged'] },
        createdAt: { N: createdAtEpoch.toString() },
        createdAtIso: { S: createdAt },
        decisionScore: { N: decisionScore.toString() },
        s3Key: { S: s3Key },
        gsi1pk: { S: `type#${thoughtType}` },
        gsi1sk: { S: `ts#${createdAtEpoch}` },
        ttl: { N: (Math.floor(Date.now() / 1000) + 31536000).toString() },
        indexingStatus: { S: 'pending' },
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    })).catch((error: any) => {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log('Thought already exists, treating as success for idempotency');
      } else { throw error; }
    });

    // Update graph cache invalidation timestamp
    await dynamodb.send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: { pk: { S: `user#${user}` }, sk: { S: 'meta' } },
      UpdateExpression: 'SET lastDataChange = :ts',
      ExpressionAttributeValues: { ':ts': { N: Date.now().toString() } },
    })).catch(err => console.error('Failed to update lastDataChange:', err));

    // Queue for indexing
    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ thoughtId, user, s3Key, createdAt }),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: thoughtType },
        user: { DataType: 'String', StringValue: user },
      },
    }));

    // Emit metrics
    await emitMetrics(cloudwatch, [
      { name: 'CaptureLatency', value: Date.now() - startTime, unit: 'Milliseconds', dimensions: { Type: thoughtType } },
      { name: 'ThoughtCaptured', value: 1, dimensions: { Type: thoughtType } },
      { name: 'ThoughtLength', value: body.text.length, unit: 'Bytes' },
    ]);

    const response: CaptureResponse = { id: thoughtId, createdAt, message: 'Thought captured successfully' };
    return createdResponse(response, { 'X-Thought-Id': thoughtId });
  } catch (error) {
    console.error('Error capturing thought:', error);
    await emitMetrics(cloudwatch, [{ name: 'CaptureError', value: 1 }]);
    return internalError('Failed to capture thought', event.requestContext.requestId);
  }
};
