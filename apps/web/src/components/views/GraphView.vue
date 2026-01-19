<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const containerRef = ref<HTMLDivElement | null>(null)
const selectedNode = ref<{ id: string; label: string; cluster: string } | null>(null)
const hoveredNode = ref<{ id: string; label: string; x: number; y: number } | null>(null)
const sidebarOpen = ref(false)

// Cluster colors
const clusterColors: Record<string, number> = {
  technology: 0x8b5cf6,
  work: 0x3b82f6,
  personal: 0x22c55e,
  learning: 0xf97316,
  other: 0x6b7280,
}

const clusters = [
  { id: 'technology', name: 'Technology', color: '#8B5CF6', count: 0 },
  { id: 'work', name: 'Work', color: '#3B82F6', count: 0 },
  { id: 'personal', name: 'Personal', color: '#22C55E', count: 0 },
  { id: 'learning', name: 'Learning', color: '#F97316', count: 0 },
]

interface GraphNode {
  id: string
  label: string
  cluster: string
  position: THREE.Vector3
  mesh?: THREE.Mesh
}

interface GraphEdge {
  source: string
  target: string
  weight: number
}

let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let controls: OrbitControls
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2
let animationId: number
let nodes: GraphNode[] = []
let nodeMeshes: THREE.Mesh[] = []
let edgeLines: THREE.LineSegments

// Generate mock graph data
const generateGraphData = () => {
  const clusterKeys = Object.keys(clusterColors)
  nodes = []

  for (let i = 0; i < 40; i++) {
    const cluster = clusterKeys[Math.floor(Math.random() * clusterKeys.length)]
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const radius = 3 + Math.random() * 2

    nodes.push({
      id: `node-${i}`,
      label: `Thought ${i + 1}`,
      cluster,
      position: new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      ),
    })
  }

  // Update cluster counts
  clusters.forEach((c) => {
    c.count = nodes.filter((n) => n.cluster === c.id).length
  })

  // Generate edges between nearby nodes
  const edges: GraphEdge[] = []
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = nodes[i].position.distanceTo(nodes[j].position)
      if (dist < 3) {
        edges.push({
          source: nodes[i].id,
          target: nodes[j].id,
          weight: 1 - dist / 3,
        })
      }
    }
  }

  return { nodes, edges }
}

const initScene = () => {
  if (!containerRef.value) return

  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  const isDark = document.documentElement.classList.contains('dark')

  // Scene
  scene = new THREE.Scene()
  scene.background = new THREE.Color(isDark ? 0x0a0a0a : 0xfafafa)

  // Camera
  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 100)
  camera.position.set(0, 0, 10)

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(width, height)
  renderer.setPixelRatio(window.devicePixelRatio)
  containerRef.value.appendChild(renderer.domElement)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  controls.minDistance = 5
  controls.maxDistance = 20

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)
  const pointLight = new THREE.PointLight(0xffffff, 0.8)
  pointLight.position.set(10, 10, 10)
  scene.add(pointLight)

  // Raycaster for hover/click
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // Generate and render graph
  const { nodes: graphNodes, edges } = generateGraphData()

  // Create node meshes
  const nodeGeometry = new THREE.SphereGeometry(0.15, 16, 16)
  graphNodes.forEach((node) => {
    const material = new THREE.MeshStandardMaterial({
      color: clusterColors[node.cluster] || 0x6b7280,
      roughness: 0.4,
      metalness: 0.3,
    })
    const mesh = new THREE.Mesh(nodeGeometry, material)
    mesh.position.copy(node.position)
    mesh.userData = { id: node.id, label: node.label, cluster: node.cluster }
    scene.add(mesh)
    nodeMeshes.push(mesh)
    node.mesh = mesh
  })

  // Create edges
  const edgeGeometry = new THREE.BufferGeometry()
  const positions: number[] = []
  edges.forEach((edge) => {
    const sourceNode = graphNodes.find((n) => n.id === edge.source)
    const targetNode = graphNodes.find((n) => n.id === edge.target)
    if (sourceNode && targetNode) {
      positions.push(
        sourceNode.position.x, sourceNode.position.y, sourceNode.position.z,
        targetNode.position.x, targetNode.position.y, targetNode.position.z
      )
    }
  })
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: isDark ? 0x333333 : 0xcccccc,
    transparent: true,
    opacity: 0.3,
  })
  edgeLines = new THREE.LineSegments(edgeGeometry, edgeMaterial)
  scene.add(edgeLines)
}

