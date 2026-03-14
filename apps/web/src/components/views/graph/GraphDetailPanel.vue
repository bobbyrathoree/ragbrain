<script setup lang="ts">
import type { ConstellationNode, ConstellationEdge } from '@/types'

const props = defineProps<{
  node: ConstellationNode
  edges: ConstellationEdge[]
  allNodes: ConstellationNode[]
  themeColor: string
}>()

const emit = defineEmits<{ close: [] }>()

const TYPE_LABELS: Record<string, string> = {
  thought: 'Thought', decision: 'Decision', insight: 'Insight',
  code: 'Code', todo: 'Todo', link: 'Link',
}

const TYPE_COLORS: Record<string, string> = {
  thought: 'bg-stone-400', decision: 'bg-violet-500', insight: 'bg-sky-500',
  code: 'bg-emerald-500', todo: 'bg-amber-500', link: 'bg-rose-400',
}

// Find connected thoughts
const connected = props.edges
  .filter(e => e.source === props.node.id || e.target === props.node.id)
  .map(e => {
    const otherId = e.source === props.node.id ? e.target : e.source
    const other = props.allNodes.find(n => n.id === otherId)
    return other ? { node: other, similarity: e.similarity } : null
  })
  .filter(Boolean)
  .sort((a, b) => b!.similarity - a!.similarity) as { node: ConstellationNode; similarity: number }[]
</script>

<template>
  <div class="w-80 border-l border-border-secondary bg-bg-elevated overflow-auto flex-shrink-0">
    <!-- Header -->
    <div class="p-4 border-b border-border-secondary flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div :class="['w-2 h-2 rounded-full', TYPE_COLORS[node.type] || 'bg-stone-400']" />
        <span class="text-xs text-text-tertiary uppercase tracking-wider font-semibold">
          {{ TYPE_LABELS[node.type] || node.type }}
        </span>
      </div>
      <button @click="emit('close')" class="w-6 h-6 flex items-center justify-center text-text-tertiary hover:text-text-primary rounded transition-colors">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="p-4">
      <p class="text-sm text-text-primary leading-relaxed">{{ node.text }}</p>

      <div v-if="node.tags.length" class="flex flex-wrap gap-1.5 mt-3">
        <span v-for="tag in node.tags" :key="tag"
          class="text-[10px] text-text-tertiary bg-bg-tertiary px-2 py-0.5 rounded">
          #{{ tag }}
        </span>
      </div>
    </div>

    <!-- Connected Thoughts -->
    <div v-if="connected.length" class="border-t border-border-secondary p-4">
      <h4 class="text-xs text-text-tertiary uppercase tracking-wider font-semibold mb-3">
        Connected ({{ connected.length }})
      </h4>
      <div class="space-y-2">
        <div v-for="{ node: other, similarity } in connected" :key="other.id"
          class="p-2.5 bg-bg-tertiary/50 rounded-lg">
          <p class="text-xs text-text-secondary line-clamp-2">{{ other.text }}</p>
          <div class="flex items-center gap-2 mt-1.5">
            <span :class="['text-[9px] uppercase font-semibold', `text-${TYPE_COLORS[other.type]?.replace('bg-', '') || 'stone-400'}`]">
              {{ other.type }}
            </span>
            <span class="text-[9px] text-text-tertiary">{{ Math.round(similarity * 100) }}% similar</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
