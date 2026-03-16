/**
 * Centralized configuration for all Lambda functions.
 * Model IDs, environment variables, and constants live here
 * so changes propagate to every handler automatically.
 */

// AI Model configuration
// Sonnet for high-quality reasoning (ask answers), Haiku for fast processing (tags, themes, summaries)
export const MODELS = {
  EMBED: 'amazon.titan-embed-text-v1',
  REASONING: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  FAST: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

export const EMBED_MAX_CHARS = 8192;
export const EMBED_DIMENSIONS = 1024;

// Search scoring weights — single source of truth for ask + conversations
export const SEARCH_WEIGHTS = {
  relevance: 0.4,
  recency: 0.15,
  decision: 0.05,
} as const;

export const MIN_CITATION_SCORE = 0.3;

// Environment helpers
export function env(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export function optionalEnv(key: string): string | undefined {
  return process.env[key];
}
