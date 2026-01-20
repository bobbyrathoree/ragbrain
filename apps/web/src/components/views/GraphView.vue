<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as d3 from 'd3'
import { graphApi } from '@/api'
import type { GraphNode, GraphEdge, GraphTheme } from '@/types'

const graphContainer = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const selectedNode = ref<GraphNode | null>(null)
const hoveredNode = ref<{ node: GraphNode; x: number; y: number } | null>(null)
const expandedTheme = ref<string | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)

// Graph data from API
const themes = ref<GraphTheme[]>([])
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])

// D3 simulation
let simulation: d3.Simulation<GraphNode, GraphEdge> | null = null
let svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null
let nodeElements: d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown> | null = null
let edgeElements: d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown> | null = null
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

// Create color scale from themes
const colorScale = computed(() => {
  const scale = new Map<string, string>()
  themes.value.forEach(theme => {
    scale.set(theme.id, theme.color)
  })
  return scale
})

function getNodeColor(node: GraphNode): string {
  return colorScale.value.get(node.themeId) || '#6b7280'
}

function initForceGraph() {
  if (!svgRef.value || !graphContainer.value) return

  const width = graphContainer.value.clientWidth
  const height = graphContainer.value.clientHeight

  // Clear previous content
  d3.select(svgRef.value).selectAll('*').remove()

  svg = d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)

  // Create container group for zoom/pan
  const g = svg.append('g')

  // Set up zoom behavior
  zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })

  svg.call(zoomBehavior)

  // Initial zoom to fit content
  const initialScale = 0.8
  const initialX = width / 2
  const initialY = height / 2
  svg.call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(initialX, initialY).scale(initialScale)
  )

  // Create edge elements
  edgeElements = g.append('g')
    .attr('class', 'edges')
    .selectAll('line')
    .data(edges.value)
    .join('line')
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.2)
    .attr('stroke-width', 1)
    .attr('class', 'text-gray-400 dark:text-gray-600')

  // Create node elements
  nodeElements = g.append('g')
    .attr('class', 'nodes')
    .selectAll('circle')
    .data(nodes.value)
    .join('circle')
    .attr('r', d => 4 + d.importance * 6)
    .attr('fill', d => getNodeColor(d))
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .attr('cursor', 'pointer')
    .on('mouseenter', (event, d) => {
      const rect = graphContainer.value?.getBoundingClientRect()
      if (rect) {
        hoveredNode.value = {
          node: d,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        }
      }
    })
    .on('mouseleave', () => {
      hoveredNode.value = null
    })
    .on('click', (_, d) => {
      selectedNode.value = d
      expandedTheme.value = d.themeId
    })

  // Add drag behavior
  nodeElements.call(
    d3.drag<SVGCircleElement, GraphNode>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded)
  )

  // Create force simulation
  simulation = d3.forceSimulation<GraphNode>(nodes.value)
    .force('link', d3.forceLink<GraphNode, GraphEdge>(edges.value)
      .id(d => d.id)
      .distance(60)
      .strength(0.3))
    .force('charge', d3.forceManyBody().strength(-80))
    .force('center', d3.forceCenter(0, 0))
    .force('collision', d3.forceCollide().radius(d => 8 + (d as GraphNode).importance * 6))
    .force('cluster', forceCluster())
    .on('tick', ticked)
}

// Custom force to cluster nodes by theme
function forceCluster() {
  const strength = 0.15

  function force(alpha: number) {
    // Calculate theme centroids
    const themeCentroids = new Map<string, { x: number; y: number; count: number }>()

    for (const node of nodes.value) {
      const centroid = themeCentroids.get(node.themeId) || { x: 0, y: 0, count: 0 }
      centroid.x += node.x
      centroid.y += node.y
      centroid.count++
      themeCentroids.set(node.themeId, centroid)
    }

    // Normalize centroids
    for (const [, centroid] of themeCentroids) {
      centroid.x /= centroid.count
      centroid.y /= centroid.count
    }

    // Apply force toward theme centroid
    for (const node of nodes.value) {
      const centroid = themeCentroids.get(node.themeId)
      if (centroid) {
        node.vx = (node.vx || 0) + (centroid.x - node.x) * strength * alpha
        node.vy = (node.vy || 0) + (centroid.y - node.y) * strength * alpha
      }
    }
  }

  return force
}

function ticked() {
  if (edgeElements) {
    edgeElements
      .attr('x1', d => (d.source as unknown as GraphNode).x)
      .attr('y1', d => (d.source as unknown as GraphNode).y)
      .attr('x2', d => (d.target as unknown as GraphNode).x)
      .attr('y2', d => (d.target as unknown as GraphNode).y)
  }

  if (nodeElements) {
    nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
  }
}

function dragStarted(event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) {
  if (!event.active) simulation?.alphaTarget(0.3).restart()
  event.subject.fx = event.subject.x
  event.subject.fy = event.subject.y
}

function dragged(event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) {
  event.subject.fx = event.x
  event.subject.fy = event.y
}

