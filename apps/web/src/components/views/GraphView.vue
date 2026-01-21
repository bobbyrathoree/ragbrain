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
const sidebarCollapsed = ref(true)  // Collapsed by default
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
let themeLabelElements: d3.Selection<SVGGElement, GraphTheme, SVGGElement, unknown> | null = null
let hullElements: d3.Selection<SVGPathElement, GraphTheme, SVGGElement, unknown> | null = null
let zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null = null

// Laser animation state
interface LaserBeam {
  themeId: string
  fromNode: GraphNode | null
  toNode: GraphNode | null
  progress: number
  currentNodeIndex: number
  nodePath: GraphNode[]  // Ordered sequence of nodes to visit
}
let laserBeams: LaserBeam[] = []
let laserElements: d3.Selection<SVGLineElement, LaserBeam, SVGGElement, unknown> | null = null
let animationFrame: number | null = null

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

// Helper to lighten a hex color
function lightenColor(hex: string, percent: number): string {
  const num = parseInt(hex.slice(1), 16)
  const r = Math.min(255, (num >> 16) + percent)
  const g = Math.min(255, ((num >> 8) & 0x00FF) + percent)
  const b = Math.min(255, (num & 0x0000FF) + percent)
  return `rgb(${r},${g},${b})`
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

  // Create SVG definitions for 3D effects
  const defs = svg.append('defs')

  // Radial gradients for each theme (sphere-like nodes)
  themes.value.forEach(theme => {
    const gradient = defs.append('radialGradient')
      .attr('id', `node-grad-${theme.id}`)
      .attr('cx', '30%')
      .attr('cy', '30%')

    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', lightenColor(theme.color, 80))

    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', theme.color)
  })

  // Drop shadow filter for nodes
  const shadow = defs.append('filter')
    .attr('id', 'node-shadow')
    .attr('x', '-50%')
    .attr('y', '-50%')
    .attr('width', '200%')
    .attr('height', '200%')

  shadow.append('feDropShadow')
    .attr('dx', 1)
    .attr('dy', 2)
    .attr('stdDeviation', 2)
    .attr('flood-opacity', 0.3)

  // Glow filter for lasers
  const glow = defs.append('filter')
    .attr('id', 'laser-glow')
    .attr('x', '-100%')
    .attr('y', '-100%')
    .attr('width', '300%')
    .attr('height', '300%')

  glow.append('feGaussianBlur')
    .attr('stdDeviation', 4)
    .attr('result', 'blur')

  const merge = glow.append('feMerge')
  merge.append('feMergeNode').attr('in', 'blur')
  merge.append('feMergeNode').attr('in', 'SourceGraphic')

  // Create cluster hulls (drawn behind everything)
  hullElements = g.insert('g', ':first-child')
    .attr('class', 'hulls')
    .selectAll<SVGPathElement, GraphTheme>('path')
    .data(themes.value)
    .join('path')
    .attr('fill', d => d.color + '08')
    .attr('stroke', d => d.color + '20')
    .attr('stroke-width', 1.5)
    .attr('stroke-linejoin', 'round')

  // Create edge elements
  edgeElements = g.append('g')
    .attr('class', 'edges')
    .selectAll<SVGLineElement, GraphEdge>('line')
    .data(edges.value)
    .join('line')
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.2)
    .attr('stroke-width', 1)
    .attr('class', 'text-gray-400 dark:text-gray-600') as d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown>

  // Create node elements with 3D gradient effect
  nodeElements = g.append('g')
    .attr('class', 'nodes')
    .selectAll<SVGCircleElement, GraphNode>('circle')
    .data(nodes.value)
    .join('circle')
    .attr('r', d => 4 + d.importance * 6)
    .attr('fill', d => `url(#node-grad-${d.themeId})`)
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .attr('filter', 'url(#node-shadow)')
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
    }) as d3.Selection<SVGCircleElement, GraphNode, SVGGElement, unknown>

  // Add drag behavior
  nodeElements.call(
    d3.drag<SVGCircleElement, GraphNode>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded)
  )

  // Add theme labels at cluster centroids
  themeLabelElements = g.append('g')
    .attr('class', 'theme-labels')
    .selectAll<SVGGElement, GraphTheme>('g')
    .data(themes.value)
    .join('g')
    .attr('pointer-events', 'none')

  // Background pill for readability
  themeLabelElements.append('rect')
    .attr('rx', 12)
    .attr('ry', 12)
    .attr('fill', d => d.color + '15')
    .attr('stroke', d => d.color + '30')
    .attr('stroke-width', 1)

  // Label text
  themeLabelElements.append('text')
    .attr('font-size', '11px')
    .attr('font-weight', '600')
    .attr('fill', d => d.color)
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .text(d => d.label)

  // Size the background pills to fit text
  themeLabelElements.each(function() {
    const group = d3.select(this)
    const text = group.select('text')
    const bbox = (text.node() as SVGTextElement).getBBox()
    group.select('rect')
      .attr('x', bbox.x - 10)
      .attr('y', bbox.y - 4)
      .attr('width', bbox.width + 20)
      .attr('height', bbox.height + 8)
  })

  // Initialize laser beams - one for each cluster, visiting all nodes
  laserBeams = themes.value.map(theme => {
    const themeNodes = nodes.value.filter(n => n.themeId === theme.id)

    if (themeNodes.length < 2) {
      return null // Need at least 2 nodes for a laser path
    }

    // Sort nodes by angle from centroid to create a circular path
    const centroidX = themeNodes.reduce((sum, n) => sum + (n.x || 0), 0) / themeNodes.length
    const centroidY = themeNodes.reduce((sum, n) => sum + (n.y || 0), 0) / themeNodes.length

    const sortedNodes = [...themeNodes].sort((a, b) => {
      const angleA = Math.atan2((a.y || 0) - centroidY, (a.x || 0) - centroidX)
      const angleB = Math.atan2((b.y || 0) - centroidY, (b.x || 0) - centroidX)
      return angleA - angleB
    })

    return {
      themeId: theme.id,
      fromNode: sortedNodes[0],
      toNode: sortedNodes[1],
      progress: Math.random(), // Stagger start positions
      currentNodeIndex: 0,
      nodePath: sortedNodes
    }
  }).filter((b): b is LaserBeam => b !== null && b.nodePath.length >= 2)

  // Create laser line elements
  laserElements = g.append('g')
    .attr('class', 'lasers')
    .selectAll<SVGLineElement, LaserBeam>('line')
    .data(laserBeams)
    .join('line')
    .attr('stroke', d => colorScale.value.get(d.themeId) || '#fff')
    .attr('stroke-width', 3)
    .attr('stroke-linecap', 'round')
    .attr('filter', 'url(#laser-glow)')
    .attr('opacity', 0.8)

  // Start laser animation
  animateLasers()

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
  // Update edge positions
  if (edgeElements) {
    edgeElements
      .attr('x1', d => (d.source as unknown as GraphNode).x)
      .attr('y1', d => (d.source as unknown as GraphNode).y)
      .attr('x2', d => (d.target as unknown as GraphNode).x)
      .attr('y2', d => (d.target as unknown as GraphNode).y)
  }

  // Update node positions
  if (nodeElements) {
    nodeElements
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
  }

  // Update cluster hulls
  if (hullElements) {
    hullElements.attr('d', d => {
      const themeNodes = nodes.value.filter(n => n.themeId === d.id)
      if (themeNodes.length < 3) return ''

      const points = themeNodes.map(n => [n.x, n.y] as [number, number])
      const hull = d3.polygonHull(points)
      if (!hull) return ''

      // Expand hull with padding
      const centroid = d3.polygonCentroid(hull)
      const expanded = hull.map(p => {
        const dx = p[0] - centroid[0]
        const dy = p[1] - centroid[1]
        const dist = Math.sqrt(dx * dx + dy * dy)
        const scale = (dist + 30) / dist // 30px padding
        return [centroid[0] + dx * scale, centroid[1] + dy * scale]
      })

      return `M${expanded.map(p => p.join(',')).join('L')}Z`
    })
  }

  // Update theme label positions OUTSIDE the cluster (above the topmost node)
  if (themeLabelElements) {
    themeLabelElements.each(function(d) {
      const themeNodes = nodes.value.filter(n => n.themeId === d.id)
      if (themeNodes.length === 0) return

      // Calculate centroid X for horizontal positioning
      const cx = themeNodes.reduce((sum, n) => sum + n.x, 0) / themeNodes.length

      // Find the topmost node (minimum Y value) in the cluster
      const minY = Math.min(...themeNodes.map(n => n.y))

      // Get the largest node radius in the cluster to account for node sizes
      const maxNodeRadius = Math.max(...themeNodes.map(n => 4 + n.importance * 6))

      // Position label above the topmost node with padding
      // Add 40px padding plus the hull expansion (30px) plus max node radius
      const labelY = minY - maxNodeRadius - 30 - 40

      // Position above the cluster's topmost point
      d3.select(this).attr('transform', `translate(${cx}, ${labelY})`)
    })
  }
}

