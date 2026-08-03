/**
 * Shared search module — the single source of truth for:
 *   - Embedding generation (Titan)
 *   - Hybrid search (BM25 + k-NN)
 *   - Score fusion (relevance + recency + decision)
 *   - Query rewriting
 *   - Citation extraction
 *
 * Used by: ask, conversations, (and available to search if needed).
 * Previously duplicated across ask/index.ts and conversations/index.ts.
 */
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Citation, calculateRecencyScore, parseTimeWindow } from '@ragbrain/shared';
import { MODELS, EMBED_DIMENSIONS, EMBED_MAX_CHARS, SEARCH_WEIGHTS } from './config';
import { emitMetrics } from './metrics';
import { reciprocalRankFusion } from './search-core';
import { assertEmbeddingDimensions } from './search-index';
import type { SearchHit } from './types';

// ── Embeddings ──────────────────────────────────────────────────

export async function generateEmbedding(
  bedrock: BedrockRuntimeClient,
  text: string,
): Promise<number[]> {
  const response = await bedrock.send(new InvokeModelCommand({
    modelId: MODELS.EMBED,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.substring(0, EMBED_MAX_CHARS),
      dimensions: EMBED_DIMENSIONS,
      normalize: true,
    }),
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  assertEmbeddingDimensions(result.embedding, EMBED_DIMENSIONS);
  return result.embedding;
}

// ── Query Rewriting ─────────────────────────────────────────────

export interface QueryRewrite {
  expandedQuery: string;
  keywords: string[];
  timeHints: string[];
  tags: string[];
}

const SYNONYM_MAP: Record<string, string[]> = {
  why: ['reason', 'rationale', 'because', 'decision', 'chose'],
  how: ['method', 'approach', 'implementation', 'process'],
  what: ['definition', 'meaning', 'description'],
  bug: ['error', 'issue', 'problem', 'broken', 'fix'],
  performance: ['speed', 'slow', 'optimize', 'fast', 'latency'],
};

const TIME_PATTERNS = [
  /yesterday/gi,
  /last\s+week/gi,
  /last\s+month/gi,
  /today/gi,
  /this\s+week/gi,
];

export function rewriteQuery(query: string): QueryRewrite {
  // Extract tags
  const tagPattern = /#(\w+)/g;
  const tags: string[] = [];
  let match;
  while ((match = tagPattern.exec(query)) !== null) {
    tags.push(match[1].toLowerCase());
  }

  // Detect time hints
  const timeHints: string[] = [];
  for (const pattern of TIME_PATTERNS) {
    if (pattern.test(query)) {
      timeHints.push(pattern.source);
    }
  }

  // Expand with synonyms
  const lower = query.toLowerCase();
  const keywords: string[] = [];
  for (const [key, synonyms] of Object.entries(SYNONYM_MAP)) {
    if (lower.includes(key)) keywords.push(...synonyms);
  }

  // Add original significant words
  const words = lower.split(/\s+/).filter(w => w.length > 2 && !w.startsWith('#'));
  keywords.push(...words);

  return {
    expandedQuery: [...new Set([query, ...keywords])].join(' '),
    keywords: [...new Set(keywords)],
    timeHints,
    tags,
  };
}

// ── Hybrid Search ───────────────────────────────────────────────

export interface SearchFilters {
  user: string;
  tags?: string[];
  timeWindow?: string;
  types?: string[];
  docTypes?: Array<'thought' | 'conversation'>;
  fromEpoch?: number;
}

export type SearchMode = 'hybrid' | 'bm25-fallback';

export interface HybridSearchResult {
  hits: SearchHit[];
  mode: SearchMode;
}

interface SearchOptions {
  size?: number;
  knnK?: number;
  cloudwatch?: CloudWatchClient;
}

function buildFilterClauses(filters: SearchFilters): any[] {
  const clauses: any[] = [{ term: { user: filters.user } }];

  if (filters.tags?.length) {
    clauses.push({ terms: { tags: filters.tags } });
  }

  if (filters.types?.length) {
    clauses.push({ terms: { type: filters.types } });
  }

  if (filters.docTypes?.length) {
    clauses.push({ terms: { docType: filters.docTypes } });
  }

  if (filters.timeWindow) {
    const fromDate = parseTimeWindow(filters.timeWindow);
    clauses.push({ range: { created_at_epoch: { gte: fromDate.getTime() } } });
  }

  if (filters.fromEpoch) {
    clauses.push({ range: { created_at_epoch: { gte: filters.fromEpoch } } });
  }

  return clauses;
}

export async function hybridSearch(
  client: Client,
  collection: string,
  query: string,
  embedding: number[],
  filters: SearchFilters,
  options: SearchOptions = {},
): Promise<HybridSearchResult> {
  const { size = 100, knnK = 50, cloudwatch } = options;
  const filter = buildFilterClauses(filters);
  const candidateSize = Math.max(size, knnK);

  const lexicalPromise = bm25Search(
    client,
    collection,
    query,
    filters,
    candidateSize,
  );
  const semanticPromise = client.search({
    index: `${collection}-thoughts`,
    body: {
      size: knnK,
      query: {
        bool: {
          must: [{
            knn: {
              embedding: {
                vector: embedding,
                k: knnK,
              },
            },
          }],
          filter,
        },
      },
    },
  });

  const [lexical, semantic] = await Promise.allSettled([
    lexicalPromise,
    semanticPromise,
  ]);

  if (lexical.status === 'rejected') {
    throw lexical.reason;
  }

  if (semantic.status === 'rejected') {
    console.error('Hybrid search failed, falling back to BM25:', semantic.reason);
    if (cloudwatch) {
      await emitMetrics(cloudwatch, [{
        name: 'HybridSearchFallback',
        value: 1,
      }]);
    }
    return {
      hits: lexical.value.slice(0, Math.min(size, 50)),
      mode: 'bm25-fallback',
    };
  }

  const semanticHits = semantic.value.body.hits.hits as SearchHit[];
  return {
    hits: reciprocalRankFusion(lexical.value, semanticHits).slice(0, size),
    mode: 'hybrid',
  };
}

export async function bm25Search(
  client: Client,
  collection: string,
  query: string,
  filters: SearchFilters,
  size: number,
): Promise<SearchHit[]> {
  const filter = buildFilterClauses(filters);
  const response = await client.search({
    index: `${collection}-thoughts`,
    body: {
      size,
      query: {
        bool: {
          must: [{
            multi_match: {
              query,
              fields: ['text^2', 'summary^1.5', 'tags', 'title'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          }],
          filter,
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
    },
  });
  return response.body.hits.hits as SearchHit[];
}

// ── Score Fusion ────────────────────────────────────────────────

export function scoreAndRank(hits: SearchHit[]): SearchHit[] {
  const scored = hits.map(hit => {
    const base = hit._score || 0;
    const recency = calculateRecencyScore(new Date(hit._source.created_at_epoch));
    const decision = hit._source.decision_score || 0;

    return {
      ...hit,
      _score:
        base * SEARCH_WEIGHTS.relevance +
        recency * SEARCH_WEIGHTS.recency +
        decision * SEARCH_WEIGHTS.decision,
    };
  });

  return scored.sort((a, b) => b._score - a._score);
}

// ── Citation Extraction ─────────────────────────────────────────

export function extractCitations(
  answer: string,
  context: SearchHit[],
): Citation[] {
  const pattern = /\[(\d+)\]/g;
  const used = new Set<number>();
  let m;
  while ((m = pattern.exec(answer)) !== null) {
    used.add(parseInt(m[1]) - 1);
  }

  const citations: Citation[] = [];
  for (const index of used) {
    if (index < context.length) {
      const hit = context[index];
      citations.push({
        id: hit._source.id,
        createdAt: new Date(hit._source.created_at_epoch).toISOString(),
        preview: hit._source.text.substring(0, 300),
        ...(hit._source.type ? { type: hit._source.type } : {}),
        ...(hit._source.tags?.length ? { tags: hit._source.tags } : {}),
      });
    }
  }

  return citations;
}
