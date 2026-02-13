import { ref } from 'vue'
import { searchApi } from '@/api'
import type { SearchResult } from '@/types'

const searchQuery = ref('')
const searchResults = ref<SearchResult[]>([])
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const totalCount = ref(0)
const processingTime = ref(0)

export function useSearch() {
  const search = async (query: string, opts?: { type?: string; tag?: string }) => {
    if (!query.trim()) {
      clearSearch()
      return
    }

    isSearching.value = true
    searchError.value = null
    searchQuery.value = query

    try {
      const response = await searchApi.search(query, { limit: 30, ...opts })
      searchResults.value = response.results
      totalCount.value = response.totalCount
      processingTime.value = response.processingTime
    } catch (e) {
      searchError.value = e instanceof Error ? e.message : 'Search failed'
      searchResults.value = []
    } finally {
      isSearching.value = false
    }
  }

  const clearSearch = () => {
    searchQuery.value = ''
    searchResults.value = []
    searchError.value = null
    totalCount.value = 0
    processingTime.value = 0
  }

  return {
    searchQuery,
    searchResults,
    isSearching,
    searchError,
    totalCount,
    processingTime,
    search,
    clearSearch,
  }
}
