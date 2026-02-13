<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import * as d3 from 'd3'
import { graphApi } from '@/api'
import type { GraphNode, GraphEdge, GraphTheme } from '@/types'

const containerRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)
const loadError = ref<string | null>(null)
const hoveredNode = ref<GraphNode | null>(null)
const selectedNode = ref<GraphNode | null>(null)
const sidebarCollapsed = ref(true)
const expandedTheme = ref<string | null>(null)

const themes = ref<GraphTheme[]>([])
const nodes = ref<GraphNode[]>([])
const edges = ref<GraphEdge[]>([])

// Three.js refs
let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let controls: OrbitControls
let composer: EffectComposer
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2
let pointCloud: THREE.Points
let edgeLines: THREE.LineSegments
let nebulaSprites: THREE.Sprite[] = []
let animationId: number
let nodePositions: Float32Array
let nodeSizes: Float32Array
let nodeColors: Float32Array
let nodeAlphas: Float32Array
let edgePositions: Float32Array
let edgeColors: Float32Array

// D3 force simulation for layout
let simulation: d3.Simulation<any, any> | null = null

const vertexShader = `
  attribute float size;
  attribute float alpha;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    // Soft glow falloff
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    float core = 1.0 - smoothstep(0.0, 0.15, dist);

    vec3 color = vColor * glow + vec3(1.0) * core * 0.3;
    float finalAlpha = vAlpha * glow;

    gl_FragColor = vec4(color, finalAlpha);
  }
`

function hexToRGB(hex: string): [number, number, number] {
  const c = new THREE.Color(hex)
  return [c.r, c.g, c.b]
}

function getThemeColor(node: GraphNode): [number, number, number] {
  const theme = themes.value.find(t => t.id === node.themeId)
  return theme ? hexToRGB(theme.color) : [0.5, 0.5, 0.5]
}

function initScene() {
  if (!containerRef.value) return

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  containerRef.value.appendChild(renderer.domElement)

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x050508)

  // Camera
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000)
  camera.position.set(0, 0, 120)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 20
  controls.maxDistance = 300
  controls.autoRotate = true
  controls.autoRotateSpeed = 0.3

  // Raycaster
  raycaster = new THREE.Raycaster()
  raycaster.params.Points = { threshold: 1.5 }
  mouse = new THREE.Vector2()

  // Post-processing
  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    1.8,   // strength - cranked up for visible glow
    0.8,   // radius
    0.1    // threshold - lower = more things glow
  )
  composer.addPass(bloomPass)
  composer.addPass(new OutputPass())

  // Background stars
  createBackgroundStars()

  // Event listeners
  renderer.domElement.addEventListener('mousemove', onMouseMove)
  renderer.domElement.addEventListener('click', onClick)
  window.addEventListener('resize', onResize)
}

