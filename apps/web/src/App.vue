<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import CaptureModal from '@/components/CaptureModal.vue'
import AskModal from '@/components/AskModal.vue'
import SettingsModal from '@/components/SettingsModal.vue'
import CommandPalette from '@/components/CommandPalette.vue'

const router = useRouter()
const route = useRoute()

// Modal states
const captureOpen = ref(false)
const askOpen = ref(false)
const settingsOpen = ref(false)
const commandPaletteOpen = ref(false)

// Theme initialization
const theme = (localStorage.getItem('ragbrain_theme') as 'light' | 'dark') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

onMounted(() => {
  document.documentElement.classList.toggle('dark', theme === 'dark')
})

// Export handler
const exportData = async () => {
  const apiKey = localStorage.getItem('ragbrain_api_key') || ''
  const baseUrl = localStorage.getItem('ragbrain_api_endpoint') || import.meta.env.VITE_API_ENDPOINT || ''
  try {
    const res = await fetch(`${baseUrl}/export`, {
      headers: { 'Content-Type': 'application/json', ...(apiKey && { 'x-api-key': apiKey }) },
    })
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ragbrain-export-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error('Export failed:', e)
  }
}

// Command palette commands
const commands = [
  { id: 'capture', label: 'New thought', shortcut: '⌥S', action: () => { commandPaletteOpen.value = false; captureOpen.value = true } },
  { id: 'ask', label: 'Ask your knowledge', shortcut: '⌥F', action: () => { commandPaletteOpen.value = false; askOpen.value = true } },
  { id: 'feed', label: 'Go to Feed', shortcut: '1', action: () => { commandPaletteOpen.value = false; router.push('/') } },
  { id: 'graph', label: 'Go to Graph', shortcut: '2', action: () => { commandPaletteOpen.value = false; router.push('/graph') } },
  { id: 'timeline', label: 'Go to Timeline', shortcut: '3', action: () => { commandPaletteOpen.value = false; router.push('/timeline') } },
  { id: 'export', label: 'Export data', action: () => { commandPaletteOpen.value = false; exportData() } },
  { id: 'settings', label: 'Open settings', action: () => { commandPaletteOpen.value = false; settingsOpen.value = true } },
]

// Global keyboard shortcuts
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    commandPaletteOpen.value = true
    return
  }

  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    if (e.key === 'Escape') {
      captureOpen.value = false
      askOpen.value = false
      settingsOpen.value = false
      commandPaletteOpen.value = false
    }
    return
  }

  if (e.altKey && e.code === 'KeyS') {
    e.preventDefault()
    captureOpen.value = true
  }
  if (e.altKey && e.code === 'KeyF') {
    e.preventDefault()
    askOpen.value = true
  }
  if (e.key === 'Escape') {
    captureOpen.value = false
    askOpen.value = false
    settingsOpen.value = false
    commandPaletteOpen.value = false
  }

  const routes: Record<string, string> = { '1': '/', '2': '/graph', '3': '/timeline', '4': '/chat' }
  if (routes[e.key] && !captureOpen.value && !askOpen.value && !commandPaletteOpen.value) {
    router.push(routes[e.key])
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

const views = [
  { path: '/', label: 'Feed' },
  { path: '/graph', label: 'Graph' },
  { path: '/timeline', label: 'Timeline' },
  { path: '/chat', label: 'Chat' },
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
    <main>
      <router-view />
    </main>

    <!-- Modal Components -->
    <CaptureModal v-model="captureOpen" />
    <AskModal v-model="askOpen" />
    <SettingsModal v-model="settingsOpen" />
    <CommandPalette v-model="commandPaletteOpen" :commands="commands" />
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
