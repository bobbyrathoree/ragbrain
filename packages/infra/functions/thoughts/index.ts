import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, GetItemCommand, BatchGetItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import {
  ThoughtsRequest,
  ThoughtsResponse,
  Thought,
  ThoughtType,
  ThoughtCategory,
  ThoughtIntent,
} from '@ragbrain/shared';

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
  category?: string;
  intent?: string;
  entities?: Set<string>;
  relatedIds?: Set<string>;
  indexedAt?: number;
  context?: {
    app?: string;
    windowTitle?: string;
    repo?: string;
    branch?: string;
    file?: string;
  };
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

// Filter out 'none' placeholder values from sets
function filterPlaceholder(set?: Set<string>): string[] | undefined {
  if (!set) return undefined;
  const arr = Array.from(set).filter(v => v !== 'none');
  return arr.length > 0 ? arr : undefined;
}

function formatThought(item: DynamoThought): Thought {
  return {
    id: item.id,
    user: item.pk.replace('user#', ''),
    createdAt: item.createdAtIso,
    text: item.text,
    type: item.type as ThoughtType,
    tags: Array.from(item.tags || []),
    context: item.context,
    derived: {
      summary: item.summary,
      decisionScore: item.decisionScore,
      autoTags: filterPlaceholder(item.autoTags),
      category: item.category as ThoughtCategory | undefined,
      intent: item.intent as ThoughtIntent | undefined,
      entities: filterPlaceholder(item.entities),
      relatedIds: filterPlaceholder(item.relatedIds),
    },
  };
}

async function getThoughtById(user: string, thoughtId: string): Promise<DynamoThought | null> {
  // Query to find the thought by id (since we don't know the exact sk timestamp)
  // Note: FilterExpression is applied AFTER Limit, so we need to scan through more items
  const result = await dynamodb.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    FilterExpression: 'id = :id',
    ExpressionAttributeValues: {
      ':pk': { S: `user#${user}` },
      ':id': { S: thoughtId },
    },
    // Don't limit - need to scan through all items to find the one with matching id
  }));

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return unmarshall(result.Items[0]) as DynamoThought;
}

async function getThoughtsByIds(user: string, thoughtIds: string[]): Promise<Thought[]> {
  if (thoughtIds.length === 0) return [];

  // For each ID, we need to find the thought by querying
  // This is less efficient but necessary since we don't store the full sk
  const thoughts: Thought[] = [];

  for (const id of thoughtIds.slice(0, 10)) { // Limit to 10 related thoughts
    const thought = await getThoughtById(user, id);
    if (thought) {
      thoughts.push(formatThought(thought));
    }
  }

  return thoughts;
}

async function handleRelatedThoughts(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const thoughtId = event.pathParameters?.id;

  if (!thoughtId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'ValidationError',
        message: 'Thought ID is required',
      }),
    };
  }

  // Get the source thought to find its relatedIds
  const thought = await getThoughtById(user, thoughtId);

  if (!thought) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'NotFound',
        message: 'Thought not found',
      }),
    };
  }

  // Get the related thoughts
  const relatedIds = filterPlaceholder(thought.relatedIds) || [];
  const relatedThoughts = await getThoughtsByIds(user, relatedIds);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      thoughtId,
      related: relatedThoughts,
      count: relatedThoughts.length,
    }),
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  // Get user from authorizer
  const user = event.requestContext.authorizer?.lambda?.user || 'dev';

  // Route based on path
  const path = event.rawPath || '';
  if (path.includes('/related')) {
    return handleRelatedThoughts(event, user);
  }

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