// Laser animation loop
function animateLasers() {
  const speed = 0.02

  laserBeams.forEach(beam => {
    if (beam.nodePath.length < 2) return

    // Get current and next node in the path
    const currentIdx = beam.currentNodeIndex
    const nextIdx = (currentIdx + 1) % beam.nodePath.length

    // Update fromNode and toNode to reference the actual node objects (with current positions)
    beam.fromNode = nodes.value.find(n => n.id === beam.nodePath[currentIdx].id) || beam.nodePath[currentIdx]
    beam.toNode = nodes.value.find(n => n.id === beam.nodePath[nextIdx].id) || beam.nodePath[nextIdx]

    // Advance progress
    beam.progress += speed
    if (beam.progress >= 1) {
      beam.progress = 0
      // Move to next pair of nodes
      beam.currentNodeIndex = nextIdx
    }
  })

  // Update laser positions
  laserElements?.each(function(d) {
    if (!d.fromNode || !d.toNode) return

    const x1 = d.fromNode.x
    const y1 = d.fromNode.y
    const x2 = d.toNode.x
    const y2 = d.toNode.y

    // Calculate beam position (small segment along the path)
    const beamLength = 20
    const currentX = x1 + (x2 - x1) * d.progress
    const currentY = y1 + (y2 - y1) * d.progress

    // Direction vector
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len === 0) return

    const nx = dx / len * beamLength / 2
    const ny = dy / len * beamLength / 2

    d3.select(this)
      .attr('x1', currentX - nx)
      .attr('y1', currentY - ny)
      .attr('x2', currentX + nx)
      .attr('y2', currentY + ny)
  })

  animationFrame = requestAnimationFrame(animateLasers)
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

