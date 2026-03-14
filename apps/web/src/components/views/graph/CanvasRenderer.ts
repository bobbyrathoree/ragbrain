/**
 * Canvas 2D renderer for the knowledge galaxy.
 * Galaxy mode: theme bubbles + affinity rivers
 * Constellation mode: thought nodes with glassmorphism, edges, tag pills, glow effects
 */
import * as d3 from 'd3'
import type { GalaxyTheme, ThemeAffinity, ConstellationNode, ConstellationEdge } from '@/types'

// ── Constants ───────────────────────────────────────────────────

const NODE_W = 230
const NODE_H = 82
const NODE_R = 8

const TYPE_COLORS: Record<string, string> = {
  thought: '#a8a29e',
  decision: '#a78bfa',
  insight: '#38bdf8',
  code: '#34d399',
  todo: '#fbbf24',
  link: '#fb7185',
}

// ── Types ───────────────────────────────────────────────────────

interface Viewport { width: number; height: number; dpr: number }

export interface GalaxyBubble extends GalaxyTheme {
  x: number; y: number; radius: number
  vx?: number; vy?: number
}

export interface ConstellationNodePos extends ConstellationNode {
  x: number; y: number; width: number; height: number
  vx?: number; vy?: number
}

export interface HitResult {
  type: 'bubble' | 'node'
  id: string
  data: GalaxyBubble | ConstellationNodePos
}

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function blendColors(c1: string, c2: string, alpha: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16)
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16)
  return `rgba(${Math.round((r1+r2)/2)},${Math.round((g1+g2)/2)},${Math.round((b1+b2)/2)},${alpha})`
}

/** Generate heuristic edges from shared tags + type similarity when backend returns none */
export function generateHeuristicEdges(nodes: ConstellationNode[]): ConstellationEdge[] {
  const edges: ConstellationEdge[] = []
  const edgeSet = new Set<string>()
  const K = 3

  for (let i = 0; i < nodes.length; i++) {
    const candidates: { idx: number; score: number }[] = []
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      let score = 0
      // Shared tags (strongest signal)
      const commonTags = nodes[i].tags.filter(t => nodes[j].tags.includes(t))
      score += commonTags.length * 5
      // Same type
      if (nodes[i].type === nodes[j].type) score += 1
      // Similar importance
      score += (1 - Math.abs(nodes[i].importance - nodes[j].importance)) * 0.5
      candidates.push({ idx: j, score })
    }
    // k-NN: every node connects to its top K neighbors
    candidates.sort((a, b) => b.score - a.score)
    for (const c of candidates.slice(0, K)) {
      if (c.score <= 0) continue
      const key = Math.min(i, c.idx) + '-' + Math.max(i, c.idx)
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        edges.push({
          source: nodes[i].id,
          target: nodes[c.idx].id,
          similarity: Math.min(1, c.score / 10),
        })
      }
    }
  }
  return edges
}

// ── Renderer ────────────────────────────────────────────────────

