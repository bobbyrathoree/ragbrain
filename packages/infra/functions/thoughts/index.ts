import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, GetItemCommand, BatchGetItemCommand, UpdateItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
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
const sqs = new SQSClient({});

const {
  TABLE_NAME,
  PROJECT_NAME,
  ENVIRONMENT,
  QUEUE_URL,
} = process.env;

/**
 * Keep the search index in step with DynamoDB.
 *
 * This handler owns DynamoDB but deliberately has no OpenSearch client: index
 * writes belong to the indexer. Editing or deleting a thought used to touch
 * DynamoDB only, so deleted note text stayed searchable and citable forever and
 * edits left Ask quoting stale text. We enqueue the intent instead, which reuses
 * the indexer's existing retry and DLQ behaviour.
 *
 * Failures here are logged, not surfaced: the user's DynamoDB write already
 * succeeded, and reporting an error would wrongly imply it did not. The gap is
 * visible via the ThoughtReindexEnqueueFailed metric.
 *
 * See docs/AUDIT-2026-08.md finding 5.
 */
async function enqueueIndexSync(
  action: 'reindex' | 'delete',
  thoughtId: string,
  user: string,
  s3Key?: string,
): Promise<void> {
  if (!QUEUE_URL) {
    console.error('QUEUE_URL not configured; search index will drift', { action, thoughtId });
    return;
  }

  try {
    await sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({ type: action, thoughtId, user, s3Key }),
      MessageAttributes: {
        type: { DataType: 'String', StringValue: action },
        user: { DataType: 'String', StringValue: user },
      },
    }));
  } catch (error) {
    console.error(`Failed to enqueue ${action} for search index:`, error);
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: PROJECT_NAME,
      MetricData: [{
        MetricName: 'ThoughtReindexEnqueueFailed',
        Value: 1,
        Unit: 'Count',
        Dimensions: [
          { Name: 'Environment', Value: ENVIRONMENT || 'dev' },
          { Name: 'Action', Value: action },
        ],
      }],
    })).catch(() => { /* metric loss must not mask the original error */ });
  }
}

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
  indexingStatus?: string;
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
  
  // Every read is scoped to the caller's own partition. `type` was previously
  // served by gsi1, whose partition key is `type#<type>` with no user component
  // and ProjectionType.ALL — so `GET /thoughts?type=note` returned every user's
  // full note text to any authenticated caller. The `user` argument was accepted
  // and then ignored on that branch. Reproduced live before fixing.
  //
  // Type is a filter, not a partition: the caller's own notes are already a
  // small set, so filtering after the key condition is correct and cheap. Never
  // route a read through an index that is not partitioned by user.
  // See docs/AUDIT-2026-08.md finding 11.
  const filters: string[] = [];

  queryParams.KeyConditionExpression = 'pk = :userKey AND begins_with(sk, :skPrefix)';
  queryParams.ExpressionAttributeValues = {
    ':userKey': { S: `user#${user}` },
    ':skPrefix': { S: 'ts#' },
  };

  // Add date range if specified
  if (params.from || params.to) {
    const fromEpoch = params.from ? new Date(params.from).getTime() : 0;
    const toEpoch = params.to ? new Date(params.to).getTime() : Date.now();

    // For date range queries, use BETWEEN which works with the ts# prefix
    queryParams.KeyConditionExpression = 'pk = :userKey AND sk BETWEEN :from AND :to';
    queryParams.ExpressionAttributeValues[':from'] = { S: `ts#${fromEpoch}#` };
    queryParams.ExpressionAttributeValues[':to'] = { S: `ts#${toEpoch}~` };
    delete queryParams.ExpressionAttributeValues[':skPrefix'];
  }

  if (params.type) {
    filters.push('#type = :type');
    queryParams.ExpressionAttributeNames = {
      ...queryParams.ExpressionAttributeNames,
      '#type': 'type',
    };
    queryParams.ExpressionAttributeValues[':type'] = { S: params.type };
  }

  // Add tag filter
  if (params.tag) {
    filters.push('contains(tags, :tag)');
    queryParams.ExpressionAttributeValues[':tag'] = { S: params.tag };
  }

  if (filters.length > 0) {
    queryParams.FilterExpression = filters.join(' AND ');
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
    indexingStatus: (item.indexingStatus as 'pending' | 'indexed' | 'failed') || undefined,
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

async function handleUpdateThought(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const thoughtId = event.pathParameters?.id;
  if (!thoughtId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Thought ID is required' }),
    };
  }

  let body: { text?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  if (!body.text || body.text.trim().length === 0) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Text is required' }),
    };
  }

  // Find the thought to get its DynamoDB key
  const thought = await getThoughtById(user, thoughtId);
  if (!thought) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Thought not found' }),
    };
  }

  // Update the text field
  await dynamodb.send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: thought.pk },
      sk: { S: thought.sk },
    },
    UpdateExpression: 'SET #text = :text, #indexingStatus = :indexingStatus',
    ExpressionAttributeNames: { '#text': 'text', '#indexingStatus': 'indexingStatus' },
    ExpressionAttributeValues: {
      ':text': { S: body.text.trim() },
      ':indexingStatus': { S: 'pending' },
    },
  }));

  // Re-embed and re-index so Ask/Search/Graph reflect the new text.
  await enqueueIndexSync('reindex', thoughtId, user, thought.s3Key);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: thoughtId, text: body.text.trim() }),
  };
}

