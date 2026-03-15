<script setup lang="ts">
/**
 * Right sidebar drawer showing full thought text + related thoughts.
 * Clicking a related thought updates the drawer and pans the graph.
 */
import { computed } from 'vue'
import type { ConstellationNode, ConstellationEdge } from '@/types'

const TYPE_ICONS: Record<string, string> = {
  thought: '●', decision: '◆', insight: '★',
  code: '⟨⟩', todo: '☐', link: '↗',
}

const TYPE_COLORS: Record<string, string> = {
  thought: 'text-stone-400', decision: 'text-violet-400', insight: 'text-sky-400',
  code: 'text-emerald-400', todo: 'text-amber-400', link: 'text-rose-400',
}

const props = defineProps<{
  node: ConstellationNode
  edges: ConstellationEdge[]
  allNodes: ConstellationNode[]
  themeColor: string
}>()

const emit = defineEmits<{
  close: []
  navigate: [nodeId: string]
}>()

const connected = computed(() => {
  return props.edges
    .filter(e => e.source === props.node.id || e.target === props.node.id)
    .map(e => {
      const otherId = e.source === props.node.id ? e.target : e.source
      const other = props.allNodes.find(n => n.id === otherId)
      return other ? { node: other, similarity: e.similarity, reason: (e as any).reason } : null
    })
    .filter(Boolean)
    .sort((a, b) => b!.similarity - a!.similarity) as { node: ConstellationNode; similarity: number; reason?: string }[]
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Transition name="drawer">
    <div
      class="w-96 h-full border-l border-border-secondary bg-bg-elevated/95 backdrop-blur-md flex flex-col overflow-hidden flex-shrink-0"
      @keydown="handleKeydown"
      tabindex="0"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-border-secondary/50">
        <div class="flex items-center gap-2">
          <span :class="['text-lg', TYPE_COLORS[node.type] || 'text-stone-400']">
            {{ TYPE_ICONS[node.type] || '●' }}
          </span>
          <span class="text-xs text-text-tertiary uppercase tracking-wider font-bold">
            {{ node.type }}
          </span>
        </div>
        <button
          @click="emit('close')"
          class="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-primary rounded-md hover:bg-bg-tertiary transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto px-5 py-4 space-y-5">
        <!-- Full text -->
        <p class="text-[15px] text-text-primary leading-relaxed" style="font-family: 'Inter', system-ui, sans-serif;">
          {{ node.text }}
        </p>

        <!-- Tags -->
        <div v-if="node.tags.length > 0" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in node.tags" :key="tag"
            class="text-[10px] text-text-tertiary bg-bg-tertiary/80 px-2 py-0.5 rounded font-mono"
          >
            #{{ tag }}
          </span>
        </div>

        <!-- Connected thoughts -->
        <div v-if="connected.length > 0">
          <div class="text-[10px] text-text-tertiary uppercase tracking-widest font-bold mb-3">
            Connected ({{ connected.length }})
          </div>
          <div class="space-y-1.5">
            <button
              v-for="{ node: other, similarity, reason } in connected"
              :key="other.id"
              @click="emit('navigate', other.id)"
              class="w-full text-left p-3 rounded-lg bg-bg-tertiary/40 hover:bg-bg-tertiary/80 transition-colors group cursor-pointer"
            >
              <div class="flex items-start gap-2.5">
                <span :class="['text-sm mt-0.5 flex-shrink-0', TYPE_COLORS[other.type] || 'text-stone-400']">
                  {{ TYPE_ICONS[other.type] || '●' }}
                </span>
                <div class="flex-1 min-w-0">
                  <p class="text-[13px] text-text-secondary group-hover:text-text-primary line-clamp-2 transition-colors">
                    {{ other.text }}
                  </p>
                  <div class="flex items-center gap-2 mt-1">
                    <span class="text-[9px] text-text-tertiary">
                      {{ Math.round(similarity * 100) }}% similar
                    </span>
                    <span v-if="reason" class="text-[9px] text-text-tertiary/60">
                      · {{ reason }}
                    </span>
                  </div>
                </div>
                <span class="text-text-tertiary group-hover:text-text-primary transition-colors text-sm mt-1">→</span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.drawer-enter-active,
.drawer-leave-active {
  transition: transform 0.25s ease, opacity 0.2s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