function dragEnded(event: d3.D3DragEvent<SVGCircleElement, GraphNode, GraphNode>) {
  if (!event.active) simulation?.alphaTarget(0)
  event.subject.fx = null
  event.subject.fy = null
}

function toggleTheme(themeId: string) {
  expandedTheme.value = expandedTheme.value === themeId ? null : themeId
}

function focusOnTheme(themeId: string) {
  if (!svg || !zoomBehavior || !graphContainer.value) return

  // Find nodes in this theme
  const themeNodes = nodes.value.filter(n => n.themeId === themeId)
  if (themeNodes.length === 0) return

  // Calculate bounding box
  const xs = themeNodes.map(n => n.x)
  const ys = themeNodes.map(n => n.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  const width = graphContainer.value.clientWidth
  const height = graphContainer.value.clientHeight

  // Calculate zoom to fit theme
  const padding = 100
  const boxWidth = maxX - minX + padding * 2
  const boxHeight = maxY - minY + padding * 2
  const scale = Math.min(width / boxWidth, height / boxHeight, 2)

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  svg.transition()
    .duration(750)
    .call(
      zoomBehavior.transform,
      d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-centerX, -centerY)
    )
}

function resetView() {
  if (!svg || !zoomBehavior || !graphContainer.value) return

  const width = graphContainer.value.clientWidth
  const height = graphContainer.value.clientHeight

  svg.transition()
    .duration(750)
    .call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(0.8)
    )
}

function handleResize() {
  if (!svgRef.value || !graphContainer.value) return

  const width = graphContainer.value.clientWidth
  const height = graphContainer.value.clientHeight

  d3.select(svgRef.value)
    .attr('width', width)
    .attr('height', height)
}

// Watch for theme changes to update colors
watch(() => document.documentElement.classList.contains('dark'), () => {
  if (nodeElements) {
    nodeElements.attr('fill', d => getNodeColor(d))
  }
})

onMounted(async () => {
  isLoading.value = true
  loadError.value = null

  try {
    const apiData = await graphApi.get()

    if (apiData.themes && apiData.themes.length > 0) {
      themes.value = apiData.themes
      nodes.value = apiData.nodes || []
      edges.value = apiData.edges || []

      // Initialize positions from API data
      nodes.value.forEach(node => {
        node.x = node.x || 0
        node.y = node.y || 0
      })

      initForceGraph()
    } else {
      // Generate mock data for demo
      generateMockData()
      initForceGraph()
    }
  } catch (e) {
    console.warn('Failed to load graph from API, using demo data:', e)
    loadError.value = 'Using demo data'
    generateMockData()
    initForceGraph()
  } finally {
    isLoading.value = false
  }

  window.addEventListener('resize', handleResize)
})

function generateMockData() {
  // Generate mock themes
  themes.value = [
    { id: 'theme-0', label: 'Development & Code', description: 'Software development and coding tasks', color: '#FF6B6B', count: 12, sampleThoughts: [] },
    { id: 'theme-1', label: 'Project Planning', description: 'Planning and project management', color: '#4ECDC4', count: 8, sampleThoughts: [] },
    { id: 'theme-2', label: 'Learning & Research', description: 'Learning new technologies and research', color: '#45B7D1', count: 10, sampleThoughts: [] },
    { id: 'theme-3', label: 'Personal Notes', description: 'Personal thoughts and reminders', color: '#96CEB4', count: 10, sampleThoughts: [] },
  ]

  // Generate mock nodes
  nodes.value = []
  const labels = [
    'Implement user authentication with JWT tokens',
    'Fix the memory leak in the data processing pipeline',
    'Review pull request for new feature',
    'Set up CI/CD pipeline for automated testing',
    'Research best practices for API design',
    'Plan sprint goals for next week',
    'Document the new REST endpoints',
    'Optimize database queries for better performance',
    'Learn about WebSocket implementation',
    'Debug the production issue with caching',
  ]

  for (let i = 0; i < 40; i++) {
    const themeId = `theme-${i % 4}`
    nodes.value.push({
      id: `node-${i}`,
      label: labels[i % labels.length],
      themeId,
      x: (Math.random() - 0.5) * 300,
      y: (Math.random() - 0.5) * 300,
      tags: ['demo'],
      recency: Math.random(),
      importance: Math.random(),
      type: 'thought',
    })
  }

  // Update theme sample thoughts
  themes.value.forEach(theme => {
    theme.sampleThoughts = nodes.value
      .filter(n => n.themeId === theme.id)
      .slice(0, 3)
      .map(n => ({ id: n.id, text: n.label }))
  })

  // Generate mock edges
  edges.value = []
  for (let i = 0; i < nodes.value.length; i++) {
    // Connect to 1-3 random nodes
    const numConnections = Math.floor(Math.random() * 3) + 1
    for (let j = 0; j < numConnections; j++) {
      const targetIdx = Math.floor(Math.random() * nodes.value.length)
      if (targetIdx !== i) {
        edges.value.push({
          source: nodes.value[i].id,
          target: nodes.value[targetIdx].id,
          similarity: 0.7 + Math.random() * 0.3,
        })
      }
    }
  }
}

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  simulation?.stop()
})
</script>

