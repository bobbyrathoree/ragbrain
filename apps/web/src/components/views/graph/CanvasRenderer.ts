/**
 * Canvas 2D renderer for the knowledge galaxy.
 * Handles two modes: Galaxy (theme bubbles + affinities) and Constellation (thought nodes + edges).
 * No Vue dependency — pure rendering class.
 */
import * as d3 from 'd3'
import type { GalaxyTheme, ThemeAffinity, ConstellationNode, ConstellationEdge } from '@/types'

// ── Types ───────────────────────────────────────────────────────

interface Viewport {
  width: number
  height: number
  dpr: number
}

export interface GalaxyBubble extends GalaxyTheme {
  x: number
  y: number
  radius: number
  // D3 simulation
  vx?: number
  vy?: number
}

export interface ConstellationNodePos extends ConstellationNode {
  x: number
  y: number
  width: number
  height: number
  vx?: number
  vy?: number
}

export interface HitResult {
  type: 'bubble' | 'node'
  id: string
  data: GalaxyBubble | ConstellationNodePos
}

// ── Color Helpers ───────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  thought: '#a8a29e',
  decision: '#a78bfa',
  insight: '#38bdf8',
  code: '#34d399',
  todo: '#fbbf24',
  link: '#fb7185',
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function blendColors(c1: string, c2: string, alpha: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16)
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16)
  const r = Math.round((r1 + r2) / 2), g = Math.round((g1 + g2) / 2), b = Math.round((b1 + b2) / 2)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── Renderer Class ──────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private viewport: Viewport = { width: 0, height: 0, dpr: 1 }
  private animationId = 0
  private time = 0

  // Galaxy state
  private bubbles: GalaxyBubble[] = []
  private affinities: ThemeAffinity[] = []
  private galaxySim: d3.Simulation<GalaxyBubble, undefined> | null = null

  // Constellation state
  private nodes: ConstellationNodePos[] = []
  private edges: ConstellationEdge[] = []
  private constellationSim: d3.Simulation<ConstellationNodePos, undefined> | null = null
  private constellationColor = '#888888'

  // Interaction
  private hoveredId: string | null = null
  private mouseX = 0
  private mouseY = 0

  // Transition
  private transitionProgress = 0 // 0 = galaxy, 1 = constellation
  private transitionTarget = 0
  // @ts-ignore used in future transition refinement
  private _transitionBubbleId: string | null = null

  // Callbacks
  onHover: ((hit: HitResult | null) => void) | null = null
  onClick: ((hit: HitResult | null) => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!

    canvas.addEventListener('mousemove', this.handleMouseMove)
    canvas.addEventListener('click', this.handleClick)
  }

  dispose() {
    cancelAnimationFrame(this.animationId)
    this.galaxySim?.stop()
    this.constellationSim?.stop()
    this.canvas.removeEventListener('mousemove', this.handleMouseMove)
    this.canvas.removeEventListener('click', this.handleClick)
  }

  resize(width: number, height: number) {
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.viewport = { width, height, dpr }
    this.canvas.width = width * dpr
    this.canvas.height = height * dpr
    this.canvas.style.width = `${width}px`
    this.canvas.style.height = `${height}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  // ── Galaxy Mode ─────────────────────────────────────────────

  setGalaxyData(themes: GalaxyTheme[], affinities: ThemeAffinity[]) {
    this.affinities = affinities
    const cx = this.viewport.width / 2
    const cy = this.viewport.height / 2

    // Create bubbles with radius proportional to sqrt(count)
    const maxCount = Math.max(...themes.map(t => t.count), 1)
    const minRadius = 40
    const maxRadius = Math.min(this.viewport.width, this.viewport.height) * 0.15

    this.bubbles = themes.map((t, i) => {
      const radius = minRadius + (Math.sqrt(t.count / maxCount)) * (maxRadius - minRadius)
      const angle = (i / themes.length) * Math.PI * 2
      const spread = Math.min(this.viewport.width, this.viewport.height) * 0.2
      return {
        ...t,
        x: cx + Math.cos(angle) * spread,
        y: cy + Math.sin(angle) * spread,
        radius,
      }
    })

    // D3 force simulation for bubble positioning
    this.galaxySim?.stop()
    this.galaxySim = d3.forceSimulation(this.bubbles)
      .force('center', d3.forceCenter(cx, cy).strength(0.05))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('collide', d3.forceCollide<GalaxyBubble>().radius(d => d.radius + 20).strength(0.8))
      .alphaDecay(0.08)
      .on('tick', () => {})

    this.transitionProgress = 0
    this.transitionTarget = 0
    this.startAnimation()
  }

  // ── Constellation Mode ──────────────────────────────────────

  setConstellationData(thoughts: ConstellationNode[], edges: ConstellationEdge[], color: string) {
    this.edges = edges
    this.constellationColor = color
    const cx = this.viewport.width / 2
    const cy = this.viewport.height / 2

    // Create positioned nodes
    this.nodes = thoughts.map(t => ({
      ...t,
      x: cx + (Math.random() - 0.5) * 100,
      y: cy + (Math.random() - 0.5) * 100,
      width: Math.min(180, Math.max(120, t.text.length * 3.5)),
      height: 38,
    }))

    // Build D3 links
    const nodeMap = new Map(this.nodes.map((n, i) => [n.id, i]))
    const links = edges
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)!, similarity: e.similarity }))
      .filter(l => l.source !== undefined && l.target !== undefined)

    this.constellationSim?.stop()
    this.constellationSim = d3.forceSimulation(this.nodes)
      .force('center', d3.forceCenter(cx, cy).strength(0.03))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('link', d3.forceLink(links).distance(80).strength(0.3))
      .force('collide', d3.forceCollide<ConstellationNodePos>().radius(d => d.width / 2 + 10).strength(0.7))
      .alphaDecay(0.04)
      .on('tick', () => {})
  }

  // ── Transitions ─────────────────────────────────────────────

  transitionToConstellation(bubbleId: string) {
    this._transitionBubbleId = bubbleId
    this.transitionTarget = 1
    this.galaxySim?.stop()
  }

  transitionToGalaxy() {
    this.transitionTarget = 0
    this.constellationSim?.stop()
    // Restart galaxy sim gently
    if (this.galaxySim) {
      this.galaxySim.alpha(0.3).restart()
    }
  }

  // ── Animation Loop ──────────────────────────────────────────

  private startAnimation() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)
      this.time = performance.now() * 0.001
      this.update()
      this.draw()
    }
    animate()
  }

  private update() {
    // Smooth transition
    const speed = 0.04
    if (this.transitionProgress < this.transitionTarget) {
      this.transitionProgress = Math.min(this.transitionProgress + speed, 1)
    } else if (this.transitionProgress > this.transitionTarget) {
      this.transitionProgress = Math.max(this.transitionProgress - speed, 0)
    }
  }

  private draw() {
    const { ctx, viewport } = this
    const { width, height } = viewport

    // Clear
    ctx.fillStyle = '#0a0a0f'
    ctx.fillRect(0, 0, width, height)

    if (this.transitionProgress < 0.5) {
      this.drawGalaxy(1 - this.transitionProgress * 2)
    }
    if (this.transitionProgress > 0.3) {
      const alpha = Math.min(1, (this.transitionProgress - 0.3) / 0.7)
      this.drawConstellation(alpha)
    }
  }

  // ── Galaxy Drawing ──────────────────────────────────────────

  private drawGalaxy(opacity: number) {
    const { ctx } = this

    ctx.globalAlpha = opacity

    // Draw affinity rivers first (behind bubbles)
    for (const aff of this.affinities) {
      const src = this.bubbles.find(b => b.id === aff.source)
      const tgt = this.bubbles.find(b => b.id === aff.target)
      if (!src || !tgt) continue

      const lineWidth = Math.max(1, Math.min(8, aff.volume * 0.5))
      const lineAlpha = Math.max(0.05, Math.min(0.3, aff.strength * 0.5))

      ctx.beginPath()
      // Quadratic bezier curve
      const mx = (src.x + tgt.x) / 2
      const my = (src.y + tgt.y) / 2 - 30
      ctx.moveTo(src.x, src.y)
      ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y)
      ctx.strokeStyle = blendColors(src.color, tgt.color, lineAlpha)
      ctx.lineWidth = lineWidth
      ctx.stroke()
    }

    // Draw bubbles — batch by color for perf
    for (const bubble of this.bubbles) {
      const isHovered = this.hoveredId === bubble.id
      const breathe = 1 + Math.sin(this.time * 0.8 + this.bubbles.indexOf(bubble) * 1.5) * 0.02
      const r = bubble.radius * breathe * (isHovered ? 1.08 : 1)

      // Glow
      ctx.beginPath()
      ctx.arc(bubble.x, bubble.y, r + 8, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, 0.06)
      ctx.fill()

      // Main circle
      ctx.beginPath()
      ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, isHovered ? 0.25 : 0.15)
      ctx.fill()
      ctx.strokeStyle = hexToRgba(bubble.color, isHovered ? 0.6 : 0.35)
      ctx.lineWidth = isHovered ? 2 : 1
      ctx.stroke()

      // Count text (large, centered)
      ctx.fillStyle = hexToRgba(bubble.color, 0.9)
      ctx.font = `bold ${Math.max(16, r * 0.4)}px system-ui, -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(bubble.count), bubble.x, bubble.y)

      // Label below bubble
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.font = '13px system-ui, -apple-system, sans-serif'
      ctx.textBaseline = 'top'
      ctx.fillText(bubble.label, bubble.x, bubble.y + r + 12)

      // Recent count badge
      if (bubble.recentCount > 0) {
        const badgeText = `+${bubble.recentCount} this week`
        ctx.fillStyle = hexToRgba(bubble.color, 0.6)
        ctx.font = '10px system-ui, -apple-system, sans-serif'
        ctx.fillText(badgeText, bubble.x, bubble.y + r + 28)
      }
    }

    ctx.globalAlpha = 1
  }

  // ── Constellation Drawing ───────────────────────────────────

  private drawConstellation(opacity: number) {
    const { ctx } = this

    // Faint theme-colored background tint
    ctx.fillStyle = hexToRgba(this.constellationColor, 0.03 * opacity)
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height)

    ctx.globalAlpha = opacity

    // Draw edges first
    const connectedToHovered = new Set<string>()
    if (this.hoveredId) {
      for (const e of this.edges) {
        if (e.source === this.hoveredId) connectedToHovered.add(e.target)
        if (e.target === this.hoveredId) connectedToHovered.add(e.source)
      }
      connectedToHovered.add(this.hoveredId)
    }

    for (const edge of this.edges) {
      const src = this.nodes.find(n => n.id === edge.source)
      const tgt = this.nodes.find(n => n.id === edge.target)
      if (!src || !tgt) continue

      const isConnected = !this.hoveredId || connectedToHovered.has(edge.source) && connectedToHovered.has(edge.target)
      const edgeAlpha = isConnected ? Math.max(0.15, edge.similarity * 0.4) : 0.03
      const edgeWidth = isConnected ? Math.max(0.5, edge.similarity * 2) : 0.5

      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = `rgba(255,255,255,${edgeAlpha})`
      ctx.lineWidth = edgeWidth
      ctx.stroke()
    }

    // Draw nodes — batch by type color
    for (const node of this.nodes) {
      const isHovered = this.hoveredId === node.id
      const isConnected = !this.hoveredId || connectedToHovered.has(node.id)
      const nodeAlpha = isConnected ? 1 : 0.2
      const typeColor = TYPE_COLORS[node.type] || '#a8a29e'

      const x = node.x - node.width / 2
      const y = node.y - node.height / 2
      const w = node.width
      const h = node.height
      const r = 6

      ctx.globalAlpha = opacity * nodeAlpha

      // Node background
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, r)
      ctx.fillStyle = isHovered ? '#1e1e24' : '#141418'
      ctx.fill()
      ctx.strokeStyle = isHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)'
      ctx.lineWidth = isHovered ? 1.5 : 0.5
      ctx.stroke()

      // Type accent bar (left edge)
      ctx.fillStyle = typeColor
      ctx.beginPath()
      ctx.roundRect(x, y, 3, h, [r, 0, 0, r])
      ctx.fill()

      // Text label
      ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'
      ctx.font = node.type === 'code' ? '11px monospace' : '12px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const maxTextW = w - 16
      const text = node.text.length > 45 ? node.text.slice(0, 42) + '...' : node.text
      ctx.fillText(text, x + 10, y + h / 2, maxTextW)
    }

    ctx.globalAlpha = 1
  }

  // ── Hit Testing ─────────────────────────────────────────────

  private hitTest(x: number, y: number): HitResult | null {
    if (this.transitionProgress < 0.5) {
      // Galaxy mode: test bubbles
      for (const bubble of this.bubbles) {
        const dx = x - bubble.x
        const dy = y - bubble.y
        if (dx * dx + dy * dy <= bubble.radius * bubble.radius) {
          return { type: 'bubble', id: bubble.id, data: bubble }
        }
      }
    } else {
      // Constellation mode: test nodes
      for (const node of this.nodes) {
        const nx = node.x - node.width / 2
        const ny = node.y - node.height / 2
        if (x >= nx && x <= nx + node.width && y >= ny && y <= ny + node.height) {
          return { type: 'node', id: node.id, data: node }
        }
      }
    }
    return null
  }

  // ── Event Handlers ──────────────────────────────────────────

  private handleMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.mouseX = e.clientX - rect.left
    this.mouseY = e.clientY - rect.top

    const hit = this.hitTest(this.mouseX, this.mouseY)
    this.hoveredId = hit?.id || null
    this.canvas.style.cursor = hit ? 'pointer' : 'default'
    this.onHover?.(hit)
  }

  private handleClick = () => {
    const hit = this.hitTest(this.mouseX, this.mouseY)
    if (hit) {
      this.onClick?.(hit)
    } else if (this.transitionProgress > 0.5) {
      // Click background in constellation → drill out
      this.onClick?.(null)
    }
  }
}
