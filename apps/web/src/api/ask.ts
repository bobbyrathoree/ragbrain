import { api } from './client'
import type { AskResponse } from '@/types'

interface AskRequest {
  query: string
  timeWindowDays?: number
}

export const askApi = {
  ask: (query: string, timeWindowDays?: number) =>
    api.post<AskResponse>('/ask', { query, timeWindowDays } as AskRequest),
}
