import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const {
  SEARCH_ENDPOINT,
  SEARCH_COLLECTION,
  AWS_REGION,
} = process.env;

const opensearchClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION!,
    service: 'aoss',
    getCredentials: defaultProvider(),
  }),
  node: SEARCH_ENDPOINT,
});

interface SearchHit {
  _id: string;
  _score: number;
  _source: {
    id: string;
    text: string;
    summary?: string;
    tags: string[];
    type: string;
    created_at_epoch: number;
    user: string;
    docType?: string;
  };
  highlight?: {
    text?: string[];
    summary?: string[];
  };
}

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  try {
    const user = event.requestContext.authorizer?.lambda?.user;
    if (!user) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Authentication context missing' }),
      };
    }

    const params = event.queryStringParameters || {};
    const query = params.q;

    if (!query || query.trim().length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Query parameter "q" is required' }),
      };
    }

    const limit = Math.min(parseInt(params.limit || '20', 10), 100);

    // Build filter conditions
    const must: any[] = [
      { term: { user } },
    ];

    // Only search thoughts, not conversations
    must.push({
      bool: {
        should: [
          { term: { docType: 'thought' } },
          { bool: { must_not: { exists: { field: 'docType' } } } },
        ],
      },
    });

    if (params.type) {
      must.push({ term: { type: params.type } });
    }

    if (params.tag) {
      must.push({ terms: { tags: params.tag.split(',') } });
    }

    if (params.from) {
      must.push({
        range: {
          created_at_epoch: { gte: new Date(params.from).getTime() },
        },
      });
    }

    // BM25 text search - no embeddings, no LLM
    const searchBody = {
      size: limit,
      query: {
        bool: {
          must: [
            {
              multi_match: {
                query: query.trim(),
                fields: ['text^2', 'summary^1.5', 'tags'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
            ...must,
          ],
        },
      },
      highlight: {
        fields: {
          text: { fragment_size: 150, number_of_fragments: 2 },
          summary: { fragment_size: 150, number_of_fragments: 1 },
        },
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
      },
      sort: [
        { _score: { order: 'desc' } },
        { created_at_epoch: { order: 'desc' } },
      ],
    };

    const response = await opensearchClient.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: searchBody,
    });

    const hits = (response.body.hits.hits || []) as SearchHit[];
    const totalCount = typeof response.body.hits.total === 'object'
      ? response.body.hits.total.value
      : response.body.hits.total || 0;

    const results = hits.map(hit => ({
      id: hit._source.id,
      text: hit._source.text,
      type: hit._source.type,
      tags: hit._source.tags || [],
      score: hit._score,
      highlight: hit.highlight?.text?.[0] || hit.highlight?.summary?.[0] || undefined,
      createdAt: new Date(hit._source.created_at_epoch).toISOString(),
    }));

    const processingTime = Date.now() - startTime;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Processing-Time': processingTime.toString(),
      },
      body: JSON.stringify({
        results,
        totalCount,
        processingTime,
      }),
    };

  } catch (error) {
    console.error('Search error:', error);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Search failed',
        requestId: event.requestContext.requestId,
      }),
    };
  }
};
