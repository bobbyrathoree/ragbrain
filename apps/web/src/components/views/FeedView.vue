<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useThoughts } from '@/composables/useThoughts'
import type { Thought, ThoughtType } from '@/types'

const MAX_LENGTH = 280

const {
  thoughts,
  isLoading,
  isLoadingMore,
  hasMore,
  fetchThoughts,
  fetchMoreThoughts
} = useThoughts()

// Filtering
const filterType = ref<ThoughtType | 'all'>('all')
const sortOrder = ref<'newest' | 'oldest'>('newest')

// Type accent colors
const typeAccent: Record<string, string> = {
  thought: 'before:bg-stone-400 dark:before:bg-stone-500',
  decision: 'before:bg-violet-500',
  insight: 'before:bg-sky-500',
  code: 'before:bg-emerald-500',
  todo: 'before:bg-amber-500',
  link: 'before:bg-rose-400',
}

// Infinite scroll
const loadMoreRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

// Filter and sort thoughts (no mock fallback)
const displayThoughts = computed(() => {
  let filtered = filterType.value === 'all'
    ? thoughts.value
    : thoughts.value.filter((t) => t.type === filterType.value)

  return filtered.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return sortOrder.value === 'newest' ? dateB - dateA : dateA - dateB
  })
})

// Selected thought for modal
const selectedThought = ref<Thought | null>(null)

const isTruncated = (content: string) => content.length > MAX_LENGTH

const truncate = (content: string) => {
  if (content.length <= MAX_LENGTH) return content
  return content.slice(0, MAX_LENGTH).trim() + '…'
}

const formatTime = (date: string) => {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const openThought = (thought: Thought) => {
  if (isTruncated(thought.text)) {
    selectedThought.value = thought
  }
}

const closeModal = () => {
  selectedThought.value = null
}

const typeFilters: Array<{ value: ThoughtType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'thought', label: 'Thoughts' },
  { value: 'decision', label: 'Decisions' },
  { value: 'insight', label: 'Insights' },
  { value: 'code', label: 'Code' },
  { value: 'todo', label: 'Todos' },
  { value: 'link', label: 'Links' },
]

onMounted(() => {
  fetchThoughts()

  // Setup Intersection Observer for infinite scroll
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting && hasMore.value && !isLoadingMore.value) {
        fetchMoreThoughts()
      }
    },
    { rootMargin: '200px' }
  )
})

// Watch for loadMoreRef to be available, then observe it
watch(loadMoreRef, (el) => {
  if (el && observer) {
    observer.observe(el)
  }
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6">
    <!-- Filters -->
    <div class="flex items-center gap-4 mb-8">
      <div class="flex gap-1 flex-wrap">
        <button
          v-for="f in typeFilters"
          :key="f.value"
          @click="filterType = f.value"
          :class="[
            'px-3 py-1 text-xs rounded-full transition-colors',
            filterType === f.value
              ? 'bg-text-primary text-bg-primary'
              : 'text-text-tertiary hover:text-text-secondary'
          ]"
        >
          {{ f.label }}
        </button>
      </div>
      <div class="flex-1" />
      <button
        @click="sortOrder = sortOrder === 'newest' ? 'oldest' : 'newest'"
        class="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
      >
        {{ sortOrder === 'newest' ? '↓ Newest' : '↑ Oldest' }}
      </button>
    </div>

    <!-- Initial Loading -->
    <div v-if="isLoading" class="text-center py-16">
      <div class="text-text-tertiary text-sm">Loading thoughts...</div>
    </div>

    <!-- Masonry grid -->
    <div v-else class="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
      <article
        v-for="thought in displayThoughts"
        :key="thought.id"
        :class="[
          'break-inside-avoid relative pl-4',
          'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:rounded-full',
          typeAccent[thought.type] || typeAccent.thought,
          'group',
          isTruncated(thought.text) ? 'cursor-pointer' : ''
        ]"
        @click="openThought(thought)"
      >
        <div class="py-3">
          <p
            :class="[
              'text-text-primary',
              thought.type === 'code'
                ? 'font-mono text-[13px] leading-relaxed whitespace-pre-wrap bg-bg-tertiary/50 rounded-lg p-3 -ml-1'
                : thought.type === 'link'
                  ? 'text-sm text-sky-500 dark:text-sky-400 hover:underline break-all'
                  : 'text-[15px] leading-relaxed'
            ]"
          >{{ truncate(thought.text) }}</p>

          <button
            v-if="isTruncated(thought.text)"
            class="mt-2 text-[11px] text-text-tertiary hover:text-text-secondary transition-colors"
          >
            Show more
          </button>

          <div class="flex items-center gap-2 mt-2 text-[11px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="uppercase tracking-wider">{{ thought.type }}</span>
            <span>·</span>
            <span>{{ formatTime(thought.createdAt) }}</span>
          </div>
        </div>
      </article>
    </div>

    <!-- Load more sentinel -->
    <div ref="loadMoreRef" class="py-8 flex justify-center">
      <div v-if="isLoadingMore" class="text-text-tertiary text-sm">
        Loading more...
      </div>
      <div v-else-if="!hasMore && thoughts.length > 0" class="text-text-tertiary text-xs">
        End of thoughts
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!isLoading && thoughts.length === 0" class="text-center py-32">
      <p class="text-text-tertiary text-sm">
        {{ filterType === 'all' ? 'No thoughts yet' : `No ${filterType}s found` }}
      </p>
      <p class="text-text-tertiary/60 text-xs mt-2">
        Press <kbd class="px-1.5 py-0.5 bg-bg-tertiary rounded">⌥S</kbd> to capture
      </p>
    </div>

    <!-- Full thought modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="selectedThought"
          class="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
        >
          <div
            class="absolute inset-0 bg-black/50 backdrop-blur-sm cursor-pointer"
            @click="closeModal"
          />
          <div
            :class="[
              'relative w-full max-w-2xl max-h-[80vh] overflow-auto',
              'bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl',
              'pl-5 before:absolute before:left-4 before:top-6 before:bottom-6 before:w-0.5 before:rounded-full',
              typeAccent[selectedThought.type]
            ]"
          >
            <div class="p-6 pl-4">
              <p
                :class="[
                  'text-text-primary',
                  selectedThought.type === 'code'
                    ? 'font-mono text-[13px] leading-relaxed whitespace-pre-wrap bg-bg-tertiary/50 rounded-lg p-4'
                    : selectedThought.type === 'link'
                      ? 'text-sky-500 dark:text-sky-400 hover:underline break-all'
                      : 'text-[15px] leading-relaxed'
                ]"
              >{{ selectedThought.text }}</p>

              <div class="flex items-center gap-2 mt-6 pt-4 border-t border-border-secondary text-[11px] text-text-tertiary">
                <span class="uppercase tracking-wider">{{ selectedThought.type }}</span>
                <span>·</span>
                <span>{{ formatTime(selectedThought.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
