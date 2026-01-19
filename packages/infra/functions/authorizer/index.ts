import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
} from '@aws-sdk/client-dynamodb';

const secretsManager = new SecretsManagerClient({});
const dynamodb = new DynamoDBClient({});

const { SECRET_ARN, TABLE_NAME, RATE_LIMIT_PER_HOUR = '1000' } = process.env;

interface AuthorizerEvent {
  headers: Record<string, string>;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
    requestId: string;
  };
}

interface AuthorizerResult {
  isAuthorized: boolean;
  context?: {
    user: string;
    rateLimitRemaining?: number;
  };
}

const rateLimit = parseInt(RATE_LIMIT_PER_HOUR);

// Cache API key to avoid repeated Secrets Manager calls
let cachedApiKey: string | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 300000; // 5 minutes

async function getApiKey(): Promise<string> {
  const now = Date.now();
  if (cachedApiKey && now < cacheExpiry) {
    return cachedApiKey;
  }

  const secret = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: SECRET_ARN,
    })
  );

  const { key } = JSON.parse(secret.SecretString || '{}');
  cachedApiKey = key;
  cacheExpiry = now + CACHE_TTL_MS;

  return key;
}

async function checkRateLimit(
  userId: string
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  if (!TABLE_NAME) {
    // Rate limiting disabled if no table configured
    return { allowed: true, remaining: rateLimit };
  }

  const hourBucket = Math.floor(Date.now() / 3600000);
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24 hour TTL

  try {
    const result = await dynamodb.send(
      new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: {
          pk: { S: `user#${userId}` },
          sk: { S: `usage#${hourBucket}` },
        },
        UpdateExpression:
          'SET requests = if_not_exists(requests, :zero) + :one, #ttl = :ttl',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':zero': { N: '0' },
          ':one': { N: '1' },
          ':ttl': { N: ttl.toString() },
          ':limit': { N: rateLimit.toString() },
        },
        ConditionExpression:
          'attribute_not_exists(requests) OR requests < :limit',
        ReturnValues: 'UPDATED_NEW',
      })
    );

    const currentRequests = parseInt(
      result.Attributes?.requests?.N || '1'
    );
    const remaining = Math.max(0, rateLimit - currentRequests);

    return { allowed: true, remaining };
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Rate limit exceeded - calculate retry after
      const nextHourStart = (hourBucket + 1) * 3600000;
      const retryAfter = Math.ceil((nextHourStart - Date.now()) / 1000);

      // Get current count for logging
      try {
        const currentUsage = await dynamodb.send(
          new GetItemCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: { S: `user#${userId}` },
              sk: { S: `usage#${hourBucket}` },
            },
            ProjectionExpression: 'requests',
          })
        );
        console.log(
          `Rate limit exceeded for ${userId}: ${currentUsage.Item?.requests?.N} requests this hour`
        );
      } catch (e) {
        // Ignore logging errors
      }

      return { allowed: false, remaining: 0, retryAfter };
    }

    // Other DynamoDB errors - allow the request but log
    console.error('Rate limit check failed:', error);
    return { allowed: true, remaining: rateLimit };
  }
}

export const handler = async (
  event: AuthorizerEvent
): Promise<AuthorizerResult> => {
  const apiKey = event.headers['x-api-key'];

  if (!apiKey) {
    console.log('No API key provided');
    return { isAuthorized: false };
  }

  try {
    const validKey = await getApiKey();

    if (apiKey !== validKey) {
      console.log('Invalid API key');
      return { isAuthorized: false };
    }

    // For v1, single user mode
    const userId = 'dev';

    // Check rate limit
    const { allowed, remaining, retryAfter } = await checkRateLimit(userId);

    if (!allowed) {
      console.log(`Rate limit exceeded for ${userId}, retry after ${retryAfter}s`);
      // Note: API Gateway Lambda authorizer doesn't support custom error responses
      // The client will get 403; rate limit info logged for debugging
      return { isAuthorized: false };
    }

    return {
      isAuthorized: true,
      context: {
        user: userId,
        rateLimitRemaining: remaining,
      },
    };
  } catch (error) {
    console.error('Authorization error:', error);
    return { isAuthorized: false };
  }
};