function createBackgroundStars() {
  const starCount = 500
  const geo = new THREE.BufferGeometry()
  const positions = new Float32Array(starCount * 3)
  const sizes = new Float32Array(starCount)

  for (let i = 0; i < starCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 600
    positions[i * 3 + 1] = (Math.random() - 0.5) * 600
    positions[i * 3 + 2] = (Math.random() - 0.5) * 600
    sizes[i] = Math.random() * 1.5 + 0.3
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

  const mat = new THREE.PointsMaterial({
    color: 0x333344,
    size: 0.5,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  })

  scene.add(new THREE.Points(geo, mat))
}

function createNodes() {
  const count = nodes.value.length
  if (count === 0) return

  nodePositions = new Float32Array(count * 3)
  nodeSizes = new Float32Array(count)
  nodeColors = new Float32Array(count * 3)
  nodeAlphas = new Float32Array(count)

  const geo = new THREE.BufferGeometry()

  for (let i = 0; i < count; i++) {
    const node = nodes.value[i]
    const [r, g, b] = getThemeColor(node)

    // Spread initial positions by theme to avoid all-at-center start
    const themeIdx = themes.value.findIndex(t => t.id === node.themeId)
    const themeAngle = (themeIdx / Math.max(themes.value.length, 1)) * Math.PI * 2
    const spread = 25 + Math.random() * 15
    nodePositions[i * 3] = Math.cos(themeAngle) * spread + (Math.random() - 0.5) * 10
    nodePositions[i * 3 + 1] = Math.sin(themeAngle) * spread + (Math.random() - 0.5) * 10
    nodePositions[i * 3 + 2] = (Math.random() - 0.5) * 15

    nodeSizes[i] = 6 + node.importance * 14
    nodeColors[i * 3] = r
    nodeColors[i * 3 + 1] = g
    nodeColors[i * 3 + 2] = b
    nodeAlphas[i] = 0.5 + node.recency * 0.5
  }

  geo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3))
  geo.setAttribute('size', new THREE.BufferAttribute(nodeSizes, 1).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('alpha', new THREE.BufferAttribute(nodeAlphas, 1).setUsage(THREE.DynamicDrawUsage))

  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader,
    fragmentShader,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    transparent: true,
    vertexColors: true,
  })

  pointCloud = new THREE.Points(geo, mat)
  scene.add(pointCloud)
}

function createEdges() {
  const count = edges.value.length
  if (count === 0) return

  edgePositions = new Float32Array(count * 6)
  edgeColors = new Float32Array(count * 6)

  const geo = new THREE.BufferGeometry()

  for (let i = 0; i < count; i++) {
    const edge = edges.value[i]
    const sourceNode = nodes.value.find(n => n.id === (typeof edge.source === 'string' ? edge.source : (edge.source as any).id))
    const targetNode = nodes.value.find(n => n.id === (typeof edge.target === 'string' ? edge.target : (edge.target as any).id))
    if (!sourceNode || !targetNode) continue

    const si = nodes.value.indexOf(sourceNode)
    const ti = nodes.value.indexOf(targetNode)

    edgePositions[i * 6] = nodePositions[si * 3]
    edgePositions[i * 6 + 1] = nodePositions[si * 3 + 1]
    edgePositions[i * 6 + 2] = nodePositions[si * 3 + 2]
    edgePositions[i * 6 + 3] = nodePositions[ti * 3]
    edgePositions[i * 6 + 4] = nodePositions[ti * 3 + 1]
    edgePositions[i * 6 + 5] = nodePositions[ti * 3 + 2]

    const alpha = edge.similarity * 0.15
    const [sr, sg, sb] = getThemeColor(sourceNode)
    const [tr, tg, tb] = getThemeColor(targetNode)
    edgeColors[i * 6] = sr * alpha
    edgeColors[i * 6 + 1] = sg * alpha
    edgeColors[i * 6 + 2] = sb * alpha
    edgeColors[i * 6 + 3] = tr * alpha
    edgeColors[i * 6 + 4] = tg * alpha
    edgeColors[i * 6 + 5] = tb * alpha
  }

  geo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3).setUsage(THREE.DynamicDrawUsage))
  geo.setAttribute('color', new THREE.BufferAttribute(edgeColors, 3))

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthTest: false,
  })

  edgeLines = new THREE.LineSegments(geo, mat)
  scene.add(edgeLines)
}

function createNebulae() {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.3)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.1)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)

  themes.value.forEach(theme => {
    const themeNodes = nodes.value.filter(n => n.themeId === theme.id)
    if (themeNodes.length < 2) return

    const cx = themeNodes.reduce((s, n) => s + (n.x || 0), 0) / themeNodes.length
    const cy = themeNodes.reduce((s, n) => s + (n.y || 0), 0) / themeNodes.length
    const cz = themeNodes.reduce((s, n) => {
      const idx = nodes.value.indexOf(n)
      return s + (nodePositions?.[idx * 3 + 2] || 0)
    }, 0) / themeNodes.length

    const color = new THREE.Color(theme.color)
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      color,
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthTest: false,
    })

    const sprite = new THREE.Sprite(spriteMat)
    sprite.position.set(cx, cy, cz)
    sprite.scale.set(50, 50, 1)
    scene.add(sprite)
    nebulaSprites.push(sprite)
  })
}

