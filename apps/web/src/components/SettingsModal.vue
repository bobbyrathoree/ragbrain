<script setup lang="ts">
import { ref } from 'vue'
import { useThoughts } from '@/composables/useThoughts'

defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { fetchThoughts } = useThoughts()

const apiKey = ref(localStorage.getItem('ragbrain_api_key') || import.meta.env.VITE_API_KEY || '')
const apiEndpoint = ref(localStorage.getItem('ragbrain_api_endpoint') || import.meta.env.VITE_API_ENDPOINT || '')

const theme = ref<'light' | 'dark'>(
  (localStorage.getItem('ragbrain_theme') as 'light' | 'dark') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
)

const setTheme = (t: 'light' | 'dark') => {
  theme.value = t
  localStorage.setItem('ragbrain_theme', t)
  document.documentElement.classList.toggle('dark', t === 'dark')
}

const close = () => emit('update:modelValue', false)

const saveSettings = () => {
  localStorage.setItem('ragbrain_api_key', apiKey.value)
  localStorage.setItem('ragbrain_api_endpoint', apiEndpoint.value)
  close()
  fetchThoughts()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
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
                <div class="flex justify-between"><span>Command palette</span><kbd>&#8984;K</kbd></div>
                <div class="flex justify-between"><span>New thought</span><kbd>&#8997;S</kbd></div>
                <div class="flex justify-between"><span>Search</span><kbd>&#8997;F</kbd></div>
                <div class="flex justify-between"><span>Switch views</span><kbd>1-4</kbd></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
