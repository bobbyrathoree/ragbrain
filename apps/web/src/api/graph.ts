import { api } from './client'
import type { GraphData } from '@/types'

export const graphApi = {
  get: () => api.get<GraphData>('/graph'),
}
