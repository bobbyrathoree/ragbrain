<script setup lang="ts">
/**
 * Knowledge Graph — orchestrates data, physics, and rendering.
 * Previously 692 lines mixing Three.js, D3, shaders, and Vue UI.
 * Now delegates to GraphRenderer (Three.js) and useGraphPhysics (D3).
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { graphApi } from '@/api'
import type { GraphNode, GraphTheme } from '@/types'
import { GraphRenderer } from './GraphRenderer'
import { startSimulation } from './useGraphPhysics'

// ── State ───────────────────────────────────────────────────────

const containerRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const hoveredNode = ref<GraphNode | null>(null)
const selectedNode = ref<GraphNode | null>(null)
const sidebarCollapsed = ref(true)
const expandedTheme = ref<string | null>(null)
const themes = ref<GraphTheme[]>([])
const nodeCount = ref(0)

let graphRenderer: GraphRenderer | null = null
let simulation: ReturnType<typeof startSimulation> | null = null

// ── Lifecycle ───────────────────────────────────────────────────

onMounted(async () => {
  isLoading.value = true
  loadError.value = null

  try {
    const data = await graphApi.get()
    if (!data.themes?.length) {
      loadError.value = 'No graph data available'
      isLoading.value = false
      return
    }

    themes.value = data.themes
    nodeCount.value = data.nodes?.length || 0

    // Initialize renderer
    graphRenderer = new GraphRenderer({
      onNodeHover: (node) => { hoveredNode.value = node },
      onNodeClick: (node) => {
        selectedNode.value = node
        expandedTheme.value = node.themeId
        sidebarCollapsed.value = false
      },
    })
    graphRenderer.init(containerRef.value!)
    graphRenderer.setData(data.nodes || [], data.edges || [], data.themes)

    // Start physics simulation
    simulation = startSimulation(
      data.nodes || [],
      data.edges || [],
      graphRenderer.nodePositions,
      () => graphRenderer!.updateNodePositions(),
    )
  } catch (e) {
    console.warn('Failed to load graph:', e)
    loadError.value = 'Failed to load graph data'
  } finally {
    isLoading.value = false
  }
})

onUnmounted(() => {
  simulation?.stop()
  graphRenderer?.dispose()
})

// ── Actions ─────────────────────────────────────────────────────

function handleClick() {
  if (hoveredNode.value) {
    selectedNode.value = hoveredNode.value
    expandedTheme.value = hoveredNode.value.themeId
    sidebarCollapsed.value = false
  }
}

function focusOnTheme(themeId: string) {
  expandedTheme.value = expandedTheme.value === themeId ? null : themeId
  graphRenderer?.focusOnTheme(themeId)
}
</script>

<template>
  <div class="h-screen flex relative">
    <!-- Theme Sidebar -->
    <aside :class="[
      'border-r border-border-secondary overflow-auto bg-bg-elevated flex-shrink-0 transition-all duration-300',
      sidebarCollapsed ? 'w-14' : 'w-72'
    ]">
      <div v-if="sidebarCollapsed" class="p-3">
        <button @click="sidebarCollapsed = false" class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors mb-4">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <div class="space-y-3">
          <div v-for="theme in themes" :key="theme.id"
            class="w-4 h-4 mx-auto rounded-full cursor-pointer hover:scale-150 transition-transform"
            :style="{ backgroundColor: theme.color }"
            :title="`${theme.label} (${theme.count})`"
            @click="sidebarCollapsed = false; focusOnTheme(theme.id)"
          />
        </div>
      </div>

      <div v-else>
        <div class="p-4 border-b border-border-secondary flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-text-primary">Knowledge Nebula</h2>
            <p class="text-xs text-text-tertiary mt-1">{{ themes.length }} clusters &middot; {{ nodeCount }} thoughts</p>
          </div>
          <button @click="sidebarCollapsed = true" class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div class="divide-y divide-border-secondary">
          <div v-for="theme in themes" :key="theme.id" class="group">
            <button @click="focusOnTheme(theme.id)" class="w-full p-4 text-left hover:bg-bg-tertiary transition-colors">
              <div class="flex items-center gap-3">
                <div class="w-3 h-3 rounded-full flex-shrink-0" :style="{ backgroundColor: theme.color }" />
                <div class="flex-1 min-w-0">
                  <h3 class="font-medium text-sm text-text-primary truncate">{{ theme.label }}</h3>
                  <p class="text-xs text-text-tertiary mt-0.5 line-clamp-2">{{ theme.description }}</p>
                </div>
                <span class="text-xs font-medium text-text-secondary bg-bg-tertiary px-2 py-0.5 rounded-full">{{ theme.count }}</span>
              </div>
            </button>

            <div v-if="expandedTheme === theme.id" class="bg-bg-tertiary/50 border-t border-border-secondary">
              <div class="p-3 space-y-2">
                <div v-for="thought in theme.sampleThoughts" :key="thought.id"
                  class="text-xs p-2 bg-bg-elevated rounded-lg text-text-secondary hover:text-text-primary cursor-pointer transition-colors">
                  {{ thought.text }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="selectedNode" class="p-4 border-t border-border-secondary bg-bg-tertiary/30">
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Selected</h4>
            <button @click="selectedNode = null" class="text-text-tertiary hover:text-text-primary">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="p-3 bg-bg-elevated rounded-lg">
            <p class="text-sm text-text-primary leading-relaxed">{{ selectedNode.label }}</p>
            <div class="flex items-center gap-2 mt-2">
              <span class="text-xs text-text-tertiary capitalize">{{ selectedNode.type }}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- WebGL Canvas -->
    <div ref="containerRef" class="flex-1 relative" @click="handleClick">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
        <div class="text-text-secondary text-sm">Loading knowledge nebula...</div>
      </div>

      <div v-if="loadError && !isLoading" class="absolute inset-0 flex items-center justify-center z-10">
        <div class="text-text-tertiary text-sm">{{ loadError }}</div>
      </div>

      <div v-if="hoveredNode"
        class="absolute pointer-events-none bg-bg-elevated/90 backdrop-blur-sm border border-border-secondary rounded-lg px-3 py-2 text-sm shadow-lg z-20 max-w-xs"
        style="left: 50%; top: 16px; transform: translateX(-50%)">
        <p class="text-text-primary font-medium">{{ hoveredNode.label }}</p>
        <p class="text-xs text-text-tertiary mt-1">{{ themes.find(t => t.id === hoveredNode?.themeId)?.label }}</p>
      </div>

      <div class="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
        <button @click="graphRenderer?.resetView()"
          class="w-10 h-10 bg-bg-elevated/80 border border-border-secondary rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shadow-sm backdrop-blur-sm"
          title="Reset view">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      <div class="absolute bottom-4 left-4 text-xs text-text-tertiary space-y-1 bg-bg-elevated/60 backdrop-blur-sm rounded-lg p-3 border border-border-secondary z-10">
        <p>Orbit to explore</p>
        <p>Hover to trace connections</p>
        <p>Click to select</p>
      </div>
    </div>
  </div>
</template>