const onMouseMove = (event: MouseEvent) => {
  if (!containerRef.value) return

  const rect = containerRef.value.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(mouse, camera)
  const intersects = raycaster.intersectObjects(nodeMeshes)

  if (intersects.length > 0) {
    const obj = intersects[0].object
    hoveredNode.value = {
      id: obj.userData.id,
      label: obj.userData.label,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    containerRef.value.style.cursor = 'pointer'
  } else {
    hoveredNode.value = null
    containerRef.value.style.cursor = 'grab'
  }
}

const onClick = () => {
  if (hoveredNode.value) {
    const node = nodes.find((n) => n.id === hoveredNode.value?.id)
    if (node) {
      selectedNode.value = { id: node.id, label: node.label, cluster: node.cluster }
    }
  }
}

const animate = () => {
  animationId = requestAnimationFrame(animate)
  controls.update()
  renderer.render(scene, camera)
}

const onResize = () => {
  if (!containerRef.value) return
  const width = containerRef.value.clientWidth
  const height = containerRef.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

// Watch for theme changes
watch(() => document.documentElement.classList.contains('dark'), (isDark) => {
  if (scene) {
    scene.background = new THREE.Color(isDark ? 0x0a0a0a : 0xfafafa)
    if (edgeLines) {
      (edgeLines.material as THREE.LineBasicMaterial).color.set(isDark ? 0x333333 : 0xcccccc)
    }
  }
})

onMounted(() => {
  initScene()
  animate()
  window.addEventListener('resize', onResize)
  containerRef.value?.addEventListener('mousemove', onMouseMove)
  containerRef.value?.addEventListener('click', onClick)
})

onUnmounted(() => {
  cancelAnimationFrame(animationId)
  window.removeEventListener('resize', onResize)
  containerRef.value?.removeEventListener('mousemove', onMouseMove)
  containerRef.value?.removeEventListener('click', onClick)
  renderer?.dispose()
})
</script>

<template>
  <div class="h-[calc(100vh-5rem)] flex relative">
    <!-- 3D Canvas -->
    <div ref="containerRef" class="flex-1 relative">
      <!-- Hover tooltip -->
      <div
        v-if="hoveredNode"
        class="absolute pointer-events-none bg-bg-elevated/95 backdrop-blur-sm border border-border-secondary rounded-lg px-3 py-2 text-sm shadow-lg z-10"
        :style="{ left: hoveredNode.x + 12 + 'px', top: hoveredNode.y - 12 + 'px' }"
      >
        {{ hoveredNode.label }}
      </div>
    </div>

    <!-- Mobile sidebar toggle -->
    <button
      @click="sidebarOpen = !sidebarOpen"
      class="lg:hidden fixed top-20 right-4 z-30 w-10 h-10 bg-bg-elevated border border-border-secondary rounded-lg flex items-center justify-center text-text-secondary"
    >
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>

    <!-- Legend Panel -->
    <div
      :class="[
        'w-56 bg-bg-elevated border-l border-border-secondary p-4 overflow-auto transition-transform duration-200',
        'fixed lg:relative right-0 top-0 h-full z-20',
        sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
      ]"
    >
      <h3 class="text-sm font-medium text-text-primary mb-4">Clusters</h3>

      <div class="space-y-2">
        <button
          v-for="cluster in clusters"
          :key="cluster.id"
          class="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary transition-colors text-left"
        >
          <div class="w-2.5 h-2.5 rounded-full" :style="{ backgroundColor: cluster.color }" />
          <span class="flex-1 text-sm text-text-primary">{{ cluster.name }}</span>
          <span class="text-xs text-text-tertiary">{{ cluster.count }}</span>
        </button>
      </div>

      <!-- Selected node -->
      <div v-if="selectedNode" class="mt-6 pt-4 border-t border-border-secondary">
        <h4 class="text-xs text-text-tertiary uppercase tracking-wider mb-2">Selected</h4>
        <div class="p-3 bg-bg-tertiary rounded-lg">
          <p class="text-sm text-text-primary font-medium">{{ selectedNode.label }}</p>
          <p class="text-xs text-text-tertiary mt-1 capitalize">{{ selectedNode.cluster }}</p>
        </div>
      </div>

      <!-- Controls hint -->
      <div class="mt-6 pt-4 border-t border-border-secondary text-xs text-text-tertiary space-y-1">
        <p>Drag to rotate</p>
        <p>Scroll to zoom</p>
        <p>Click node to select</p>
      </div>
    </div>
  </div>
</template>