export class CanvasRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private viewport: Viewport = { width: 0, height: 0, dpr: 1 }
  private animationId = 0
  private time = 0

  // Galaxy
  private bubbles: GalaxyBubble[] = []
  private affinities: ThemeAffinity[] = []
  private galaxySim: d3.Simulation<GalaxyBubble, undefined> | null = null

  // Constellation
  private nodes: ConstellationNodePos[] = []
  private edges: ConstellationEdge[] = []
  private constellationSim: d3.Simulation<ConstellationNodePos, undefined> | null = null
  private constellationColor = '#888888'

  // Interaction
  private hoveredId: string | null = null
  private mouseX = 0
  private mouseY = 0

  // Transition
  private transitionProgress = 0
  private transitionTarget = 0

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

    const maxCount = Math.max(...themes.map(t => t.count), 1)
    const minR = 50, maxR = Math.min(this.viewport.width, this.viewport.height) * 0.18

    this.bubbles = themes.map((t, i) => {
      const radius = minR + Math.sqrt(t.count / maxCount) * (maxR - minR)
      const angle = (i / themes.length) * Math.PI * 2 - Math.PI / 2
      const spread = Math.min(this.viewport.width, this.viewport.height) * 0.18
      return { ...t, x: cx + Math.cos(angle) * spread, y: cy + Math.sin(angle) * spread, radius }
    })

    this.galaxySim?.stop()
    this.galaxySim = d3.forceSimulation(this.bubbles)
      .force('center', d3.forceCenter(cx, cy).strength(0.08))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collide', d3.forceCollide<GalaxyBubble>().radius(d => d.radius + 30).strength(0.9))
      .alphaDecay(0.06)
      .on('tick', () => {})

    this.transitionProgress = 0
    this.transitionTarget = 0
    this.startAnimation()
  }

  // ── Constellation Mode ──────────────────────────────────────

  setConstellationData(thoughts: ConstellationNode[], edges: ConstellationEdge[], color: string) {
    // If no edges from backend, generate heuristic edges
    this.edges = edges.length > 0 ? edges : generateHeuristicEdges(thoughts)
    this.constellationColor = color
    const cx = this.viewport.width / 2
    const cy = this.viewport.height / 2

    this.nodes = thoughts.map(t => ({
      ...t,
      x: cx + (Math.random() - 0.5) * 120,
      y: cy + (Math.random() - 0.5) * 120,
      width: NODE_W,
      height: NODE_H,
    }))

    // Build D3 links from edges
    const nodeMap = new Map(this.nodes.map((n, i) => [n.id, i]))
    const links = this.edges
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)!, value: e.similarity }))
      .filter(l => l.source !== undefined && l.target !== undefined)

    this.constellationSim?.stop()
    this.constellationSim = d3.forceSimulation(this.nodes)
      .force('center', d3.forceCenter(cx, cy).strength(0.15))
      .force('charge', d3.forceManyBody().strength(-250))
      .force('link', d3.forceLink(links).distance(100).strength(0.6))
      .force('collide', d3.forceCollide<ConstellationNodePos>().radius(d => Math.max(d.width, d.height) / 2 + 12).strength(0.85))
      .force('x', d3.forceX(cx).strength(0.08))
      .force('y', d3.forceY(cy).strength(0.08))
      .alphaDecay(0.025)
      .on('tick', () => {})
  }

  // ── Transitions ─────────────────────────────────────────────

  transitionToConstellation(_bubbleId: string) {
    this.transitionTarget = 1
    this.galaxySim?.stop()
  }

  transitionToGalaxy() {
    this.transitionTarget = 0
    this.constellationSim?.stop()
    this.galaxySim?.alpha(0.3).restart()
  }

  // ── Animation Loop ──────────────────────────────────────────

  private startAnimation() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)
      this.time = performance.now() * 0.001

      // Smooth transition (ease in-out)
      const speed = 0.05
      if (this.transitionProgress < this.transitionTarget) {
        this.transitionProgress = Math.min(this.transitionProgress + speed, 1)
      } else if (this.transitionProgress > this.transitionTarget) {
        this.transitionProgress = Math.max(this.transitionProgress - speed, 0)
      }

      this.draw()
    }
    animate()
  }

  private draw() {
    const { ctx, viewport: { width, height } } = this

    ctx.fillStyle = '#08080c'
    ctx.fillRect(0, 0, width, height)

    if (this.transitionProgress < 0.5) {
      this.drawGalaxy(1 - this.transitionProgress * 2)
    }
    if (this.transitionProgress > 0.3) {
      this.drawConstellation(Math.min(1, (this.transitionProgress - 0.3) / 0.7))
    }
  }

  // ── Galaxy Drawing ──────────────────────────────────────────

  private drawGalaxy(opacity: number) {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha = opacity

    // Affinity rivers
    for (const aff of this.affinities) {
      const src = this.bubbles.find(b => b.id === aff.source)
      const tgt = this.bubbles.find(b => b.id === aff.target)
      if (!src || !tgt) continue
      const lw = Math.max(1.5, Math.min(10, aff.volume * 0.6))
      const la = Math.max(0.06, Math.min(0.35, aff.strength * 0.5))
      ctx.beginPath()
      const mx = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2 - 40
      ctx.moveTo(src.x, src.y)
      ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y)
      ctx.strokeStyle = blendColors(src.color, tgt.color, la)
      ctx.lineWidth = lw
      ctx.stroke()
    }

    // Bubbles
    for (const bubble of this.bubbles) {
      const isHovered = this.hoveredId === bubble.id
      const breathe = 1 + Math.sin(this.time * 0.7 + this.bubbles.indexOf(bubble) * 1.8) * 0.025
      const r = bubble.radius * breathe * (isHovered ? 1.1 : 1)

      // Outer glow
      if (isHovered) {
        ctx.shadowBlur = 30
        ctx.shadowColor = hexToRgba(bubble.color, 0.4)
      }

      // Glow ring
      ctx.beginPath()
      ctx.arc(bubble.x, bubble.y, r + 12, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, 0.04)
      ctx.fill()

      // Main circle
      ctx.beginPath()
      ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, isHovered ? 0.28 : 0.16)
      ctx.fill()
      ctx.strokeStyle = hexToRgba(bubble.color, isHovered ? 0.7 : 0.4)
      ctx.lineWidth = isHovered ? 2.5 : 1.5
      ctx.stroke()

      ctx.shadowBlur = 0

      // Count
      ctx.fillStyle = hexToRgba(bubble.color, 0.95)
      ctx.font = `bold ${Math.max(20, r * 0.45)}px "Inter", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(bubble.count), bubble.x, bubble.y - 4)

      // "thoughts" subtitle
      ctx.fillStyle = hexToRgba(bubble.color, 0.5)
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText('thoughts', bubble.x, bubble.y + r * 0.3)

      // Label below
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = `600 14px "Inter", system-ui, sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(bubble.label, bubble.x, bubble.y + r + 14)

      // Recent badge
      if (bubble.recentCount > 0) {
        ctx.fillStyle = hexToRgba(bubble.color, 0.55)
        ctx.font = '10px system-ui, sans-serif'
        ctx.fillText(`+${bubble.recentCount} this week`, bubble.x, bubble.y + r + 34)
      }
    }

    ctx.restore()
  }

  // ── Constellation Drawing ───────────────────────────────────

  private drawConstellation(opacity: number) {
    const { ctx } = this

    // Theme tint
    ctx.fillStyle = hexToRgba(this.constellationColor, 0.02 * opacity)
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height)

    // Build connected set for hover
    const connected = new Set<string>()
    if (this.hoveredId) {
      connected.add(this.hoveredId)
      for (const e of this.edges) {
        if (e.source === this.hoveredId) connected.add(e.target)
        if (e.target === this.hoveredId) connected.add(e.source)
      }
    }

    ctx.save()
    ctx.globalAlpha = opacity

    // ── Edges ──
    for (const edge of this.edges) {
      const src = this.nodes.find(n => n.id === edge.source)
      const tgt = this.nodes.find(n => n.id === edge.target)
      if (!src || !tgt) continue

      const isLit = !this.hoveredId || (connected.has(edge.source) && connected.has(edge.target))
      const ea = isLit ? Math.max(0.12, edge.similarity * 0.5) : 0.03
      const ew = isLit ? Math.max(1, edge.similarity * 3) : 0.4

      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = isLit
        ? hexToRgba(this.constellationColor, ea)
        : 'rgba(255,255,255,0.03)'
      ctx.lineWidth = ew
      ctx.stroke()
    }

    // ── Nodes ──
    for (const node of this.nodes) {
      const isHovered = this.hoveredId === node.id
      const isLit = !this.hoveredId || connected.has(node.id)
      const typeColor = TYPE_COLORS[node.type] || '#a8a29e'

      const x = node.x - NODE_W / 2
      const y = node.y - NODE_H / 2

      ctx.save()
      ctx.globalAlpha = opacity * (isLit ? 1 : 0.15)

      // Hover glow
      if (isHovered) {
        ctx.shadowBlur = 25
        ctx.shadowColor = hexToRgba(typeColor, 0.5)
      }

      // Background (glassmorphic)
      ctx.beginPath()
      ctx.roundRect(x, y, NODE_W, NODE_H, NODE_R)
      ctx.fillStyle = isHovered ? 'rgba(30, 30, 38, 0.95)' : 'rgba(18, 18, 24, 0.9)'
      ctx.fill()

      // Border
      ctx.strokeStyle = isHovered ? hexToRgba(typeColor, 0.7) : 'rgba(255, 255, 255, 0.08)'
      ctx.lineWidth = isHovered ? 1.5 : 0.8
      ctx.stroke()

      ctx.shadowBlur = 0

      // Accent bar
      ctx.fillStyle = typeColor
      ctx.beginPath()
      ctx.roundRect(x, y, 4, NODE_H, [NODE_R, 0, 0, NODE_R])
      ctx.fill()

      // Type label (top right)
      ctx.fillStyle = hexToRgba(typeColor, 0.6)
      ctx.font = 'bold 9px system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(node.type.toUpperCase(), x + NODE_W - 10, y + 8)

      // Text (2-line wrap)
      ctx.fillStyle = isHovered ? '#fff' : 'rgba(255, 255, 255, 0.85)'
      ctx.font = node.type === 'code'
        ? '12px "JetBrains Mono", "SF Mono", monospace'
        : '600 13px "Inter", system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'

      const maxW = NODE_W - 28
      const words = node.text.split(' ')
      let line1 = '', line2 = '', onLine2 = false
      for (const word of words) {
        const test = onLine2 ? line2 + word + ' ' : line1 + word + ' '
        if (ctx.measureText(test).width > maxW && !onLine2) {
          onLine2 = true
          line2 = word + ' '
        } else if (onLine2) {
          line2 = test
        } else {
          line1 = test
        }
      }
      if (line2 && ctx.measureText(line2).width > maxW) {
        line2 = line2.slice(0, 38) + '...'
      }

      ctx.fillText(line1.trim(), x + 14, y + 12)
      if (line2) ctx.fillText(line2.trim(), x + 14, y + 28)

      // Tag pills
      const tags = node.tags.slice(0, 3)
      if (tags.length > 0) {
        let tx = x + 14
        ctx.font = '10px "SF Mono", monospace'
        for (const tag of tags) {
          const label = `#${tag}`
          const tw = ctx.measureText(label).width + 10
          if (tx + tw > x + NODE_W - 10) break

          ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
          ctx.beginPath()
          ctx.roundRect(tx, y + NODE_H - 24, tw, 16, 4)
          ctx.fill()

          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
          ctx.fillText(label, tx + 5, y + NODE_H - 12)
          tx += tw + 5
        }
      }

      ctx.restore()
    }

    ctx.restore()
  }

  // ── Hit Testing ─────────────────────────────────────────────

  private hitTest(x: number, y: number): HitResult | null {
    if (this.transitionProgress < 0.5) {
      for (const bubble of this.bubbles) {
        const dx = x - bubble.x, dy = y - bubble.y
        if (dx * dx + dy * dy <= bubble.radius * bubble.radius) {
          return { type: 'bubble', id: bubble.id, data: bubble }
        }
      }
    } else {
      for (const node of this.nodes) {
        const nx = node.x - NODE_W / 2, ny = node.y - NODE_H / 2
        if (x >= nx && x <= nx + NODE_W && y >= ny && y <= ny + NODE_H) {
          return { type: 'node', id: node.id, data: node }
        }
      }
    }
    return null
  }

  // ── Events ────────────────────────────────────────────────────

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
    this.onClick?.(hit || null)
  }
}
