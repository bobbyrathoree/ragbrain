import { Thought } from './thought';

// Request types
export interface CaptureRequest {
  id?: string;
  createdAt?: string;
  text: string;
  type: string;
  tags: string[];
  context?: {
    app?: string;
    windowTitle?: string;
    repo?: string;
    branch?: string;
    file?: string;
  };
}

export interface AskRequest {
  query: string;
  timeWindow?: string; // e.g., "90d", "1y"
  tags?: string[];
  limit?: number;
}

export interface ThoughtsRequest {
  from?: string;
  to?: string;
  tag?: string;
  type?: string;
  limit?: number;
  cursor?: string;
}

export interface GraphRequest {
  month?: string; // YYYY-MM
  minSimilarity?: number;
}

// Response types
export interface CaptureResponse {
  id: string;
  createdAt: string;
  message?: string;
}

export interface Citation {
  id: string;
  createdAt: string;
  preview: string;
  score: number;
  type?: string;
  tags?: string[];
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  confidence?: number;
  processingTime?: number;
}

export interface ThoughtsResponse {
  thoughts: Thought[];
  cursor?: string;
  hasMore: boolean;
  totalCount?: number;
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  z?: number;
  tags: string[];
  recency: number;
  importance: number;
  type: string;
  clusterId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  similarity: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters?: {
    id: string;
    label: string;
    color: string;
    nodeIds: string[];
  }[];
  metadata?: {
    totalNodes: number;
    totalEdges: number;
    generatedAt: string;
    algorithm: string;
  };
}

// Error response
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  requestId?: string;
}