import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  createOpenSearchClient,
  getAuthUser,
  validationError,
  internalError,
  jsonResponse,
} from '../../lib/shared';
import type { SearchHit } from '../../lib/shared';

const opensearch = createOpenSearchClient();
const SEARCH_COLLECTION = process.env.SEARCH_COLLECTION!;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const startTime = Date.now();

  try {
    const userOrError = getAuthUser(event);
    if (typeof userOrError !== 'string') return userOrError;
    const user = userOrError;

    const params = event.queryStringParameters || {};
    const query = params.q;

    if (!query?.trim()) return validationError('Query parameter "q" is required');

    const limit = Math.min(parseInt(params.limit || '20', 10), 100);

    // Build filters
    const must: any[] = [
      { term: { user } },
      // Only search thoughts, not conversations
      {
        bool: {
          should: [
            { term: { docType: 'thought' } },
            { bool: { must_not: { exists: { field: 'docType' } } } },
          ],
        },
      },
    ];

    if (params.type) must.push({ term: { type: params.type } });
    if (params.tag) must.push({ terms: { tags: params.tag.split(',') } });
    if (params.from) must.push({ range: { created_at_epoch: { gte: new Date(params.from).getTime() } } });

    // BM25 text search — no embeddings, no LLM
    const response = await opensearch.search({
      index: `${SEARCH_COLLECTION}-thoughts`,
      body: {
        size: limit,
        query: {
          bool: {
            must: [
              { multi_match: { query: query.trim(), fields: ['text^2', 'summary^1.5', 'tags'], type: 'best_fields', fuzziness: 'AUTO' } },
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
        sort: [{ _score: { order: 'desc' } }, { created_at_epoch: { order: 'desc' } }],
      },
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
    return jsonResponse(200, { results, totalCount, processingTime }, { 'X-Processing-Time': processingTime.toString() });
  } catch (error) {
    console.error('Search error:', error);
    return internalError('Search failed', event.requestContext.requestId);
  }
};
