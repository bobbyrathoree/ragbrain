<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useThoughts } from '@/composables/useThoughts'
import { useSearch } from '@/composables/useSearch'
import { thoughtsApi } from '@/api'
import type { Thought, ThoughtType } from '@/types'

const MAX_LENGTH = 280

const {
  thoughts,
  isLoading,
  isLoadingMore,
  hasMore,
  error: feedError,
  fetchThoughts,
  fetchMoreThoughts,
  updateThought,
  deleteThought,
} = useThoughts()

const {
  searchQuery,
  searchResults,
  isSearching,
  totalCount: searchTotalCount,
  processingTime: searchProcessingTime,
  search,
  clearSearch,
} = useSearch()

// Local search input (synced on Enter/submit)
const searchInput = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)

const isSearchActive = computed(() => searchQuery.value.length > 0)

const handleSearch = () => {
  const q = searchInput.value.trim()
  if (q) {
    search(q)
  } else {
    clearSearch()
  }
}

const handleClearSearch = () => {
  searchInput.value = ''
  clearSearch()
}

const handleSearchKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    handleClearSearch()
    searchInputRef.value?.blur()
  }
}

// Edit/delete state
const editingThought = ref<Thought | null>(null)
const editContent = ref('')
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)
const isSavingEdit = ref(false)
const confirmingDelete = ref<Thought | null>(null)
const menuOpenId = ref<string | null>(null)

const startEdit = (thought: Thought) => {
  editingThought.value = thought
  editContent.value = thought.text
  menuOpenId.value = null
  setTimeout(() => editTextareaRef.value?.focus(), 50)
}

const saveEdit = async () => {
  if (!editingThought.value || !editContent.value.trim()) return
  isSavingEdit.value = true
  try {
    await updateThought(editingThought.value.id, editContent.value.trim())
    editingThought.value = null
    editContent.value = ''
  } catch (e) {
    console.error('Failed to save edit:', e)
  } finally {
    isSavingEdit.value = false
  }
}

const cancelEdit = () => {
  editingThought.value = null
  editContent.value = ''
}

const confirmDelete = (thought: Thought) => {
  confirmingDelete.value = thought
  menuOpenId.value = null
}

const executeDelete = async () => {
  if (!confirmingDelete.value) return
  try {
    await deleteThought(confirmingDelete.value.id)
  } catch (e) {
    console.error('Failed to delete:', e)
  } finally {
    confirmingDelete.value = null
  }
}

const toggleMenu = (id: string, e: Event) => {
  e.stopPropagation()
  menuOpenId.value = menuOpenId.value === id ? null : id
}

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
  const valid = thoughts.value.filter((t) => t.text && t.createdAt)

  let filtered = filterType.value === 'all'
    ? valid
    : valid.filter((t) => t.type === filterType.value)

  return filtered.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return sortOrder.value === 'newest' ? dateB - dateA : dateA - dateB
  })
})

// Selected thought for modal
const selectedThought = ref<Thought | null>(null)
const relatedThoughts = ref<Thought[]>([])
const isLoadingRelated = ref(false)

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

const openThought = async (thought: Thought) => {
  if (isTruncated(thought.text)) {
    selectedThought.value = thought
    relatedThoughts.value = []
    isLoadingRelated.value = true
    try {
      const res = await thoughtsApi.related(thought.id)
      relatedThoughts.value = res.related || []
    } catch {
      relatedThoughts.value = []
    } finally {
      isLoadingRelated.value = false
    }
  }
}