// Watch for dark mode theme changes to update colors
watch(() => document.documentElement.classList.contains('dark'), () => {
  if (nodeElements) {
    // Nodes use gradient fills, which are already theme-colored
    nodeElements.attr('fill', d => `url(#node-grad-${d.themeId})`)
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
  // Cancel laser animation
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
})
</script>

<template>
  <div class="h-[calc(100vh-5rem)] flex relative">
    <!-- Theme Sidebar - Collapsible -->
    <aside :class="[
      'border-r border-border-secondary overflow-auto bg-bg-elevated flex-shrink-0 transition-all duration-300',
      sidebarCollapsed ? 'w-14' : 'w-72'
    ]">
      <!-- Collapsed view: color dots + toggle -->
      <div v-if="sidebarCollapsed" class="p-3">
        <button
          @click="sidebarCollapsed = false"
          class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors mb-4"
          title="Expand sidebar"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <div class="space-y-3">
          <div
            v-for="theme in themes"
            :key="theme.id"
            class="w-4 h-4 mx-auto rounded-full cursor-pointer hover:scale-150 transition-transform ring-2 ring-transparent hover:ring-text-tertiary"
            :style="{ backgroundColor: theme.color }"
            :title="`${theme.label} (${theme.count})`"
            @click="sidebarCollapsed = false; expandedTheme = theme.id"
          />
        </div>
      </div>

      <!-- Expanded view: full theme list -->
      <div v-else>
        <div class="p-4 border-b border-border-secondary flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-text-primary">Knowledge Themes</h2>
            <p class="text-xs text-text-tertiary mt-1">{{ themes.length }} themes from {{ nodes.length }} thoughts</p>
          </div>
          <button
            @click="sidebarCollapsed = true"
            class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
            title="Collapse sidebar"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
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
      </div>

      <!-- Selected Node Details - only show when sidebar expanded -->
      <div v-if="selectedNode && !sidebarCollapsed" class="p-4 border-t border-border-secondary bg-bg-tertiary/30">
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
