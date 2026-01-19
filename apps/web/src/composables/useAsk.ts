import { ref } from 'vue'
import { askApi } from '@/api'
import type { AskResponse } from '@/types'

const isLoading = ref(false)
const error = ref<string | null>(null)
const lastResponse = ref<AskResponse | null>(null)

export function useAsk() {
  const ask = async (query: string, timeWindowDays?: number) => {
    isLoading.value = true
    error.value = null
    lastResponse.value = null

    try {
      const response = await askApi.ask(query, timeWindowDays)
      lastResponse.value = response
      return response
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to get answer'
      throw e
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    error,
    lastResponse,
    ask,
  }
}
