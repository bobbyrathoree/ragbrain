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
  NOTE = 'note',
  CODE = 'code',
  LINK = 'link',
  TODO = 'todo',
  DECISION = 'decision',
  RATIONALE = 'rationale',
}

export interface CaptureContext {
  app?: string;
  windowTitle?: string;
  repo?: string;
  branch?: string;
  file?: string;
}

export interface DerivedFields {
  summary?: string;
  decisionScore?: number;
  embeddingId?: string;
  autoTags?: string[];
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