function startForceSimulation() {
  const simNodes = nodes.value.map((n, i) => ({
    ...n,
    x: nodePositions[i * 3],
    y: nodePositions[i * 3 + 1],
    index: i,
  }))

  simulation = d3.forceSimulation(simNodes)
    .force('charge', d3.forceManyBody().strength(-40))
    .force('center', d3.forceCenter(0, 0).strength(0.05))
    .force('link', d3.forceLink(edges.value.map(e => ({
      source: simNodes.findIndex(n => n.id === e.source),
      target: simNodes.findIndex(n => n.id === e.target),
    }))).distance(8).strength(0.2))
    .force('cluster', (alpha: number) => {
      const centroids = new Map<string, { x: number; y: number; count: number }>()
      simNodes.forEach(n => {
        const c = centroids.get(n.themeId) || { x: 0, y: 0, count: 0 }
        c.x += n.x!; c.y += n.y!; c.count++
        centroids.set(n.themeId, c)
      })
      centroids.forEach(c => { c.x /= c.count; c.y /= c.count })
      simNodes.forEach(n => {
        const c = centroids.get(n.themeId)
        if (c) {
          n.vx! += (c.x - n.x!) * 0.15 * alpha
          n.vy! += (c.y - n.y!) * 0.15 * alpha
        }
      })
    })
    .on('tick', () => {
      simNodes.forEach((n, i) => {
        nodePositions[i * 3] = n.x!
        nodePositions[i * 3 + 1] = n.y!
      })
      if (pointCloud) {
        pointCloud.geometry.attributes.position.needsUpdate = true
      }
      updateEdgePositions()
    })
    .alpha(1)
    .alphaDecay(0.05)
}

function updateEdgePositions() {
  if (!edgeLines || !edgePositions) return

  edges.value.forEach((edge, i) => {
    const si = nodes.value.findIndex(n => n.id === (typeof edge.source === 'string' ? edge.source : (edge.source as any).id))
    const ti = nodes.value.findIndex(n => n.id === (typeof edge.target === 'string' ? edge.target : (edge.target as any).id))
    if (si === -1 || ti === -1) return

    edgePositions[i * 6] = nodePositions[si * 3]
    edgePositions[i * 6 + 1] = nodePositions[si * 3 + 1]
    edgePositions[i * 6 + 2] = nodePositions[si * 3 + 2]
    edgePositions[i * 6 + 3] = nodePositions[ti * 3]
    edgePositions[i * 6 + 4] = nodePositions[ti * 3 + 1]
    edgePositions[i * 6 + 5] = nodePositions[ti * 3 + 2]
  })

  edgeLines.geometry.attributes.position.needsUpdate = true
}

function animate() {
  animationId = requestAnimationFrame(animate)

  const time = performance.now() * 0.001

  // Breathing effect - pulse node sizes based on recency
  if (pointCloud && nodeSizes) {
    const sizes = pointCloud.geometry.attributes.size
    for (let i = 0; i < nodes.value.length; i++) {
      const node = nodes.value[i]
      const baseSize = 6 + node.importance * 14
      const pulseSpeed = 0.5 + node.recency * 2 // Recent nodes pulse faster
      const pulseAmount = 0.3 + node.recency * 0.7 // Recent nodes pulse more
      const pulse = 1 + Math.sin(time * pulseSpeed + i * 0.5) * 0.15 * pulseAmount
      ;(sizes.array as Float32Array)[i] = baseSize * pulse
    }
    sizes.needsUpdate = true
  }

  controls.update()
  composer.render()
}

