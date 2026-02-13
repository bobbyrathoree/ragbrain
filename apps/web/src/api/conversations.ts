import { api } from './client'
import type {
  ConversationDetail,
  ListConversationsResponse,
  SendMessageResponse,
} from '@/types'

export const conversationsApi = {
  list: (limit = 20, cursor?: string, status?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    if (status) params.set('status', status)
    return api.get<ListConversationsResponse>(`/conversations?${params}`)
  },

  create: (initialMessage?: string, title?: string) =>
    api.post<{ id: string; title: string; createdAt: string; messages?: any[] }>(
      '/conversations',
      { initialMessage, title }
    ),

  get: (id: string, limit = 50, cursor?: string) => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (cursor) params.set('cursor', cursor)
    return api.get<ConversationDetail>(`/conversations/${id}?${params}`)
  },

  sendMessage: (id: string, content: string, timeWindow?: string, tags?: string[]) =>
    api.post<SendMessageResponse>(`/conversations/${id}/messages`, {
      content,
      timeWindow,
      tags,
    }),

  update: (id: string, title?: string, status?: string) =>
    api.put<{ message: string }>(`/conversations/${id}`, { title, status }),

  remove: (id: string) => api.delete<void>(`/conversations/${id}`),
}
