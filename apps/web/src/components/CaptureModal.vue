<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { detectType } from '@/lib/typeDetection'
import { extractTags } from '@/lib/tagExtraction'
import { useThoughts } from '@/composables/useThoughts'
import type { ThoughtType } from '@/types'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { createThought } = useThoughts()

const captureContent = ref('')
const captureTypeOverride = ref<ThoughtType | null>(null)
const detectedType = computed<ThoughtType>(() => detectType(captureContent.value))
const captureType = computed<ThoughtType>(() => captureTypeOverride.value || detectedType.value)
const captureTags = computed(() => extractTags(captureContent.value))
const isSaving = ref(false)
const typeDropdownOpen = ref(false)
const captureTextareaRef = ref<HTMLTextAreaElement | null>(null)

const allTypes: ThoughtType[] = ['thought', 'decision', 'insight', 'code', 'todo', 'link']

const typeAccent: Record<ThoughtType, string> = {
  thought: 'bg-stone-400',
  decision: 'bg-violet-500',
  insight: 'bg-sky-500',
  code: 'bg-emerald-500',
  todo: 'bg-amber-500',
  link: 'bg-rose-400',
}

const setCaptureType = (type: ThoughtType) => {
  captureTypeOverride.value = type === detectedType.value ? null : type
  typeDropdownOpen.value = false
}

const close = () => emit('update:modelValue', false)

const handleSave = async () => {
  if (!captureContent.value.trim()) return
  isSaving.value = true
  try {
    await createThought(captureContent.value, captureType.value, captureTags.value)
    captureContent.value = ''
    close()
  } catch (e) {
    console.error('Failed to save:', e)
  } finally {
    isSaving.value = false
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    nextTick(() => captureTextareaRef.value?.focus())
  } else {
    captureContent.value = ''
    captureTypeOverride.value = null
    typeDropdownOpen.value = false
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
        <div class="relative w-full max-w-2xl bg-bg-elevated border border-border-primary rounded-2xl shadow-2xl overflow-hidden">
          <!-- Type indicator (clickable to override) -->
          <div class="flex items-center gap-3 px-6 pt-5 pb-3">
            <div class="relative">
              <button
                @click="typeDropdownOpen = !typeDropdownOpen"
                class="flex items-center gap-2 px-2 py-1 -ml-2 rounded-lg hover:bg-bg-tertiary transition-colors"
              >
                <div :class="['w-2 h-2 rounded-full', typeAccent[captureType]]" />
                <span class="text-xs text-text-tertiary uppercase tracking-wider">{{ captureType }}</span>
                <svg class="w-3 h-3 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <div
                v-if="typeDropdownOpen"
                class="absolute top-full left-0 mt-1 w-36 bg-bg-elevated border border-border-secondary rounded-lg shadow-lg overflow-hidden z-10"
              >
                <button
                  v-for="t in allTypes"
                  :key="t"
                  @click="setCaptureType(t)"
                  :class="[
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                    captureType === t ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  ]"
                >
                  <div :class="['w-2 h-2 rounded-full', typeAccent[t]]" />
                  <span class="uppercase tracking-wider">{{ t }}</span>
                  <span v-if="t === detectedType && !captureTypeOverride" class="ml-auto text-[10px] text-text-tertiary">auto</span>
                </button>
              </div>
            </div>
            <div class="flex-1" />
            <div v-if="captureTags.length" class="flex gap-2">
              <span v-for="tag in captureTags" :key="tag" class="text-xs text-text-tertiary">#{{ tag }}</span>
            </div>
          </div>

          <div class="px-6 pb-4">
            <textarea
              ref="captureTextareaRef"
              v-model="captureContent"
              placeholder="What's on your mind?"
              class="w-full h-40 bg-transparent text-text-primary text-[15px] leading-relaxed placeholder:text-text-tertiary resize-none focus:outline-none"
              @keydown.meta.enter.prevent="handleSave"
              @keydown.ctrl.enter.prevent="handleSave"
            />
          </div>

          <div class="flex items-center justify-between px-6 py-4 border-t border-border-secondary">
            <span class="text-xs text-text-tertiary">&#8984;Enter to save</span>
            <div class="flex gap-2">
              <button @click="close" class="px-4 py-2 text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
              <button
                @click="handleSave"
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
</template>
