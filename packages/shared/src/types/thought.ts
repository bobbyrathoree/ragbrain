export interface Thought {
  id: string;
  user: string;
  createdAt: string;
  text: string;
  type: ThoughtType;
  tags: string[];
  context?: CaptureContext;
  derived?: DerivedFields;
  syncStatus?: SyncStatus;
  syncedAt?: string;
}

export enum ThoughtType {
  THOUGHT = 'thought',
  CODE = 'code',
  LINK = 'link',
  TODO = 'todo',
  DECISION = 'decision',
  INSIGHT = 'insight',
}

export interface CaptureContext {
  app?: string;
  windowTitle?: string;
  repo?: string;
  branch?: string;
  file?: string;
}

export type ThoughtCategory =
  | 'engineering'
  | 'design'
  | 'product'
  | 'personal'
  | 'learning'
  | 'decision'
  | 'other';

export type ThoughtIntent =
  | 'thought'
  | 'question'
  | 'decision'
  | 'todo'
  | 'idea'
  | 'bug-report'
  | 'feature-request'
  | 'insight';

export interface DerivedFields {
  summary?: string;
  decisionScore?: number;
  embeddingId?: string;
  autoTags?: string[];
  category?: ThoughtCategory;
  intent?: ThoughtIntent;
  entities?: string[];
  relatedIds?: string[];
  sentiment?: 'positive' | 'negative' | 'neutral';
  importance?: number;
}

export enum SyncStatus {
  PENDING = 'pending',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  FAILED = 'failed',
}

export interface ThoughtPayload {
  id?: string;
  createdAt?: string;
  text: string;
  type: ThoughtType;
  tags: string[];
  context?: CaptureContext;
}