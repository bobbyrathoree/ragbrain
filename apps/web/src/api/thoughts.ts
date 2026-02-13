import { api } from './client'
import type { Thought } from '@/types'

interface ListThoughtsResponse {
  thoughts: Thought[]
  cursor?: string
  hasMore?: boolean
  totalCount?: number
}

export const thoughtsApi = {
  list: (limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return api.get<ListThoughtsResponse>(`/thoughts?${params}`)
  },

  get: (id: string) => api.get<Thought>(`/thoughts/${id}`),

  create: (content: string, type?: string, tags?: string[]) =>
    api.post<Thought>('/thoughts', { text: content, type, tags }),

  update: (id: string, content: string) =>
    api.put<Thought>(`/thoughts/${id}`, { text: content }),

  delete: (id: string) => api.delete<void>(`/thoughts/${id}`),
}
