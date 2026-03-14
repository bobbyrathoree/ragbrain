import { api } from './client'
import type { GraphData, GalaxyOverview, ConstellationView } from '@/types'

export const graphApi = {
  overview: () => api.get<GalaxyOverview>('/graph?level=overview'),
  theme: (id: string) => api.get<ConstellationView>(`/graph?level=theme&themeId=${id}`),
  get: () => api.get<GraphData>('/graph'), // backward compat
}
