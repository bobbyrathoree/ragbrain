<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { detectType } from '@/lib/typeDetection'
import { extractTags } from '@/lib/tagExtraction'
import { useThoughts } from '@/composables/useThoughts'
import { useAsk } from '@/composables/useAsk'
import type { ThoughtType, AskResponse } from '@/types'

const router = useRouter()
const route = useRoute()
const { createThought, fetchThoughts } = useThoughts()
const { ask, isLoading: askLoading } = useAsk()

// Modal states
const captureOpen = ref(false)
const askOpen = ref(false)
const settingsOpen = ref(false)
const commandPaletteOpen = ref(false)

// Command palette
const commandQuery = ref('')
const selectedCommandIndex = ref(0)

interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

const commands: Command[] = [
  { id: 'capture', label: 'New thought', shortcut: '⌥S', action: () => { commandPaletteOpen.value = false; captureOpen.value = true } },
  { id: 'ask', label: 'Ask your knowledge', shortcut: '⌥F', action: () => { commandPaletteOpen.value = false; askOpen.value = true } },
  { id: 'feed', label: 'Go to Feed', shortcut: '1', action: () => { commandPaletteOpen.value = false; router.push('/') } },
  { id: 'graph', label: 'Go to Graph', shortcut: '2', action: () => { commandPaletteOpen.value = false; router.push('/graph') } },
  { id: 'timeline', label: 'Go to Timeline', shortcut: '3', action: () => { commandPaletteOpen.value = false; router.push('/timeline') } },
  { id: 'stars', label: 'Go to Stars', shortcut: '4', action: () => { commandPaletteOpen.value = false; router.push('/stars') } },
  { id: 'theme-light', label: 'Switch to light theme', action: () => { commandPaletteOpen.value = false; setTheme('light') } },
  { id: 'theme-dark', label: 'Switch to dark theme', action: () => { commandPaletteOpen.value = false; setTheme('dark') } },
  { id: 'settings', label: 'Open settings', action: () => { commandPaletteOpen.value = false; settingsOpen.value = true } },
]

const filteredCommands = computed(() => {
  if (!commandQuery.value) return commands
  const q = commandQuery.value.toLowerCase()
  return commands.filter(c => c.label.toLowerCase().includes(q))
})

const runCommand = (cmd: Command) => {
  cmd.action()
  commandQuery.value = ''
  selectedCommandIndex.value = 0
}

const handleCommandKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedCommandIndex.value = Math.min(selectedCommandIndex.value + 1, filteredCommands.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedCommandIndex.value = Math.max(selectedCommandIndex.value - 1, 0)
  } else if (e.key === 'Enter' && filteredCommands.value.length > 0) {
    e.preventDefault()
    runCommand(filteredCommands.value[selectedCommandIndex.value])
  }
}

watch(commandQuery, () => {
  selectedCommandIndex.value = 0
})

// Capture state
const captureContent = ref('')
const captureType = computed<ThoughtType>(() => detectType(captureContent.value))
const captureTags = computed(() => extractTags(captureContent.value))
const isSaving = ref(false)

// Ask state
const askQuery = ref('')
const askTimeWindow = ref<number | undefined>(undefined)
const askResponse = ref<AskResponse | null>(null)

// Settings state (localStorage overrides env vars)
const apiKey = ref(localStorage.getItem('ragbrain_api_key') || import.meta.env.VITE_API_KEY || '')
const apiEndpoint = ref(localStorage.getItem('ragbrain_api_endpoint') || import.meta.env.VITE_API_ENDPOINT || '')

// Theme
const theme = ref<'light' | 'dark'>(
  (localStorage.getItem('ragbrain_theme') as 'light' | 'dark') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
)

const setTheme = (t: 'light' | 'dark') => {
  theme.value = t
  localStorage.setItem('ragbrain_theme', t)
  document.documentElement.classList.toggle('dark', t === 'dark')
}

onMounted(() => {
  document.documentElement.classList.toggle('dark', theme.value === 'dark')
  if (apiKey.value) fetchThoughts()
})

// Type accent colors
const typeAccent: Record<ThoughtType, string> = {
  thought: 'bg-stone-400',
  decision: 'bg-violet-500',
  insight: 'bg-sky-500',
  code: 'bg-emerald-500',
  todo: 'bg-amber-500',
  link: 'bg-rose-400',
}