async function handleDeleteThought(
  event: APIGatewayProxyEventV2,
  user: string
): Promise<APIGatewayProxyResultV2> {
  const thoughtId = event.pathParameters?.id;
  if (!thoughtId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Thought ID is required' }),
    };
  }

  // Find the thought to get its DynamoDB key
  const thought = await getThoughtById(user, thoughtId);
  if (!thought) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Thought not found' }),
    };
  }

  // Delete the item
  await dynamodb.send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: {
      pk: { S: thought.pk },
      sk: { S: thought.sk },
    },
  }));

  // Remove from the search index too, or the text stays searchable and citable.
  await enqueueIndexSync('delete', thoughtId, user);

  return {
    statusCode: 204,
    headers: { 'Content-Type': 'application/json' },
    body: '',
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  // Get user from authorizer (must be set by authorizer)
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

  // Route based on method and path
  const method = event.requestContext.http.method;
  const path = event.rawPath || '';

  if (path.includes('/related')) {
    return handleRelatedThoughts(event, user);
  }

  if (method === 'PUT' && event.pathParameters?.id) {
    return handleUpdateThought(event, user);
  }

  if (method === 'DELETE' && event.pathParameters?.id) {
    return handleDeleteThought(event, user);
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

    // DynamoDB applies Limit BEFORE FilterExpression, so a type/tag filter can
    // return far fewer items than requested — or none at all while more matches
    // exist further down the partition. Since type is now a filter rather than a
    // partition key (finding 11), keep paging until the page is full or the
    // partition is exhausted, so `limit` still means what the caller expects and
    // an empty page never looks like the end of the list.
    const wantedLimit = queryParams.Limit as number;
    const items: Record<string, any>[] = [];
    let lastEvaluatedKey = queryParams.ExclusiveStartKey;
    let pagesScanned = 0;

    do {
      const queryResult = await dynamodb.send(new QueryCommand({
        ...queryParams,
        ExclusiveStartKey: lastEvaluatedKey,
      }));

      items.push(...(queryResult.Items || []));
      lastEvaluatedKey = queryResult.LastEvaluatedKey;
      pagesScanned++;
      // Bound the work so a filter matching nothing cannot run until timeout.
    } while (lastEvaluatedKey && items.length < wantedLimit && pagesScanned < 10);

    const pageItems = items.slice(0, wantedLimit);

    // Transform results
    const thoughts: Thought[] = pageItems
      .map(item => unmarshall(item) as DynamoThought)
      .map(formatThought);

    // Create cursor for pagination. If the fill loop over-read, resume from the
    // last item actually returned rather than from where scanning stopped, or
    // the surplus items would be skipped.
    let cursor: string | undefined;
    if (items.length > wantedLimit) {
      const lastReturned = pageItems[pageItems.length - 1];
      cursor = Buffer.from(JSON.stringify({
        pk: lastReturned.pk,
        sk: lastReturned.sk,
      })).toString('base64');
    } else if (lastEvaluatedKey) {
      cursor = Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64');
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