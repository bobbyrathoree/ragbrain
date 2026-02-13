<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useAsk } from '@/composables/useAsk'
import type { AskResponse } from '@/types'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { ask, isLoading: askLoading } = useAsk()

const askQuery = ref('')
const askTimeWindow = ref<number | undefined>(undefined)
const askResponse = ref<AskResponse | null>(null)
const askInputRef = ref<HTMLInputElement | null>(null)

const formattedAnswer = computed(() => {
  if (!askResponse.value?.answer) return ''
  return DOMPurify.sanitize(marked.parse(askResponse.value.answer) as string)
})

const timeWindows = [
  { value: undefined, label: 'All time' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
]

const close = () => emit('update:modelValue', false)

const handleAsk = async () => {
  if (!askQuery.value.trim()) return
  askResponse.value = null
  try {
    askResponse.value = await ask(askQuery.value, askTimeWindow.value)
  } catch (e) {
    console.error('Ask failed:', e)
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    nextTick(() => askInputRef.value?.focus())
  } else {
    askQuery.value = ''
    askResponse.value = null
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
        <div class="relative w-full max-w-xl bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl overflow-hidden">
          <!-- Query input -->
          <div class="p-4 border-b border-border-secondary">
            <input
              ref="askInputRef"
              v-model="askQuery"
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
            <!-- Answer with markdown rendering -->
            <div
              class="prose prose-sm dark:prose-invert max-w-none prose-p:text-text-primary prose-headings:text-text-primary prose-code:text-emerald-600 dark:prose-code:text-emerald-400 prose-code:bg-bg-tertiary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-tertiary prose-pre:border prose-pre:border-border-secondary"
              v-html="formattedAnswer"
            />

            <!-- Confidence -->
            <div class="flex items-center gap-3 mt-4 text-xs text-text-tertiary">
              <div class="flex items-center gap-2">
                <div class="w-16 h-1 bg-bg-tertiary rounded-full overflow-hidden">
                  <div class="h-full bg-text-primary rounded-full" :style="{ width: `${askResponse.confidence * 100}%` }" />
                </div>
                <span>{{ Math.round(askResponse.confidence * 100) }}%</span>
              </div>
              <span>·</span>
              <span>{{ askResponse.processingTime }}ms</span>
            </div>

            <!-- Citations -->
            <div v-if="askResponse.citations.length" class="mt-6 pt-4 border-t border-border-secondary">
              <div class="text-xs text-text-tertiary uppercase tracking-wider mb-3">Sources</div>
              <div class="space-y-2">
                <div
                  v-for="citation in askResponse.citations"
                  :key="citation.id"
                  class="p-3 bg-bg-tertiary/50 rounded-lg"
                >
                  <p class="text-sm text-text-primary line-clamp-2">{{ citation.preview }}</p>
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
</template>