<template>
  <div class="h-[calc(100vh-5rem)] flex relative">
    <!-- Theme Sidebar -->
    <aside class="w-72 border-r border-border-secondary overflow-auto bg-bg-elevated flex-shrink-0">
      <div class="p-4 border-b border-border-secondary">
        <h2 class="text-sm font-semibold text-text-primary">Knowledge Themes</h2>
        <p class="text-xs text-text-tertiary mt-1">{{ themes.length }} themes from {{ nodes.length }} thoughts</p>
      </div>

      <div class="divide-y divide-border-secondary">
        <div
          v-for="theme in themes"
          :key="theme.id"
          class="group"
        >
          <!-- Theme Header -->
          <button
            @click="toggleTheme(theme.id)"
            class="w-full p-4 text-left hover:bg-bg-tertiary transition-colors"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-3 h-3 rounded-full flex-shrink-0"
                :style="{ backgroundColor: theme.color }"
              />
              <div class="flex-1 min-w-0">
                <h3 class="font-medium text-sm text-text-primary truncate">{{ theme.label }}</h3>
                <p class="text-xs text-text-tertiary mt-0.5 line-clamp-2">{{ theme.description }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-text-secondary bg-bg-tertiary px-2 py-0.5 rounded-full">
                  {{ theme.count }}
                </span>
                <svg
                  class="w-4 h-4 text-text-tertiary transition-transform"
                  :class="{ 'rotate-180': expandedTheme === theme.id }"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </button>

          <!-- Expanded Sample Thoughts -->
          <div
            v-if="expandedTheme === theme.id"
            class="bg-bg-tertiary/50 border-t border-border-secondary"
          >
            <div class="p-3 space-y-2">
              <div
                v-for="thought in theme.sampleThoughts"
                :key="thought.id"
                class="text-xs p-2 bg-bg-elevated rounded-lg text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                @click="selectedNode = nodes.find(n => n.id === thought.id) || null"
              >
                {{ thought.text }}
              </div>
              <button
                @click="focusOnTheme(theme.id)"
                class="w-full text-xs text-accent-primary hover:text-accent-primary/80 py-1.5 flex items-center justify-center gap-1"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
                Focus on this theme
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Selected Node Details -->
      <div v-if="selectedNode" class="p-4 border-t border-border-secondary bg-bg-tertiary/30">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-xs font-semibold text-text-tertiary uppercase tracking-wider">Selected</h4>
          <button
            @click="selectedNode = null"
            class="text-text-tertiary hover:text-text-primary"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="p-3 bg-bg-elevated rounded-lg">
          <p class="text-sm text-text-primary leading-relaxed">{{ selectedNode.label }}</p>
          <div class="flex items-center gap-2 mt-2">
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :style="{ backgroundColor: getNodeColor(selectedNode) + '20', color: getNodeColor(selectedNode) }"
            >
              {{ themes.find(t => t.id === selectedNode?.themeId)?.label || 'Unknown' }}
            </span>
            <span class="text-xs text-text-tertiary capitalize">{{ selectedNode.type }}</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 2D Force Graph -->
    <div ref="graphContainer" class="flex-1 relative bg-bg-primary">
      <!-- Loading State -->
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-bg-primary/80">
        <div class="flex items-center gap-3 text-text-secondary">
          <svg class="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Loading knowledge graph...</span>
        </div>
      </div>

      <!-- Error Banner -->
      <div
        v-if="loadError"
        class="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs rounded-full"
      >
        {{ loadError }}
      </div>

      <!-- SVG Canvas -->
      <svg ref="svgRef" class="w-full h-full"></svg>

      <!-- Hover Tooltip -->
      <div
        v-if="hoveredNode"
        class="absolute pointer-events-none bg-bg-elevated/95 backdrop-blur-sm border border-border-secondary rounded-lg px-3 py-2 text-sm shadow-lg z-20 max-w-xs"
        :style="{ left: hoveredNode.x + 16 + 'px', top: hoveredNode.y - 8 + 'px' }"
      >
        <p class="text-text-primary font-medium">{{ hoveredNode.node.label }}</p>
        <p class="text-xs text-text-tertiary mt-1">
          {{ themes.find(t => t.id === hoveredNode?.node.themeId)?.label || 'Unknown theme' }}
        </p>
      </div>

      <!-- Controls -->
      <div class="absolute bottom-4 right-4 flex flex-col gap-2">
        <button
          @click="resetView"
          class="w-10 h-10 bg-bg-elevated border border-border-secondary rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shadow-sm"
          title="Reset view"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      <!-- Legend -->
      <div class="absolute bottom-4 left-4 text-xs text-text-tertiary space-y-1 bg-bg-elevated/80 backdrop-blur-sm rounded-lg p-3 border border-border-secondary">
        <p>Drag nodes to rearrange</p>
        <p>Scroll to zoom</p>
        <p>Click node to select</p>
      </div>
    </div>
  </div>
</template>
