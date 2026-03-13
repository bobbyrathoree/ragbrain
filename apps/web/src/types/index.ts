/**
 * Frontend types — re-exported from @ragbrain/shared (single source of truth)
 * plus frontend-specific extensions.
 *
 * Previously a 126-line standalone file that drifted from the backend types.
 * Now the web app, Lambda handlers, and shared package all use the same definitions.
 */
import type {
  ThoughtType as SharedThoughtType,
  Citation as SharedCitation,
  GraphNode as SharedGraphNode,
  GraphEdge as SharedGraphEdge,
  GraphTheme as SharedGraphTheme,
  ConversationSummary as SharedConvSummary,
  ConversationMessage as SharedConvMessage,
} from '@ragbrain/shared'

// Re-export core types
export type ThoughtType = SharedThoughtType
export type Citation = SharedCitation
export type GraphEdge = SharedGraphEdge
export type GraphTheme = SharedGraphTheme
export type ConversationSummary = SharedConvSummary
export type ConversationMessage = SharedConvMessage

// Re-export the const for runtime usage (type detection list)
export { ThoughtType as ThoughtTypeValues } from '@ragbrain/shared'

// Frontend Thought — matches the shape returned by GET /thoughts
// (subset of the full Thought model which includes user, derived, sync fields)
export interface Thought {
  id: string
  text: string
  type: ThoughtType
  tags: string[]
  createdAt: string
  updatedAt?: string
}

// AskResponse with required confidence/processingTime for frontend display
export interface AskResponse {
  answer: string
  confidence: number
  citations: Citation[]
  processingTime: number
}

// GraphNode extended with D3 force simulation properties
export interface GraphNode extends SharedGraphNode {
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

// Frontend search types
export interface SearchResult {
  id: string
  text: string
  type: string
  tags: string[]
  score: number
  highlight?: string
  createdAt: string
}

export interface SearchResponse {
  results: SearchResult[]
  totalCount: number
  processingTime: number
}

// Graph data bundle used by GraphView
export interface GraphData {
  themes: GraphTheme[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata?: {
    totalNodes: number
    totalEdges: number
    totalThemes: number
    generatedAt: string
    algorithm: string
  }
}

// Conversation detail view
export interface ConversationDetail {
  conversation: ConversationSummary
  messages: ConversationMessage[]
  cursor?: string
  hasMore: boolean
}

export interface ListConversationsResponse {
  conversations: ConversationSummary[]
  cursor?: string
  hasMore: boolean
}

export interface SendMessageResponse {
  userMessage: ConversationMessage
  assistantMessage: ConversationMessage
  processingTime: number
}
