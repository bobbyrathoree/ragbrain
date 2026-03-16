import { api } from './client'
import type { GraphData, GalaxyOverview, ConstellationView } from '@/types'

/**
 * Graph API client with fallback for pre-LOD backend.
 * When the deployed Lambda supports ?level=overview, the overview() call works directly.
 * When it doesn't (old backend), we fall back to GET /graph and transform the legacy response.
 */
export const graphApi = {
  overview: async (): Promise<GalaxyOverview> => {
    try {
      const data = await api.get<GalaxyOverview | GraphData>('/graph?level=overview')
      // Check if this is the new LOD response or a legacy GraphResponse
      if ('level' in data && data.level === 0) {
        return data as GalaxyOverview
      }
      // Legacy fallback: transform GraphResponse → GalaxyOverview
      const legacy = data as GraphData
      return {
        level: 0,
        themes: (legacy.themes || []).map(t => ({
          id: t.id,
          label: t.label,
          description: t.description,
          color: t.color,
          count: t.count,
          recentCount: 0,
          topTags: [],
          sampleThoughts: t.sampleThoughts,
        })),
        affinities: [],
        metadata: {
          totalThoughts: legacy.nodes?.length || 0,
          generatedAt: legacy.metadata?.generatedAt || new Date().toISOString(),
        },
      }
    } catch {
      // Full fallback: try legacy endpoint
      const legacy = await api.get<GraphData>('/graph')
      return {
        level: 0,
        themes: (legacy.themes || []).map(t => ({
          id: t.id,
          label: t.label,
          description: t.description,
          color: t.color,
          count: t.count,
          recentCount: 0,
          topTags: [],
          sampleThoughts: t.sampleThoughts,
        })),
        affinities: [],
        metadata: {
          totalThoughts: legacy.nodes?.length || 0,
          generatedAt: new Date().toISOString(),
        },
      }
    }
  },

  theme: async (id: string): Promise<ConstellationView> => {
    // Try new LOD endpoint, detect legacy response, or catch errors
    const data = await api.get<ConstellationView | GraphData>('/graph?level=theme&themeId=' + id)
      .catch(() => api.get<GraphData>('/graph'))

    // If the response has the new LOD format, return directly
    if ('level' in data && data.level === 1 && 'thoughts' in data) {
      return data as ConstellationView
    }

    // Legacy fallback: transform GraphResponse → ConstellationView
    {
      const legacy = data as GraphData
      const themeNodes = (legacy.nodes || []).filter(n => n.themeId === id)
      const theme = legacy.themes?.find(t => t.id === id)
      const nodeIds = new Set(themeNodes.map(n => n.id))

      return {
        level: 1,
        themeId: id,
        themeLabel: theme?.label || 'Unknown',
        themeColor: theme?.color || '#888888',
        thoughts: themeNodes.slice(0, 500).map(n => ({
          id: n.id,
          text: n.label,
          type: n.type,
          tags: n.tags,
          importance: n.importance,
          recency: n.recency,
        })),
        edges: (legacy.edges || [])
          .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
          .map(e => ({ source: e.source, target: e.target, similarity: e.similarity })),
      };
    }
  },

  get: () => api.get<GraphData>('/graph'),
}
