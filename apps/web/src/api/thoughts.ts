import { api } from './client'
import type { Thought } from '@/types'

interface ListThoughtsResponse {
  thoughts: Thought[]
  nextToken?: string
}

export const thoughtsApi = {
  list: (limit = 50, nextToken?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (nextToken) params.set('nextToken', nextToken)
    return api.get<ListThoughtsResponse>(`/thoughts?${params}`)
  },

  get: (id: string) => api.get<Thought>(`/thoughts/${id}`),

  create: (content: string, type?: string, tags?: string[]) =>
    api.post<Thought>('/thoughts', { content, type, tags }),

  update: (id: string, content: string) =>
    api.put<Thought>(`/thoughts/${id}`, { content }),

  delete: (id: string) => api.delete<void>(`/thoughts/${id}`),
}
