<script setup lang="ts">
/**
 * Knowledge Galaxy — zoomable hierarchical graph visualization.
 * LOD 0: Galaxy overview (theme bubbles + affinities)
 * LOD 1: Constellation (thought nodes + edges within a theme)
 */
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { CanvasRenderer } from './graph/CanvasRenderer'
import { useGraphNavigation } from './graph/useGraphNavigation'
import GraphDetailPanel from './graph/GraphDetailPanel.vue'
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
  selectedNode,
  loadOverview,
  drillInto,
  drillOut,
  selectNode,
  clearSelection,
} = useGraphNavigation()

// ── Lifecycle ───────────────────────────────────────────────────

onMounted(async () => {
  if (!containerRef.value) return

  // Initialize canvas renderer
  const canvas = document.createElement('canvas')
  containerRef.value.appendChild(canvas)
  renderer = new CanvasRenderer(canvas)

  const rect = containerRef.value.getBoundingClientRect()
  renderer.resize(rect.width, rect.height)

  // Wire up interaction callbacks
  renderer.onHover = () => {
    // Hover state managed internally by renderer for visual feedback
  }

  renderer.onClick = (hit) => {
    if (!hit) {
      if (currentLevel.value === 1) {
        renderer?.transitionToGalaxy()
        drillOut()
      } else {
        clearSelection()
      }
      return
    }

    if (hit.type === 'bubble') {
      renderer?.transitionToConstellation(hit.id)
      drillInto(hit.id)
    } else if (hit.type === 'node') {
      selectNode(hit.data as ConstellationNode)
    }
  }

  // Handle resize
  const resizeObserver = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect
    renderer?.resize(width, height)
  })
  resizeObserver.observe(containerRef.value)

  // Load initial data
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

// Drill-out is handled by the renderer's onClick(null) callback
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
        <button @click="renderer?.transitionToGalaxy(); drillOut()"
          class="text-text-tertiary text-xs mt-1 hover:text-text-primary transition-colors cursor-pointer">
          &larr; Back to overview
        </button>
      </div>

      <!-- Canvas container -->
      <div ref="containerRef" class="flex-1 relative">
        <!-- Loading -->
        <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
          <div class="text-text-secondary text-sm">Loading knowledge graph...</div>
        </div>

        <!-- Error -->
        <div v-if="error && !isLoading" class="absolute inset-0 flex items-center justify-center z-10">
          <div class="text-center">
            <div class="text-text-tertiary text-sm mb-2">{{ error }}</div>
            <button @click="loadOverview" class="text-xs text-text-secondary hover:text-text-primary underline">
              Retry
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!isLoading && !error && galaxyData && galaxyData.themes.length === 0"
          class="absolute inset-0 flex items-center justify-center z-10">
          <div class="text-center">
            <div class="text-text-tertiary text-sm">No graph data yet</div>
            <div class="text-text-tertiary text-xs mt-1">Capture some thoughts first</div>
          </div>
        </div>
      </div>

      <!-- Minimal hint (galaxy only) -->
      <div v-if="currentLevel === 0" class="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 text-[11px] text-text-tertiary/40">
        Click a cluster to explore
      </div>
    </div>

    <!-- Detail panel (LOD 1 only, when a thought is selected) -->
    <GraphDetailPanel
      v-if="selectedNode && constellationData"
      :node="(selectedNode as any)"
      :edges="([...constellationData.edges] as any)"
      :all-nodes="([...constellationData.thoughts] as any)"
      :theme-color="constellationData.themeColor"
      @close="clearSelection"
    />
  </div>
</template>
