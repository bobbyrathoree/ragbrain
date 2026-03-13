/**
 * Pure Three.js renderer for the knowledge graph.
 * No Vue dependency — receives data, manages the WebGL scene,
 * and emits events via callbacks.
 *
 * Extracted from the 692-line GraphView.vue monolith.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { GraphNode, GraphEdge, GraphTheme } from '@/types'

// ── Shaders ─────────────────────────────────────────────────────

const VERTEX_SHADER = `
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

const FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    float core = 1.0 - smoothstep(0.0, 0.15, dist);
    vec3 color = vColor * glow + vec3(1.0) * core * 0.3;
    gl_FragColor = vec4(color, vAlpha * glow);
  }
`

// ── Types ───────────────────────────────────────────────────────

export interface GraphRendererCallbacks {
  onNodeHover: (node: GraphNode | null) => void
  onNodeClick: (node: GraphNode) => void
}

// ── Renderer Class ──────────────────────────────────────────────

export class GraphRenderer {
  private renderer!: THREE.WebGLRenderer
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private controls!: OrbitControls
  private composer!: EffectComposer
  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private animationId = 0

  private pointCloud: THREE.Points | null = null
  private edgeLines: THREE.LineSegments | null = null
  private nebulaSprites: THREE.Sprite[] = []

  // Buffer arrays — updated by physics simulation
  nodePositions: Float32Array = new Float32Array(0)
  private nodeSizes: Float32Array = new Float32Array(0)
  private nodeColors: Float32Array = new Float32Array(0)
  private nodeAlphas: Float32Array = new Float32Array(0)
  private edgePositions: Float32Array = new Float32Array(0)

  private nodes: GraphNode[] = []
  private edges: GraphEdge[] = []
  private themes: GraphTheme[] = []
  private callbacks: GraphRendererCallbacks

  constructor(callbacks: GraphRendererCallbacks) {
    this.callbacks = callbacks
    this.raycaster.params.Points = { threshold: 1.5 }
  }

  // ── Lifecycle ───────────────────────────────────────────────

  init(container: HTMLDivElement) {
    const w = container.clientWidth
    const h = container.clientHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x050508)

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000)
    this.camera.position.set(0, 0, 240)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.05
    this.controls.minDistance = 20
    this.controls.maxDistance = 500
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.3

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.8, 0.8, 0.1))
    this.composer.addPass(new OutputPass())

    this.createStars()

    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove)
    this.renderer.domElement.addEventListener('click', this.onClick)
    window.addEventListener('resize', () => this.resize(container))
  }

  dispose() {
    cancelAnimationFrame(this.animationId)
    this.renderer?.domElement?.removeEventListener('mousemove', this.onMouseMove)
    this.renderer?.domElement?.removeEventListener('click', this.onClick)
    this.renderer?.dispose()
    this.composer?.dispose()
  }

  // ── Data Loading ────────────────────────────────────────────

  setData(nodes: GraphNode[], edges: GraphEdge[], themes: GraphTheme[]) {
    this.nodes = nodes
    this.edges = edges
    this.themes = themes
    this.buildNodes()
    this.buildEdges()
    this.buildNebulae()
    this.startAnimationLoop()
  }

  // ── Position Updates (called by physics engine) ─────────────

  updateNodePositions() {
    if (this.pointCloud) {
      this.pointCloud.geometry.attributes.position.needsUpdate = true
    }
    this.syncEdgePositions()
  }

  // ── Camera Transitions ──────────────────────────────────────

  focusOnTheme(themeId: string) {
    const themeNodes = this.nodes.filter(n => n.themeId === themeId)
    if (!themeNodes.length) return

    const cx = themeNodes.reduce((s, n) => s + this.nodePositions[this.nodes.indexOf(n) * 3], 0) / themeNodes.length
    const cy = themeNodes.reduce((s, n) => s + this.nodePositions[this.nodes.indexOf(n) * 3 + 1], 0) / themeNodes.length

    this.tweenCamera(new THREE.Vector3(cx, cy, 40), new THREE.Vector3(cx, cy, 0))
  }

  resetView() {
    this.tweenCamera(new THREE.Vector3(0, 0, 240), new THREE.Vector3(0, 0, 0))
  }

  // ── Private: Scene Building ─────────────────────────────────

  private createStars() {
    const count = 500
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const sizes = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 600
      pos[i * 3 + 1] = (Math.random() - 0.5) * 600
      pos[i * 3 + 2] = (Math.random() - 0.5) * 600
      sizes[i] = Math.random() * 1.5 + 0.3
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1))

    this.scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x333344, size: 0.5, transparent: true, opacity: 0.6, sizeAttenuation: true,
    })))
  }

  private buildNodes() {
    const count = this.nodes.length
    if (!count) return

    this.nodePositions = new Float32Array(count * 3)
    this.nodeSizes = new Float32Array(count)
    this.nodeColors = new Float32Array(count * 3)
    this.nodeAlphas = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      const node = this.nodes[i]
      const [r, g, b] = this.themeColor(node)

      // Spread initial positions by theme
      const tIdx = this.themes.findIndex(t => t.id === node.themeId)
      const angle = (tIdx / Math.max(this.themes.length, 1)) * Math.PI * 2
      const spread = 25 + Math.random() * 15
      this.nodePositions[i * 3] = Math.cos(angle) * spread + (Math.random() - 0.5) * 10
      this.nodePositions[i * 3 + 1] = Math.sin(angle) * spread + (Math.random() - 0.5) * 10
      this.nodePositions[i * 3 + 2] = (Math.random() - 0.5) * 15

      this.nodeSizes[i] = 6 + node.importance * 14
      this.nodeColors[i * 3] = r
      this.nodeColors[i * 3 + 1] = g
      this.nodeColors[i * 3 + 2] = b
      this.nodeAlphas[i] = 0.5 + node.recency * 0.5
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.nodePositions, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(this.nodeSizes, 1).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(this.nodeColors, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.nodeAlphas, 1).setUsage(THREE.DynamicDrawUsage))

    this.pointCloud = new THREE.Points(geo, new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      transparent: true,
      vertexColors: true,
    }))
    this.scene.add(this.pointCloud)
  }

  private buildEdges() {
    const count = this.edges.length
    if (!count) return

    this.edgePositions = new Float32Array(count * 6)
    const colors = new Float32Array(count * 6)

    for (let i = 0; i < count; i++) {
      const edge = this.edges[i]
      const si = this.nodeIndex(edge.source)
      const ti = this.nodeIndex(edge.target)
      if (si === -1 || ti === -1) continue

      this.copyEdgePosition(i, si, ti)

      const alpha = edge.similarity * 0.15
      const [sr, sg, sb] = this.themeColor(this.nodes[si])
      const [tr, tg, tb] = this.themeColor(this.nodes[ti])
      colors[i * 6] = sr * alpha; colors[i * 6 + 1] = sg * alpha; colors[i * 6 + 2] = sb * alpha
      colors[i * 6 + 3] = tr * alpha; colors[i * 6 + 4] = tg * alpha; colors[i * 6 + 5] = tb * alpha
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3).setUsage(THREE.DynamicDrawUsage))
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    this.edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthTest: false,
    }))
    this.scene.add(this.edgeLines)
  }

  private buildNebulae() {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.3)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.1)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    const texture = new THREE.CanvasTexture(canvas)

    for (const theme of this.themes) {
      const tn = this.nodes.filter(n => n.themeId === theme.id)
      if (tn.length < 2) continue

      const cx = tn.reduce((s, n) => s + (n.x || 0), 0) / tn.length
      const cy = tn.reduce((s, n) => s + (n.y || 0), 0) / tn.length
      const cz = tn.reduce((s, n) => s + (this.nodePositions[this.nodes.indexOf(n) * 3 + 2] || 0), 0) / tn.length

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, color: new THREE.Color(theme.color),
        transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthTest: false,
      }))
      sprite.position.set(cx, cy, cz)
      sprite.scale.set(50, 50, 1)
      this.scene.add(sprite)
      this.nebulaSprites.push(sprite)
    }
  }

  // ── Private: Animation ──────────────────────────────────────

  private startAnimationLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)
      const time = performance.now() * 0.001

      // Breathing pulse
      if (this.pointCloud && this.nodeSizes) {
        const sizes = this.pointCloud.geometry.attributes.size
        for (let i = 0; i < this.nodes.length; i++) {
          const node = this.nodes[i]
          const base = 6 + node.importance * 14
          const speed = 0.5 + node.recency * 2
          const amount = 0.3 + node.recency * 0.7
          ;(sizes.array as Float32Array)[i] = base * (1 + Math.sin(time * speed + i * 0.5) * 0.15 * amount)
        }
        sizes.needsUpdate = true
      }

      this.controls.update()
      this.composer.render()
    }
    animate()
  }

  // ── Private: Interaction ────────────────────────────────────

  private onMouseMove = (event: MouseEvent) => {
    if (!this.pointCloud) return
    const container = this.renderer.domElement.parentElement!
    const rect = container.getBoundingClientRect()
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

    this.raycaster.setFromCamera(this.mouse, this.camera)
    const intersects = this.raycaster.intersectObject(this.pointCloud)

    if (intersects.length > 0) {
      const idx = intersects[0].index!
      this.callbacks.onNodeHover(this.nodes[idx])
      this.renderer.domElement.style.cursor = 'pointer'
      this.controls.autoRotate = false
      this.highlightConnected(idx)
    } else {
      this.callbacks.onNodeHover(null)
      this.renderer.domElement.style.cursor = 'default'
      this.controls.autoRotate = true
      this.restoreAlphas()
    }
  }

  private onClick = () => {
    // Hover state is managed by onMouseMove — click just promotes it
    // GraphView reads hoveredNode and handles click logic
  }

  private highlightConnected(idx: number) {
    if (!this.nodeAlphas || !this.pointCloud) return

    const connected = new Set<string>([this.nodes[idx].id])
    for (const e of this.edges) {
      const s = typeof e.source === 'string' ? e.source : (e.source as any).id
      const t = typeof e.target === 'string' ? e.target : (e.target as any).id
      if (s === this.nodes[idx].id) connected.add(t)
      if (t === this.nodes[idx].id) connected.add(s)
    }

    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeAlphas[i] = connected.has(this.nodes[i].id) ? 0.7 + this.nodes[i].recency * 0.3 : 0.06
    }
    this.pointCloud.geometry.attributes.alpha.needsUpdate = true
  }

  private restoreAlphas() {
    if (!this.nodeAlphas || !this.pointCloud) return
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeAlphas[i] = 0.5 + this.nodes[i].recency * 0.5
    }
    this.pointCloud.geometry.attributes.alpha.needsUpdate = true
  }

  // ── Private: Helpers ────────────────────────────────────────

  private themeColor(node: GraphNode): [number, number, number] {
    const theme = this.themes.find(t => t.id === node.themeId)
    if (!theme) return [0.5, 0.5, 0.5]
    const c = new THREE.Color(theme.color)
    return [c.r, c.g, c.b]
  }

  private nodeIndex(ref: string | any): number {
    const id = typeof ref === 'string' ? ref : ref.id
    return this.nodes.findIndex(n => n.id === id)
  }

  private copyEdgePosition(edgeIdx: number, sourceIdx: number, targetIdx: number) {
    const ep = this.edgePositions
    const np = this.nodePositions
    ep[edgeIdx * 6] = np[sourceIdx * 3]
    ep[edgeIdx * 6 + 1] = np[sourceIdx * 3 + 1]
    ep[edgeIdx * 6 + 2] = np[sourceIdx * 3 + 2]
    ep[edgeIdx * 6 + 3] = np[targetIdx * 3]
    ep[edgeIdx * 6 + 4] = np[targetIdx * 3 + 1]
    ep[edgeIdx * 6 + 5] = np[targetIdx * 3 + 2]
  }

  private syncEdgePositions() {
    if (!this.edgeLines || !this.edgePositions) return
    for (let i = 0; i < this.edges.length; i++) {
      const si = this.nodeIndex(this.edges[i].source)
      const ti = this.nodeIndex(this.edges[i].target)
      if (si !== -1 && ti !== -1) this.copyEdgePosition(i, si, ti)
    }
    this.edgeLines.geometry.attributes.position.needsUpdate = true
  }

  private tweenCamera(endPos: THREE.Vector3, endTarget: THREE.Vector3) {
    const startPos = this.camera.position.clone()
    const startTarget = this.controls.target.clone()
    let t = 0

    const step = () => {
      t = Math.min(t + 0.02, 1)
      const ease = t * t * (3 - 2 * t)
      this.camera.position.lerpVectors(startPos, endPos, ease)
      this.controls.target.lerpVectors(startTarget, endTarget, ease)
      if (t < 1) requestAnimationFrame(step)
    }
    step()
  }

  private resize(container: HTMLDivElement) {
    const w = container.clientWidth
    const h = container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }
}