function onMouseMove(event: MouseEvent) {
  if (!containerRef.value || !pointCloud) return
  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObject(pointCloud)

  if (intersects.length > 0) {
    const idx = intersects[0].index!
    hoveredNode.value = nodes.value[idx]
    renderer.domElement.style.cursor = 'pointer'
    controls.autoRotate = false

    // Highlight connected nodes, dim others
    if (nodeAlphas && pointCloud) {
      const connectedIds = new Set<string>()
      connectedIds.add(nodes.value[idx].id)
      edges.value.forEach(e => {
        const s = typeof e.source === 'string' ? e.source : (e.source as any).id
        const t = typeof e.target === 'string' ? e.target : (e.target as any).id
        if (s === nodes.value[idx].id) connectedIds.add(t)
        if (t === nodes.value[idx].id) connectedIds.add(s)
      })

      for (let i = 0; i < nodes.value.length; i++) {
        nodeAlphas[i] = connectedIds.has(nodes.value[i].id)
          ? 0.7 + nodes.value[i].recency * 0.3
          : 0.06
      }
      pointCloud.geometry.attributes.alpha.needsUpdate = true
    }
  } else {
    hoveredNode.value = null
    renderer.domElement.style.cursor = 'default'
    controls.autoRotate = true

    // Restore all alphas
    if (nodeAlphas && pointCloud) {
      for (let i = 0; i < nodes.value.length; i++) {
        nodeAlphas[i] = 0.5 + nodes.value[i].recency * 0.5
      }
      pointCloud.geometry.attributes.alpha.needsUpdate = true
    }
  }
}

function onClick() {
  if (hoveredNode.value) {
    selectedNode.value = hoveredNode.value
    expandedTheme.value = hoveredNode.value.themeId
    sidebarCollapsed.value = false
  }
}

function onResize() {
  if (!containerRef.value) return
  const w = containerRef.value.clientWidth
  const h = containerRef.value.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  composer.setSize(w, h)
}

function focusOnTheme(themeId: string) {
  const themeNodes = nodes.value.filter(n => n.themeId === themeId)
  if (themeNodes.length === 0) return

  const cx = themeNodes.reduce((s, n) => {
    const idx = nodes.value.indexOf(n)
    return s + nodePositions[idx * 3]
  }, 0) / themeNodes.length
  const cy = themeNodes.reduce((s, n) => {
    const idx = nodes.value.indexOf(n)
    return s + nodePositions[idx * 3 + 1]
  }, 0) / themeNodes.length

  // Smooth camera transition
  const target = new THREE.Vector3(cx, cy, 0)
  const startPos = camera.position.clone()
  const endPos = new THREE.Vector3(cx, cy, 40)
  const startTarget = controls.target.clone()
  let t = 0

  function tween() {
    t += 0.02
    if (t > 1) t = 1
    const ease = t * t * (3 - 2 * t) // smoothstep
    camera.position.lerpVectors(startPos, endPos, ease)
    controls.target.lerpVectors(startTarget, target, ease)
    if (t < 1) requestAnimationFrame(tween)
  }
  tween()
}

function resetView() {
  const startPos = camera.position.clone()
  const endPos = new THREE.Vector3(0, 0, 120)
  const startTarget = controls.target.clone()
  const endTarget = new THREE.Vector3(0, 0, 0)
  let t = 0

  function tween() {
    t += 0.02
    if (t > 1) t = 1
    const ease = t * t * (3 - 2 * t)
    camera.position.lerpVectors(startPos, endPos, ease)
    controls.target.lerpVectors(startTarget, endTarget, ease)
    if (t < 1) requestAnimationFrame(tween)
  }
  tween()
}

onMounted(async () => {
  isLoading.value = true
  loadError.value = null

  try {
    const apiData = await graphApi.get()

    if (apiData.themes && apiData.themes.length > 0) {
      themes.value = apiData.themes
      nodes.value = apiData.nodes || []
      edges.value = apiData.edges || []
    } else {
      loadError.value = 'No graph data available'
      isLoading.value = false
      return
    }
  } catch (e) {
    console.warn('Failed to load graph from API:', e)
    loadError.value = 'Failed to load graph data'
    isLoading.value = false
    return
  }

  initScene()
  createNodes()
  createEdges()
  createNebulae()
  startForceSimulation()
  animate()

  isLoading.value = false
})

