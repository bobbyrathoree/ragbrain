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

// ============ Conversation Types ============

export type ConversationStatus = 'active' | 'archived';
export type MessageRole = 'user' | 'assistant';

export interface Conversation {
  id: string;
  user: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: ConversationStatus;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string; // Decrypted for API response
  citations?: Citation[];
  searchedThoughts?: string[];
  confidence?: number;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
  status: ConversationStatus;
}

// Conversation Requests
export interface CreateConversationRequest {
  title?: string;
  initialMessage?: string;
  context?: {
    thoughtIds?: string[];
    tags?: string[];
    timeWindow?: string;
  };
}

export interface SendMessageRequest {
  content: string;
  timeWindow?: string;
  tags?: string[];
  includeHistory?: number; // Default: 10
}

export interface ListConversationsRequest {
  limit?: number;
  cursor?: string;
  status?: ConversationStatus;
}

export interface UpdateConversationRequest {
  title?: string;
  status?: ConversationStatus;
}

// Conversation Responses
export interface CreateConversationResponse {
  id: string;
  title: string;
  createdAt: string;
  messages?: ConversationMessage[];
}

export interface SendMessageResponse {
  userMessage: ConversationMessage;
  assistantMessage: ConversationMessage;
  processingTime: number;
}

export interface GetConversationResponse {
  conversation: Conversation;
  messages: ConversationMessage[];
  cursor?: string;
  hasMore: boolean;
}

export interface ListConversationsResponse {
  conversations: ConversationSummary[];
  cursor?: string;
  hasMore: boolean;
  totalCount?: number;
}