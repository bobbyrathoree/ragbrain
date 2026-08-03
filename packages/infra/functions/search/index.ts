import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  bm25Search,
  createBedrockClient,
  createCloudWatchClient,
  createOpenSearchClient,
  generateEmbedding,
  getAuthUser,
  hybridSearch,
  rewriteQuery,
  validationError,
  internalError,
  jsonResponse,
} from '../../lib/shared';
import { sanitizeHighlightSnippet } from '../../lib/shared/sanitization';
import type { SearchHit } from '../../lib/shared';

const opensearch = createOpenSearchClient();
const bedrock = createBedrockClient();
const cloudwatch = createCloudWatchClient();
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

    const limit = Math.min(Math.max(parseInt(params.limit || '20', 10), 1), 100);
    const requestedMode = params.mode === 'bm25' ? 'bm25' : 'hybrid';
    const filters = {
      user,
      tags: params.tag ? params.tag.split(',') : undefined,
      types: params.type ? [params.type] : undefined,
      docTypes: params.scope === 'all'
        ? undefined
        : ['thought' as const],
      fromEpoch: params.from ? new Date(params.from).getTime() : undefined,
    };

    let hits: SearchHit[];
    let searchMode: 'hybrid' | 'bm25' | 'bm25-fallback';

    if (requestedMode === 'bm25') {
      hits = await bm25Search(opensearch, SEARCH_COLLECTION, query.trim(), filters, limit);
      searchMode = 'bm25';
    } else {
      const embedding = await generateEmbedding(bedrock, query);
      const { expandedQuery } = rewriteQuery(query);
      const execution = await hybridSearch(
        opensearch,
        SEARCH_COLLECTION,
        expandedQuery,
        embedding,
        filters,
        { size: limit, knnK: Math.max(limit, 50), cloudwatch },
      );
      hits = execution.hits;
      searchMode = execution.mode;
    }

    const results = hits.map(hit => ({
      id: hit._source.id,
      text: hit._source.text,
      title: hit._source.title,
      docType: hit._source.docType || 'thought',
      type: hit._source.type || hit._source.docType || 'thought',
      tags: hit._source.tags || [],
      score: hit._score,
      highlight: sanitizeHighlightSnippet(
        hit.highlight?.text?.[0] || hit.highlight?.summary?.[0] || undefined,
      ),
      createdAt: new Date(hit._source.created_at_epoch).toISOString(),
    }));

    const processingTime = Date.now() - startTime;
    return jsonResponse(
      200,
      {
        results,
        totalCount: results.length,
        searchMode,
        processingTime,
      },
      { 'X-Processing-Time': processingTime.toString() },
    );
  } catch (error) {
    console.error('Search error:', error);
    return internalError('Search failed', event.requestContext.requestId);
  }
};
