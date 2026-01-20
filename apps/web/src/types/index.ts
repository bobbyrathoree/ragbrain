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
  cluster: string
  x: number
  y: number
  z: number
  importance: number
  tags?: string[]
  recency?: number
  type?: string
}

export interface GraphEdge {
  source: string
  target: string
  similarity: number  // Renamed from weight to match backend
}

export interface GraphCluster {
  id: string
  label: string
  color: string
  count: number
  nodeIds?: string[]
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  clusters: GraphCluster[]
}
