<script setup lang="ts">
/**
 * Knowledge Galaxy — zoomable hierarchical graph visualization.
 * LOD 0: Galaxy overview (theme bubbles + affinities)
 * LOD 1: Constellation (thought nodes + edges within a theme)
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { CanvasRenderer } from './graph/CanvasRenderer'
import { useGraphNavigation } from './graph/useGraphNavigation'
import ThoughtDrawer from './graph/ThoughtDrawer.vue'
import type { ConstellationNode } from '@/types'

const containerRef = ref<HTMLDivElement | null>(null)
let renderer: CanvasRenderer | null = null

const {
  currentLevel,
  isLoading,
  error,
  galaxyData,
  constellationData,
  selectedThemeLabel,
  loadOverview,
  drillInto,
  drillOut,
} = useGraphNavigation()

// Drawer state
const drawerNode = ref<ConstellationNode | null>(null)

function closeDrawer() {
  drawerNode.value = null
}

function navigateToNode(nodeId: string) {
  const node = constellationData.value?.thoughts.find((t: any) => t.id === nodeId)
  if (node) {
    drawerNode.value = { ...node } as any
    renderer?.focusNode(nodeId)
  }
}

// ── Lifecycle ───────────────────────────────────────────────────

onMounted(async () => {
  if (!containerRef.value) return

  const canvas = document.createElement('canvas')
  containerRef.value.appendChild(canvas)
  renderer = new CanvasRenderer(canvas)

  const rect = containerRef.value.getBoundingClientRect()
  renderer.resize(rect.width, rect.height)

  renderer.onHover = () => {}

  renderer.onClick = (hit) => {
    if (!hit) {
      if (drawerNode.value) {
        closeDrawer()
      } else if (currentLevel.value === 1) {
        renderer?.transitionToGalaxy()
        drillOut()
      }
      return
    }

    if (hit.type === 'bubble') {
      renderer?.transitionToConstellation(hit.id)
      drillInto(hit.id)
    } else if (hit.type === 'node') {
      drawerNode.value = hit.data as ConstellationNode
    }
  }

  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    renderer?.resize(width, height)
  })
  resizeObserver.observe(containerRef.value)

  await loadOverview()
})

onUnmounted(() => {
  renderer?.dispose()
})

// ── Data to Renderer sync ───────────────────────────────────────

watch(galaxyData, (data) => {
  if (data?.themes && renderer) {
    renderer.setGalaxyData([...data.themes] as any, [...(data.affinities || [])])
  }
})

watch(constellationData, (data) => {
  if (data?.thoughts && renderer) {
    renderer.setConstellationData([...data.thoughts] as any, [...(data.edges || [])], data.themeColor)
  }
})
</script>

<template>
  <div class="h-screen flex relative">
    <!-- Main canvas area -->
    <div class="flex-1 flex flex-col">
      <!-- Theme label (constellation only) -->
      <div v-if="currentLevel === 1" class="absolute top-16 left-6 z-10">
        <div class="text-text-primary text-xl font-bold tracking-tight" style="font-family: 'Inter', system-ui, sans-serif;">
          {{ selectedThemeLabel }}
        </div>
        <button @click="renderer?.transitionToGalaxy(); drillOut(); closeDrawer()"
          class="text-text-tertiary text-xs mt-1 hover:text-text-primary transition-colors cursor-pointer">
          &larr; Back to overview
        </button>
      </div>

      <!-- Canvas container -->
      <div ref="containerRef" class="flex-1 relative">
        <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
          <div class="text-text-secondary text-sm">Loading knowledge graph...</div>
        </div>

        <div v-if="error && !isLoading" class="absolute inset-0 flex items-center justify-center z-10">
          <div class="text-center">
            <div class="text-text-tertiary text-sm mb-2">{{ error }}</div>
            <button @click="loadOverview" class="text-xs text-text-secondary hover:text-text-primary underline">Retry</button>
          </div>
        </div>

        <div v-if="!isLoading && !error && galaxyData && galaxyData.themes.length === 0"
          class="absolute inset-0 flex items-center justify-center z-10">
          <div class="text-text-tertiary text-sm">No graph data yet</div>
        </div>
      </div>

      <!-- Galaxy hint -->
      <div v-if="currentLevel === 0" class="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-[11px] text-text-tertiary/40">
        Click a cluster to explore
      </div>
    </div>

    <!-- Thought drawer (right sidebar) -->
    <ThoughtDrawer
      v-if="drawerNode && constellationData"
      :node="(drawerNode as any)"
      :edges="([...constellationData.edges] as any)"
      :all-nodes="([...constellationData.thoughts] as any)"
      :theme-color="constellationData.themeColor"
      @close="closeDrawer"
      @navigate="navigateToNode"
    />
  </div>
</template>
