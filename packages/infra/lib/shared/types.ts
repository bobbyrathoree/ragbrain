/**
 * Backend-specific types shared across Lambda handlers.
 * These describe OpenSearch documents and internal structures,
 * not API request/response shapes (those live in @ragbrain/shared).
 */

export interface SearchHit {
  _id: string;
  _score: number;
  _source: {
    id: string;
    text: string;
    summary: string;
    tags: string[];
    type: string;
    created_at_epoch: number;
    decision_score: number;
    embedding?: number[];
    user: string;
    // Conversation-specific fields
    docType?: 'thought' | 'conversation';
    title?: string;
    messageCount?: number;
    citedThoughtIds?: string[];
    updated_at_epoch?: number;
  };
  highlight?: {
    text?: string[];
    summary?: string[];
  };
}
