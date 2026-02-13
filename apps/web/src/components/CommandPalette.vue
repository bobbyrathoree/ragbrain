<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'

interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

const props = defineProps<{
  modelValue: boolean
  commands: Command[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const commandQuery = ref('')
const selectedCommandIndex = ref(0)
const commandInputRef = ref<HTMLInputElement | null>(null)

const filteredCommands = computed(() => {
  if (!commandQuery.value) return props.commands
  const q = commandQuery.value.toLowerCase()
  return props.commands.filter(c => c.label.toLowerCase().includes(q))
})

const close = () => emit('update:modelValue', false)

const runCommand = (cmd: Command) => {
  cmd.action()
  commandQuery.value = ''
  selectedCommandIndex.value = 0
}

const handleKeydown = (e: KeyboardEvent) => {
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

watch(() => props.modelValue, (open) => {
  if (open) {
    nextTick(() => commandInputRef.value?.focus())
  } else {
    commandQuery.value = ''
    selectedCommandIndex.value = 0
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="close" />
        <div class="relative w-full max-w-lg bg-bg-elevated border border-border-primary rounded-xl shadow-2xl overflow-hidden">
          <!-- Search input -->
          <div class="flex items-center gap-3 px-4 py-3 border-b border-border-secondary">
            <svg class="w-4 h-4 text-text-tertiary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref="commandInputRef"
              v-model="commandQuery"
              type="text"
              placeholder="Search commands..."
              class="flex-1 bg-transparent text-text-primary text-sm placeholder:text-text-tertiary focus:outline-none"
              @keydown="handleKeydown"
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
</template>
