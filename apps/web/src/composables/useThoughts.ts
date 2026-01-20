import { ref } from 'vue'
import { thoughtsApi } from '@/api'
import type { Thought } from '@/types'

const thoughts = ref<Thought[]>([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const error = ref<string | null>(null)
const cursor = ref<string | undefined>(undefined)
const hasMore = ref(true)

export function useThoughts() {
  const fetchThoughts = async (limit = 50) => {
    isLoading.value = true
    error.value = null
    cursor.value = undefined
    hasMore.value = true
    try {
      const response = await thoughtsApi.list(limit)
      thoughts.value = response.thoughts
      cursor.value = response.cursor
      hasMore.value = response.hasMore ?? !!response.cursor
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch thoughts'
    } finally {
      isLoading.value = false
    }
  }

  const fetchMoreThoughts = async (limit = 50) => {
    if (!hasMore.value || isLoadingMore.value || !cursor.value) return

    isLoadingMore.value = true
    try {
      const response = await thoughtsApi.list(limit, cursor.value)
      thoughts.value.push(...response.thoughts)
      cursor.value = response.cursor
      hasMore.value = response.hasMore ?? !!response.cursor
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch more thoughts'
    } finally {
      isLoadingMore.value = false
    }
  }

  const createThought = async (content: string, type?: string, tags?: string[]) => {
    try {
      const thought = await thoughtsApi.create(content, type, tags)
      thoughts.value.unshift(thought)
      return thought
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create thought'
      throw e
    }
  }

  const deleteThought = async (id: string) => {
    try {
      await thoughtsApi.delete(id)
      thoughts.value = thoughts.value.filter((t) => t.id !== id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete thought'
      throw e
    }
  }

  return {
    thoughts,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    fetchThoughts,
    fetchMoreThoughts,
    createThought,
    deleteThought,
  }
}
