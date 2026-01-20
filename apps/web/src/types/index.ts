export type ThoughtType = 'thought' | 'decision' | 'insight' | 'code' | 'todo' | 'link'

export interface Thought {
  id: string
  text: string
  type: ThoughtType
  tags: string[]
  createdAt: string
  updatedAt?: string
}

export interface AskResponse {
  answer: string
  confidence: number
  citations: Citation[]
  processingTime: number
}

export interface Citation {
  id: string
  preview: string
  type: string
  score: number
  createdAt: string
  tags?: string[]
}

export interface GraphNode {
  id: string
  label: string
  themeId: string
  x: number
  y: number
  tags: string[]
  recency: number
  importance: number
  type: string
  // D3 force simulation adds these dynamically
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  source: string
  target: string
  similarity: number
}

export interface GraphTheme {
  id: string
  label: string
  description: string
  color: string
  count: number
  sampleThoughts: { id: string; text: string }[]
}

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
