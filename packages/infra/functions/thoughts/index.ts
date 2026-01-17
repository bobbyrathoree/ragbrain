import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  ThoughtsRequest,
  ThoughtsResponse,
  Thought,
  ThoughtType,
} from '@ultrathink/shared';

const dynamodb = new DynamoDBClient({});
const cloudwatch = new CloudWatchClient({});

const {
  TABLE_NAME,
  PROJECT_NAME,
  ENVIRONMENT,
} = process.env;

interface DynamoThought {
  pk: string;
  sk: string;
  id: string;
  text: string;
  type: string;
  tags: Set<string>;
  createdAt: number;
  createdAtIso: string;
  decisionScore: number;
  s3Key: string;
  summary?: string;
  autoTags?: Set<string>;
  indexedAt?: number;
}

function buildQueryParams(
  user: string,
  params: ThoughtsRequest
): any {
  const queryParams: any = {
    TableName: TABLE_NAME,
    Limit: params.limit || 50,
    ScanIndexForward: false, // Newest first
  };
  
  // Filter by type using GSI
  if (params.type) {
    queryParams.IndexName = 'gsi1';
    queryParams.KeyConditionExpression = 'gsi1pk = :typeKey';
    queryParams.ExpressionAttributeValues = {
      ':typeKey': { S: `type#${params.type}` },
    };
    
    // Add date range if specified
    if (params.from || params.to) {
      const fromEpoch = params.from ? new Date(params.from).getTime() : 0;
      const toEpoch = params.to ? new Date(params.to).getTime() : Date.now();
      
      queryParams.KeyConditionExpression += ' AND gsi1sk BETWEEN :from AND :to';
      queryParams.ExpressionAttributeValues[':from'] = { S: `ts#${fromEpoch}` };
      queryParams.ExpressionAttributeValues[':to'] = { S: `ts#${toEpoch}` };
    }
  } else {
    // Default query by user
    queryParams.KeyConditionExpression = 'pk = :userKey';
    queryParams.ExpressionAttributeValues = {
      ':userKey': { S: `user#${user}` },
    };
    
    // Add date range if specified
    if (params.from || params.to) {
      const fromEpoch = params.from ? new Date(params.from).getTime() : 0;
      const toEpoch = params.to ? new Date(params.to).getTime() : Date.now();
      
      queryParams.KeyConditionExpression += ' AND sk BETWEEN :from AND :to';
      queryParams.ExpressionAttributeValues[':from'] = { S: `ts#${fromEpoch}#` };
      queryParams.ExpressionAttributeValues[':to'] = { S: `ts#${toEpoch}~` }; // ~ ensures we get everything in range
    }
  }
  
  // Add tag filter
  if (params.tag) {
    queryParams.FilterExpression = 'contains(tags, :tag)';
    queryParams.ExpressionAttributeValues = {
      ...queryParams.ExpressionAttributeValues,
      ':tag': { S: params.tag },
    };
  }
  
  // Handle pagination cursor
  if (params.cursor) {
    try {
      queryParams.ExclusiveStartKey = JSON.parse(
        Buffer.from(params.cursor, 'base64').toString()
      );
    } catch (error) {
      console.error('Invalid cursor:', error);
    }
  }
  
  return queryParams;
}

function formatThought(item: DynamoThought): Thought {
  return {
    id: item.id,
    user: item.pk.replace('user#', ''),
    createdAt: item.createdAtIso,
    text: item.text,
    type: item.type as ThoughtType,
    tags: Array.from(item.tags || []),
    derived: {
      summary: item.summary,
      decisionScore: item.decisionScore,
      autoTags: item.autoTags ? Array.from(item.autoTags) : undefined,
    },
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();
  
  try {
    // Parse query parameters
    const params: ThoughtsRequest = {
      from: event.queryStringParameters?.from,
      to: event.queryStringParameters?.to,
      tag: event.queryStringParameters?.tag,
      type: event.queryStringParameters?.type,
      limit: event.queryStringParameters?.limit 
        ? parseInt(event.queryStringParameters.limit) 
        : 50,
      cursor: event.queryStringParameters?.cursor,
    };
    
    // Get user from authorizer
    const user = event.requestContext.authorizer?.lambda?.user || 'dev';
    
    // Validate parameters
    if (params.limit && (params.limit < 1 || params.limit > 100)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'ValidationError',
          message: 'Limit must be between 1 and 100',
        }),
      };
    }
    
    // Build and execute query
    const queryParams = buildQueryParams(user, params);
    const queryResult = await dynamodb.send(new QueryCommand(queryParams));
    
    // Transform results
    const thoughts: Thought[] = (queryResult.Items || [])
      .map(item => unmarshall(item) as DynamoThought)
      .map(formatThought);
    
    // Create cursor for pagination
    let cursor: string | undefined;
    if (queryResult.LastEvaluatedKey) {
      cursor = Buffer.from(
        JSON.stringify(queryResult.LastEvaluatedKey)
      ).toString('base64');
    }
    
    // Get total count (optional, expensive for large datasets)
    let totalCount: number | undefined;
    if (event.queryStringParameters?.includeCount === 'true') {
      const countParams = {
        ...queryParams,
        Select: 'COUNT',
        Limit: undefined,
        ExclusiveStartKey: undefined,
      };
      const countResult = await dynamodb.send(new QueryCommand(countParams));
      totalCount = countResult.Count;
    }
    
    // Emit metrics
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'ThoughtsQueryLatency',
          Value: Date.now() - startTime,
          Unit: 'Milliseconds',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
        {
          MetricName: 'ThoughtsReturned',
          Value: thoughts.length,
          Unit: 'Count',
          Dimensions: [
            { Name: 'Environment', Value: ENVIRONMENT },
          ],
        },
      ],
    })).catch(err => {
      console.error('Failed to emit metrics:', err);
    });
    
    // Return response
    const response: ThoughtsResponse = {
      thoughts,
      cursor,
      hasMore: !!cursor,
      totalCount,
    };
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'X-Total-Count': totalCount?.toString() || '',
      },
      body: JSON.stringify(response),
    };
    
  } catch (error) {
    console.error('Error fetching thoughts:', error);
    
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [
        {
          MetricName: 'ThoughtsQueryError',
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
        message: 'Failed to fetch thoughts',
        requestId: event.requestContext.requestId,
      }),
    };
  }
};