onUnmounted(() => {
  if (animationId) cancelAnimationFrame(animationId)
  simulation?.stop()
  renderer?.domElement?.removeEventListener('mousemove', onMouseMove)
  renderer?.domElement?.removeEventListener('click', onClick)
  window.removeEventListener('resize', onResize)
  renderer?.dispose()
  composer?.dispose()
})
</script>

<template>
  <div class="h-screen flex relative">
    <!-- Theme Sidebar -->
    <aside :class="[
      'border-r border-border-secondary overflow-auto bg-bg-elevated flex-shrink-0 transition-all duration-300',
      sidebarCollapsed ? 'w-14' : 'w-72'
    ]">
      <div v-if="sidebarCollapsed" class="p-3">
        <button
          @click="sidebarCollapsed = false"
          class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors mb-4"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
        <div class="space-y-3">
          <div
            v-for="theme in themes"
            :key="theme.id"
            class="w-4 h-4 mx-auto rounded-full cursor-pointer hover:scale-150 transition-transform"
            :style="{ backgroundColor: theme.color }"
            :title="`${theme.label} (${theme.count})`"
            @click="sidebarCollapsed = false; expandedTheme = theme.id; focusOnTheme(theme.id)"
          />
        </div>
      </div>

      <div v-else>
        <div class="p-4 border-b border-border-secondary flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-text-primary">Knowledge Nebula</h2>
            <p class="text-xs text-text-tertiary mt-1">{{ themes.length }} clusters &middot; {{ nodes.length }} thoughts</p>
          </div>
          <button @click="sidebarCollapsed = true" class="w-8 h-8 flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        <div class="divide-y divide-border-secondary">
          <div v-for="theme in themes" :key="theme.id" class="group">
            <button @click="expandedTheme = expandedTheme === theme.id ? null : theme.id; focusOnTheme(theme.id)" class="w-full p-4 text-left hover:bg-bg-tertiary transition-colors">
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
                <div
                  v-for="thought in theme.sampleThoughts"
                  :key="thought.id"
                  class="text-xs p-2 bg-bg-elevated rounded-lg text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
                >
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
    <div ref="containerRef" class="flex-1 relative">
      <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-bg-primary/80 z-10">
        <div class="text-text-secondary text-sm">Loading knowledge nebula...</div>
      </div>

      <div v-if="loadError && !isLoading" class="absolute inset-0 flex items-center justify-center z-10">
        <div class="text-text-tertiary text-sm">{{ loadError }}</div>
      </div>

      <!-- Hover tooltip -->
      <div
        v-if="hoveredNode"
        class="absolute pointer-events-none bg-bg-elevated/90 backdrop-blur-sm border border-border-secondary rounded-lg px-3 py-2 text-sm shadow-lg z-20 max-w-xs"
        style="left: 50%; top: 16px; transform: translateX(-50%)"
      >
        <p class="text-text-primary font-medium">{{ hoveredNode.label }}</p>
        <p class="text-xs text-text-tertiary mt-1">{{ themes.find(t => t.id === hoveredNode?.themeId)?.label }}</p>
      </div>

      <!-- Controls -->
      <div class="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
        <button
          @click="resetView"
          class="w-10 h-10 bg-bg-elevated/80 border border-border-secondary rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors shadow-sm backdrop-blur-sm"
          title="Reset view"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
        </button>
      </div>

      <!-- Legend -->
      <div class="absolute bottom-4 left-4 text-xs text-text-tertiary space-y-1 bg-bg-elevated/60 backdrop-blur-sm rounded-lg p-3 border border-border-secondary z-10">
        <p>Orbit to explore</p>
        <p>Hover to trace connections</p>
        <p>Click to select</p>
      </div>
    </div>
  </div>
</template>
