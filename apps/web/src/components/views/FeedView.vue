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

// Type accent colors - bolder for neo-brutalism
const typeAccent: Record<string, string> = {
  thought: 'bg-stone-400',
  decision: 'bg-violet-500',
  insight: 'bg-sky-500',
  code: 'bg-emerald-500',
  todo: 'bg-amber-500',
  link: 'bg-rose-500',
}

// Type label colors - brighter for visibility
const typeLabelColor: Record<string, string> = {
  thought: 'text-stone-400',
  decision: 'text-violet-400',
  insight: 'text-sky-400',
  code: 'text-emerald-400',
  todo: 'text-amber-400',
  link: 'text-rose-400',
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

    <!-- Masonry grid with neo-brutalism styling -->
    <div v-else class="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
      <article
        v-for="(thought, index) in displayThoughts"
        :key="thought.id"
        :style="{ animationDelay: `${Math.min(index, 20) * 30}ms` }"
        :class="[
          'break-inside-avoid relative',
          'bg-bg-elevated border-2 border-border-primary rounded-xl',
          'shadow-brutal-sm hover:shadow-brutal-lg',
          'transition-all duration-200 ease-out',
          'hover:-translate-y-1 hover:-translate-x-0.5',
          'group animate-scale-in',
          isTruncated(thought.text) ? 'cursor-pointer' : 'cursor-default'
        ]"
        @click="openThought(thought)"
      >
        <!-- Inner content with type accent bar -->
        <div class="flex">
          <!-- Accent bar -->
          <div :class="[
            'w-1 rounded-full flex-shrink-0 my-4 ml-3',
            typeAccent[thought.type] || 'bg-stone-400'
          ]" />
          <!-- Content -->
          <div class="flex-1 p-4 pl-3">
            <p
              :class="[
                'text-text-primary',
                thought.type === 'code'
                  ? 'font-mono text-[13px] leading-relaxed whitespace-pre-wrap bg-bg-tertiary/50 rounded-lg p-3'
                  : thought.type === 'link'
                    ? 'text-sm text-sky-500 dark:text-sky-400 hover:underline break-all'
                    : 'text-[15px] leading-relaxed'
              ]"
            >{{ truncate(thought.text) }}</p>

            <button
              v-if="isTruncated(thought.text)"
              class="mt-3 text-[11px] text-text-tertiary hover:text-text-primary font-medium transition-colors"
            >
              Show more →
            </button>

            <div class="flex items-center gap-2 mt-3 text-[11px]">
              <span :class="['uppercase tracking-wider font-semibold', typeLabelColor[thought.type] || 'text-stone-400']">{{ thought.type }}</span>
              <span class="text-text-tertiary">·</span>
              <span class="text-text-tertiary">{{ formatTime(thought.createdAt) }}</span>
            </div>
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
          <div class="relative w-full max-w-2xl max-h-[80vh] overflow-auto bg-bg-elevated border-2 border-border-primary rounded-2xl shadow-brutal-lg">
            <div class="flex">
              <!-- Accent bar -->
              <div :class="[
                'w-1 rounded-full flex-shrink-0 my-6 ml-4',
                typeAccent[selectedThought.type] || 'bg-stone-400'
              ]" />
              <!-- Content -->
              <div class="flex-1 p-6 pl-4">
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

                <div class="flex items-center gap-2 mt-6 pt-4 border-t border-border-secondary text-[11px]">
                  <span :class="['uppercase tracking-wider font-semibold', typeLabelColor[selectedThought.type] || 'text-stone-400']">{{ selectedThought.type }}</span>
                  <span class="text-text-tertiary">·</span>
                  <span class="text-text-tertiary">{{ formatTime(selectedThought.createdAt) }}</span>
                </div>
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
