export interface SearchDocument {
  id: string;
  text: string;
  summary?: string;
  tags: string[];
  type: string;
  createdAtEpoch: number;
  decisionScore?: number;
  embedding?: number[];
  user: string;
  context?: {
    app?: string;
    repo?: string;
    branch?: string;
  };
}

export interface SearchQuery {
  query: string;
  filters?: {
    tags?: string[];
    types?: string[];
    dateRange?: {
      from: string;
      to: string;
    };
    minDecisionScore?: number;
  };
  limit?: number;
  searchType?: 'hybrid' | 'semantic' | 'keyword';
}

export interface SearchResult {
  id: string;
  score: number;
  highlight?: {
    text?: string[];
    summary?: string[];
  };
  document: SearchDocument;
}

export interface HybridSearchParams {
  query: string;
  knnVector?: number[];
  bm25Query?: string;
  weights?: {
    bm25: number;
    knn: number;
    recency: number;
    decision: number;
  };
  limit?: number;
}