// Capture handlers
const handleCaptureSave = async () => {
  if (!captureContent.value.trim()) return
  isSaving.value = true
  try {
    await createThought(captureContent.value, captureType.value, captureTags.value)
    captureContent.value = ''
    captureOpen.value = false
  } catch (e) {
    console.error('Failed to save:', e)
  } finally {
    isSaving.value = false
  }
}

// Ask handlers
const handleAsk = async () => {
  if (!askQuery.value.trim()) return
  askResponse.value = null
  try {
    askResponse.value = await ask(askQuery.value, askTimeWindow.value)
  } catch (e) {
    console.error('Ask failed:', e)
  }
}

// Settings handlers
const saveSettings = () => {
  localStorage.setItem('ragbrain_api_key', apiKey.value)
  localStorage.setItem('ragbrain_api_endpoint', apiEndpoint.value)
  settingsOpen.value = false
  fetchThoughts()
}

// Reset modals on close
watch(captureOpen, (open) => { if (!open) captureContent.value = '' })
watch(askOpen, (open) => { if (!open) { askQuery.value = ''; askResponse.value = null } })
watch(commandPaletteOpen, (open) => { if (!open) { commandQuery.value = ''; selectedCommandIndex.value = 0 } })

// Global keyboard shortcuts
const handleKeydown = (e: KeyboardEvent) => {
  // Cmd+K always opens command palette
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    commandPaletteOpen.value = true
    return
  }

  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    // Cmd+Enter in capture modal
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && captureOpen.value) {
      e.preventDefault()
      handleCaptureSave()
    }
    if (e.key === 'Escape') {
      captureOpen.value = false
      askOpen.value = false
      settingsOpen.value = false
      commandPaletteOpen.value = false
    }
    return
  }

  if (e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault()
    captureOpen.value = true
  }
  if (e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    askOpen.value = true
  }
  if (e.key === 'Escape') {
    captureOpen.value = false
    askOpen.value = false
    settingsOpen.value = false
    commandPaletteOpen.value = false
  }

  const routes: Record<string, string> = { '1': '/', '2': '/graph', '3': '/timeline', '4': '/stars' }
  if (routes[e.key] && !captureOpen.value && !askOpen.value && !commandPaletteOpen.value) {
    router.push(routes[e.key])
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

const views = [
  { path: '/', label: 'Feed', key: '1' },
  { path: '/graph', label: 'Graph', key: '2' },
  { path: '/timeline', label: 'Timeline', key: '3' },
  { path: '/stars', label: 'Stars', key: '4' },
]

const timeWindows = [
  { value: undefined, label: 'All time' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]
</script>

<template>
  <div class="min-h-screen bg-bg-primary text-text-primary">
    <!-- Floating Nav -->
    <nav class="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 z-40">
      <div class="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1 sm:py-1.5 bg-bg-elevated/80 backdrop-blur-xl border border-border-secondary rounded-full shadow-sm">
        <router-link
          v-for="view in views"
          :key="view.path"
          :to="view.path"
          :class="[
            'px-2.5 sm:px-4 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-full transition-all',
            route.path === view.path
              ? 'bg-text-primary text-bg-primary'
              : 'text-text-secondary hover:text-text-primary'
          ]"
        >
          {{ view.label }}
        </router-link>
      </div>
    </nav>

    <!-- Floating Actions -->
    <div class="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-40 flex flex-col gap-2">
      <button
        @click="askOpen = true"
        class="w-10 h-10 sm:w-12 sm:h-12 bg-bg-elevated border border-border-secondary rounded-full shadow-sm flex items-center justify-center text-text-secondary hover:text-text-primary hover:border-border-primary transition-all"
        title="Ask (⌥F)"
      >
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      <button
        @click="captureOpen = true"
        class="w-10 h-10 sm:w-12 sm:h-12 bg-text-primary text-bg-primary rounded-full shadow-lg flex items-center justify-center hover:scale-105 transition-transform"
        title="Capture (⌥S)"
      >
        <svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>

    <!-- Settings Button -->
    <button
      @click="settingsOpen = true"
      class="fixed bottom-4 sm:bottom-6 left-4 sm:left-6 z-40 w-8 h-8 sm:w-10 sm:h-10 text-text-tertiary hover:text-text-primary transition-colors"
      title="Settings"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    </button>

    <!-- Main Content -->
    <main class="pt-20 pb-24">
      <router-view />
    </main>

    <!-- Capture Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="captureOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="captureOpen = false" />
          <div class="relative w-full max-w-2xl bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl overflow-hidden">
            <!-- Type indicator -->
            <div class="flex items-center gap-3 px-6 pt-5 pb-3">
              <div :class="['w-2 h-2 rounded-full', typeAccent[captureType]]" />
              <span class="text-xs text-text-tertiary uppercase tracking-wider">{{ captureType }}</span>
              <div class="flex-1" />
              <div v-if="captureTags.length" class="flex gap-2">
                <span v-for="tag in captureTags" :key="tag" class="text-xs text-text-tertiary">#{{ tag }}</span>
              </div>
            </div>

            <div class="px-6 pb-4">
              <textarea
                v-model="captureContent"
                autofocus
                placeholder="What's on your mind?"
                class="w-full h-40 bg-transparent text-text-primary text-[15px] leading-relaxed placeholder:text-text-tertiary resize-none focus:outline-none"
                @keydown.meta.enter.prevent="handleCaptureSave"
                @keydown.ctrl.enter.prevent="handleCaptureSave"
              />
            </div>

            <div class="flex items-center justify-between px-6 py-4 border-t border-border-secondary">
              <span class="text-xs text-text-tertiary">⌘Enter to save</span>
              <div class="flex gap-2">
                <button @click="captureOpen = false" class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                  Cancel
                </button>
                <button
                  @click="handleCaptureSave"
                  :disabled="!captureContent.trim() || isSaving"
                  class="px-4 py-2 text-sm bg-text-primary text-bg-primary rounded-lg font-medium disabled:opacity-50"
                >
                  {{ isSaving ? 'Saving...' : 'Save' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Ask Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="askOpen" class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="askOpen = false" />
          <div class="relative w-full max-w-xl bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl overflow-hidden">
            <!-- Query input -->
            <div class="p-4 border-b border-border-secondary">
              <input
                v-model="askQuery"
                autofocus
                type="text"
                placeholder="Ask your knowledge..."
                class="w-full bg-transparent text-text-primary text-lg placeholder:text-text-tertiary focus:outline-none"
                @keydown.enter="handleAsk"
              />
              <!-- Time filter -->
              <div class="flex gap-2 mt-3">
                <button
                  v-for="tw in timeWindows"
                  :key="tw.label"
                  @click="askTimeWindow = tw.value"
                  :class="[
                    'px-2 py-1 text-xs rounded-md transition-colors',
                    askTimeWindow === tw.value
                      ? 'bg-text-primary text-bg-primary'
                      : 'text-text-tertiary hover:text-text-secondary'
                  ]"
                >
                  {{ tw.label }}
                </button>
              </div>
            </div>

            <!-- Response -->
            <div v-if="askLoading" class="p-6 text-center">
              <div class="text-text-tertiary text-sm">Searching...</div>
            </div>

            <div v-else-if="askResponse" class="p-4 max-h-96 overflow-auto">
              <!-- Answer -->
              <p class="text-text-primary text-[15px] leading-relaxed">{{ askResponse.answer }}</p>

              <!-- Confidence -->
              <div class="flex items-center gap-3 mt-4 text-xs text-text-tertiary">
                <div class="flex items-center gap-2">
                  <div class="w-16 h-1 bg-bg-tertiary rounded-full overflow-hidden">
                    <div class="h-full bg-text-primary rounded-full" :style="{ width: `${askResponse.confidence * 100}%` }" />
                  </div>
                  <span>{{ Math.round(askResponse.confidence * 100) }}%</span>
                </div>
                <span>·</span>
                <span>{{ askResponse.processingTimeMs }}ms</span>
              </div>

              <!-- Citations -->
              <div v-if="askResponse.citations.length" class="mt-6 pt-4 border-t border-border-secondary">
                <div class="text-xs text-text-tertiary uppercase tracking-wider mb-3">Sources</div>
                <div class="space-y-2">
                  <div
                    v-for="citation in askResponse.citations"
                    :key="citation.thoughtId"
                    class="p-3 bg-bg-tertiary/50 rounded-lg"
                  >
                    <p class="text-sm text-text-primary line-clamp-2">{{ citation.content }}</p>
                    <div class="flex items-center gap-2 mt-2 text-xs text-text-tertiary">
                      <span class="uppercase">{{ citation.type }}</span>
                      <span>·</span>
                      <span>{{ Math.round(citation.score * 100) }}% match</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Settings Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="settingsOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="settingsOpen = false" />
          <div class="relative w-full max-w-md bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl">
            <div class="p-6 space-y-6">
              <h2 class="text-lg font-semibold text-text-primary">Settings</h2>

              <!-- Theme -->
              <div>
                <label class="text-sm text-text-secondary mb-3 block">Theme</label>
                <div class="flex gap-2">
                  <button
                    @click="setTheme('light')"
                    :class="[
                      'flex-1 py-2 text-sm rounded-lg border transition-all',
                      theme === 'light' ? 'border-text-primary bg-text-primary/5' : 'border-border-secondary hover:border-border-primary'
                    ]"
                  >
                    Light
                  </button>
                  <button
                    @click="setTheme('dark')"
                    :class="[
                      'flex-1 py-2 text-sm rounded-lg border transition-all',
                      theme === 'dark' ? 'border-text-primary bg-text-primary/5' : 'border-border-secondary hover:border-border-primary'
                    ]"
                  >
                    Dark
                  </button>
                </div>
              </div>

              <!-- API Endpoint -->
              <div>
                <label class="text-sm text-text-secondary mb-2 block">API Endpoint</label>
                <input
                  v-model="apiEndpoint"
                  type="text"
                  placeholder="https://api.example.com"
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-secondary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-primary"
                />
              </div>

              <!-- API Key -->
              <div>
                <label class="text-sm text-text-secondary mb-2 block">API Key</label>
                <input
                  v-model="apiKey"
                  type="password"
                  placeholder="Enter your API key"
                  class="w-full px-3 py-2 bg-bg-tertiary border border-border-secondary rounded-lg text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-primary"
                />
              </div>

              <!-- Save -->
              <button
                @click="saveSettings"
                class="w-full py-2 text-sm bg-text-primary text-bg-primary rounded-lg font-medium"
              >
                Save Settings
              </button>

              <!-- Shortcuts -->
              <div class="pt-4 border-t border-border-secondary">
                <div class="text-xs text-text-tertiary space-y-2">
                  <div class="flex justify-between"><span>Command palette</span><kbd>⌘K</kbd></div>
                  <div class="flex justify-between"><span>New thought</span><kbd>⌥S</kbd></div>
                  <div class="flex justify-between"><span>Search</span><kbd>⌥F</kbd></div>
                  <div class="flex justify-between"><span>Switch views</span><kbd>1-4</kbd></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Command Palette Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="commandPaletteOpen" class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] p-4">
          <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="commandPaletteOpen = false" />
          <div class="relative w-full max-w-lg bg-bg-elevated border border-border-primary rounded-xl shadow-2xl overflow-hidden">
            <!-- Search input -->
            <div class="flex items-center gap-3 px-4 py-3 border-b border-border-secondary">
              <svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                v-model="commandQuery"
                autofocus
                type="text"
                placeholder="Search commands..."
                class="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none"
                @keydown="handleCommandKeydown"
              />
              <kbd class="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">esc</kbd>
            </div>

            <!-- Command list -->
            <div class="max-h-80 overflow-auto py-2">
              <button
                v-for="(cmd, index) in filteredCommands"
                :key="cmd.id"
                @click="runCommand(cmd)"
                :class="[
                  'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
                  index === selectedCommandIndex ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
                ]"
              >
                <span class="text-sm text-text-primary">{{ cmd.label }}</span>
                <kbd v-if="cmd.shortcut" class="text-[10px] text-text-tertiary bg-bg-tertiary px-1.5 py-0.5 rounded">{{ cmd.shortcut }}</kbd>
              </button>

              <div v-if="filteredCommands.length === 0" class="px-4 py-8 text-center text-sm text-text-tertiary">
                No commands found
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
