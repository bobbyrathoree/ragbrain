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
import { Citation, calculateRecencyScore, parseTimeWindow } from '@ragbrain/shared';
import { MODELS, EMBED_MAX_CHARS, SEARCH_WEIGHTS, MIN_CITATION_SCORE } from './config';
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
    }),
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
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
}

export async function hybridSearch(
  client: Client,
  collection: string,
  query: string,
  embedding: number[],
  filters: SearchFilters,
  options: { size?: number; knnK?: number } = {},
): Promise<SearchHit[]> {
  const { size = 100, knnK = 50 } = options;
  const must: any[] = [{ term: { user: filters.user } }];

  if (filters.tags?.length) {
    must.push({ terms: { tags: filters.tags } });
  }

  if (filters.timeWindow) {
    const fromDate = parseTimeWindow(filters.timeWindow);
    must.push({ range: { created_at_epoch: { gte: fromDate.getTime() } } });
  }

  const searchBody = {
    size,
    query: {
      hybrid: {
        queries: [
          {
            multi_match: {
              query,
              fields: ['text^2', 'summary^1.5', 'tags'],
              type: 'best_fields',
              fuzziness: 'AUTO',
            },
          },
          {
            knn: {
              embedding: { vector: embedding, k: knnK },
            },
          },
        ],
      },
    },
    filter: { bool: { must } },
    highlight: {
      fields: {
        text: { fragment_size: 150, number_of_fragments: 2 },
        summary: {},
      },
    },
  };

  try {
    const response = await client.search({
      index: `${collection}-thoughts`,
      body: searchBody,
    });
    return response.body.hits.hits as SearchHit[];
  } catch (error) {
    console.error('Hybrid search failed, falling back to BM25:', error);
    return bm25Fallback(client, collection, query, must, Math.min(size, 50));
  }
}

async function bm25Fallback(
  client: Client,
  collection: string,
  query: string,
  must: any[],
  size: number,
): Promise<SearchHit[]> {
  const response = await client.search({
    index: `${collection}-thoughts`,
    body: {
      size,
      query: {
        bool: {
          must: [
            { multi_match: { query, fields: ['text', 'summary', 'tags'] } },
            ...must,
          ],
        },
      },
      highlight: { fields: { text: { fragment_size: 150 } } },
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
      if (hit._score >= MIN_CITATION_SCORE) {
        citations.push({
          id: hit._source.id,
          createdAt: new Date(hit._source.created_at_epoch).toISOString(),
          preview: hit._source.text.substring(0, 300),
          score: hit._score,
          type: hit._source.type,
          tags: hit._source.tags,
        });
      }
    }
  }

  return citations;
}

export function calculateConfidence(citations: Citation[]): number {
  if (citations.length === 0) return 0.3;
  return Math.min(0.95, citations.reduce((sum, c) => sum + c.score, 0) / citations.length);
}

// ── Score Normalization ─────────────────────────────────────────

export function normalizeScores<T extends { score: number }>(items: T[]): T[] {
  if (items.length === 0) return items;

  const scores = items.map(i => i.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  return items.map(item => ({
    ...item,
    score: Number(((item.score - min) / range).toFixed(3)),
  }));
}
