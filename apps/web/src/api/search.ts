import { api } from './client'
import type { SearchResponse } from '@/types'

export const searchApi = {
  search: (q: string, opts?: { limit?: number; type?: string; tag?: string }) => {
    const params = new URLSearchParams({ q })
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.type) params.set('type', opts.type)
    if (opts?.tag) params.set('tag', opts.tag)
    return api.get<SearchResponse>(`/search?${params}`)
  },
}
