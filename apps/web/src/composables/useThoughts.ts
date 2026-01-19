import { ref } from 'vue'
import { thoughtsApi } from '@/api'
import type { Thought } from '@/types'

const thoughts = ref<Thought[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useThoughts() {
  const fetchThoughts = async () => {
    isLoading.value = true
    error.value = null
    try {
      const response = await thoughtsApi.list()
      thoughts.value = response.thoughts
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch thoughts'
    } finally {
      isLoading.value = false
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
    error,
    fetchThoughts,
    createThought,
    deleteThought,
  }
}
