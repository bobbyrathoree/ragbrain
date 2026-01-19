<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useThoughts } from '@/composables/useThoughts'
import type { Thought, ThoughtType } from '@/types'

const MAX_LENGTH = 280

const { thoughts, isLoading, fetchThoughts } = useThoughts()

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

// Mock data fallback
const mockThoughts: Thought[] = [
  { id: '1', content: 'OAuth vs JWT for the new auth system. Team prefers JWT — stateless, easier to scale.', type: 'decision', tags: ['auth'], createdAt: new Date().toISOString() },
  { id: '2', content: 'Users experiencing 3-4s load times. Performance optimization is now priority #1 before launch.', type: 'insight', tags: ['perf'], createdAt: new Date(Date.now() - 3600000).toISOString() },
  { id: '3', content: 'const fetchUser = async (id: string) => {\n  const res = await api.get(`/users/${id}`);\n  return res.data;\n}', type: 'code', tags: ['ts'], createdAt: new Date(Date.now() - 7200000).toISOString() },
  { id: '4', content: 'Review Sarah\'s PR for dashboard feature', type: 'todo', tags: [], createdAt: new Date(Date.now() - 86400000).toISOString() },
  { id: '5', content: 'The best interfaces feel inevitable — every element earns its place. Reduce until it breaks, then add back the minimum. This is the core principle of good design. When you look at something and nothing feels out of place, when every pixel serves a purpose.', type: 'insight', tags: ['design'], createdAt: new Date(Date.now() - 90000000).toISOString() },
  { id: '6', content: 'Switched to Vite. Cold starts under 300ms now.', type: 'thought', tags: ['dx'], createdAt: new Date(Date.now() - 172800000).toISOString() },
  { id: '7', content: 'interface Thought {\n  id: string\n  content: string\n  type: ThoughtType\n  tags: string[]\n  embedding?: number[]\n  createdAt: Date\n  updatedAt: Date\n  userId: string\n}', type: 'code', tags: ['types'], createdAt: new Date(Date.now() - 200000000).toISOString() },
  { id: '8', content: 'https://linear.app/ragbrain/issue/RAG-42', type: 'link', tags: [], createdAt: new Date(Date.now() - 250000000).toISOString() },
]

// Use API data or fallback to mock
const displayThoughts = computed(() => {
  const data = thoughts.value.length ? thoughts.value : mockThoughts

  let filtered = filterType.value === 'all'
    ? data
    : data.filter((t) => t.type === filterType.value)

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
  if (isTruncated(thought.content)) {
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

    <!-- Loading -->
    <div v-if="isLoading" class="text-center py-16">
      <div class="text-text-tertiary text-sm">Loading...</div>
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
          isTruncated(thought.content) ? 'cursor-pointer' : ''
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
          >{{ truncate(thought.content) }}</p>

          <button
            v-if="isTruncated(thought.content)"
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

    <!-- Empty state -->
    <div v-if="!isLoading && displayThoughts.length === 0" class="text-center py-32">
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
              >{{ selectedThought.content }}</p>

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