const closeModal = () => {
  selectedThought.value = null
  relatedThoughts.value = []
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
  <div class="max-w-5xl mx-auto px-4 sm:px-6 pt-20 pb-24">
    <!-- Search + Filters -->
    <div class="space-y-4 mb-8">
      <!-- Search bar -->
      <div v-if="feedError" class="px-4 py-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
        {{ feedError }}
      </div>

      <div class="relative">
        <div class="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref="searchInputRef"
          v-model="searchInput"
          type="text"
          placeholder="Search thoughts..."
          class="w-full pl-10 pr-10 py-2.5 bg-bg-elevated border border-border-secondary rounded-xl text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-primary transition-colors"
          @keydown.enter="handleSearch"
          @keydown="handleSearchKeydown"
        />
        <button
          v-if="searchInput"
          @click="handleClearSearch"
          class="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Search results header -->
      <div v-if="isSearchActive" class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">
          {{ searchTotalCount }} result{{ searchTotalCount !== 1 ? 's' : '' }} for "<span class="text-text-primary">{{ searchQuery }}</span>"
        </span>
        <span class="text-xs text-text-tertiary">·</span>
        <span class="text-xs text-text-tertiary">{{ searchProcessingTime }}ms</span>
        <div class="flex-1" />
        <button
          @click="handleClearSearch"
          class="text-xs text-text-tertiary hover:text-text-primary transition-colors"
        >
          Clear search
        </button>
      </div>

      <!-- Filters (hidden during search) -->
      <div v-if="!isSearchActive" class="flex items-center gap-4">
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
    </div>

    <!-- Search loading -->
    <div v-if="isSearching" class="text-center py-16">
      <div class="text-text-tertiary text-sm">Searching...</div>
    </div>

    <!-- Search results -->
    <div v-else-if="isSearchActive" class="columns-1 sm:columns-2 lg:columns-3 gap-5 space-y-5">
      <article
        v-for="result in searchResults"
        :key="result.id"
        class="break-inside-avoid relative bg-bg-elevated border-2 border-border-primary rounded-xl shadow-brutal-sm hover:shadow-brutal-lg transition-all duration-200 ease-out hover:-translate-y-1 hover:-translate-x-0.5 group"
      >
        <div class="flex">
          <div :class="['w-1 rounded-full flex-shrink-0 my-4 ml-3', typeAccent[result.type] || 'bg-stone-400']" />
          <div class="flex-1 p-4 pl-3">
            <p
              v-if="result.highlight"
              class="text-[15px] leading-relaxed text-text-primary"
              v-html="result.highlight"
            />
            <p v-else class="text-[15px] leading-relaxed text-text-primary">
              {{ truncate(result.text) }}
            </p>

            <div class="flex items-center gap-2 mt-3 text-[11px]">
              <span :class="['uppercase tracking-wider font-semibold', typeLabelColor[result.type] || 'text-stone-400']">{{ result.type }}</span>
              <span class="text-text-tertiary">·</span>
              <span class="text-text-tertiary">{{ formatTime(result.createdAt) }}</span>
              <span class="text-text-tertiary">·</span>
              <span class="text-text-tertiary">{{ result.score.toFixed(1) }}</span>
            </div>
          </div>
        </div>
      </article>
    </div>

    <!-- Search empty state -->
    <div v-else-if="isSearchActive && searchResults.length === 0 && !isSearching" class="text-center py-16">
      <p class="text-text-tertiary text-sm">No results found for "{{ searchQuery }}"</p>
    </div>

    <!-- Initial Loading -->
    <div v-else-if="isLoading" class="text-center py-16">
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
        <div class="flex relative">
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
              <span v-if="thought.indexingStatus === 'pending'" class="text-amber-400/70 border border-amber-400/30 rounded px-1.5 py-0.5 text-[10px]">Indexing...</span>
            </div>
          </div>

          <!-- Action menu -->
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              @click="toggleMenu(thought.id, $event)"
              class="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
              </svg>
            </button>
            <div
              v-if="menuOpenId === thought.id"
              class="absolute right-0 mt-1 w-28 bg-bg-elevated border border-border-secondary rounded-lg shadow-lg overflow-hidden z-10"
            >
              <button
                @click.stop="startEdit(thought)"
                class="w-full px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                Edit
              </button>
              <button
                @click.stop="confirmDelete(thought)"
                class="w-full px-3 py-2 text-left text-xs text-rose-400 hover:text-rose-300 hover:bg-bg-tertiary transition-colors"
              >
                Delete
              </button>
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

                <!-- Related Thoughts -->
                <div v-if="isLoadingRelated" class="mt-4 pt-4 border-t border-border-secondary">
                  <div class="text-xs text-text-tertiary">Finding related thoughts...</div>
                </div>
                <div v-else-if="relatedThoughts.length > 0" class="mt-4 pt-4 border-t border-border-secondary">
                  <h4 class="text-xs text-text-tertiary uppercase tracking-wider mb-3">Related</h4>
                  <div class="space-y-2">
                    <div
                      v-for="related in relatedThoughts.slice(0, 5)"
                      :key="related.id"
                      class="p-2.5 bg-bg-tertiary/50 rounded-lg"
                    >
                      <p class="text-xs text-text-primary line-clamp-2">{{ related.text }}</p>
                      <span :class="['text-[10px] uppercase tracking-wider mt-1 inline-block', typeLabelColor[related.type] || 'text-stone-400']">{{ related.type }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Edit modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="editingThought" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="cancelEdit" />
          <div class="relative w-full max-w-2xl bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl overflow-hidden">
            <div class="px-6 pt-5 pb-3">
              <span class="text-xs text-text-tertiary uppercase tracking-wider">Edit thought</span>
            </div>
            <div class="px-6 pb-4">
              <textarea
                ref="editTextareaRef"
                v-model="editContent"
                class="w-full h-40 bg-transparent text-text-primary text-[15px] leading-relaxed placeholder:text-text-tertiary resize-none focus:outline-none"
                @keydown.meta.enter.prevent="saveEdit"
                @keydown.ctrl.enter.prevent="saveEdit"
                @keydown.escape="cancelEdit"
              />
            </div>
            <div class="flex items-center justify-between px-6 py-4 border-t border-border-secondary">
              <span class="text-xs text-text-tertiary">&#8984;Enter to save</span>
              <div class="flex gap-2">
                <button @click="cancelEdit" class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                  Cancel
                </button>
                <button
                  @click="saveEdit"
                  :disabled="!editContent.trim() || isSavingEdit"
                  class="px-4 py-2 text-sm bg-text-primary text-bg-primary rounded-lg font-medium disabled:opacity-50"
                >
                  {{ isSavingEdit ? 'Saving...' : 'Save' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete confirmation -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="confirmingDelete" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="confirmingDelete = null" />
          <div class="relative w-full max-w-sm bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl p-6">
            <h3 class="text-sm font-semibold text-text-primary mb-2">Delete thought?</h3>
            <p class="text-xs text-text-tertiary mb-6 line-clamp-2">{{ confirmingDelete.text }}</p>
            <div class="flex justify-end gap-2">
              <button @click="confirmingDelete = null" class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                @click="executeDelete"
                class="px-4 py-2 text-sm bg-rose-500 text-white rounded-lg font-medium hover:bg-rose-600"
              >
                Delete
              </button>
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
