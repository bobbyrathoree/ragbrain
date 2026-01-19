export type ThoughtType = 'thought' | 'decision' | 'insight' | 'code' | 'todo' | 'link'

export interface Thought {
  id: string
  content: string
  type: ThoughtType
  tags: string[]
  createdAt: string
  updatedAt?: string
}

export interface AskResponse {
  answer: string
  confidence: number
  citations: Citation[]
  processingTimeMs: number
}

export interface Citation {
  thoughtId: string
  content: string
  type: ThoughtType
  score: number
  createdAt: string
}

export interface GraphNode {
  id: string
  label: string
  cluster: string
  x: number
  y: number
  z: number
  importance: number
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
