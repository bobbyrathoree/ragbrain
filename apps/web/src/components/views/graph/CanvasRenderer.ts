/**
 * Canvas 2D renderer for the knowledge galaxy.
 * Galaxy: theme bubbles with type distribution bars + affinity rivers
 * Constellation: compact pill nodes with D3 zoom/drag, edge reason tooltips
 */
import * as d3 from 'd3'
import type { GalaxyTheme, ThemeAffinity, ConstellationNode, ConstellationEdge } from '@/types'

// ── Constants ───────────────────────────────────────────────────

const NODE_H = 34
const NODE_PAD = 12
const NODE_R = 6

const TYPE_COLORS: Record<string, string> = {
  thought: '#a8a29e', decision: '#a78bfa', insight: '#38bdf8',
  code: '#34d399', todo: '#fbbf24', link: '#fb7185',
}

const TYPE_SHAPES: Record<string, string> = {
  thought: '●', decision: '◆', insight: '★',
  code: '⟨⟩', todo: '☐', link: '↗',
}

// ── Types ───────────────────────────────────────────────────────

interface Viewport { width: number; height: number; dpr: number }

export interface GalaxyBubble extends GalaxyTheme {
  x: number; y: number; radius: number
  vx?: number; vy?: number
  typeBreakdown?: { type: string; count: number }[]
}

export interface ConstellationNodePos extends ConstellationNode {
  x: number; y: number; width: number; height: number
  vx?: number; vy?: number
  fx?: number | null; fy?: number | null
}

export interface HitResult {
  type: 'bubble' | 'node' | 'edge'
  id: string
  data: any
  edgeReason?: string
}

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

function blendColors(c1: string, c2: string, a: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16)
  const r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16)
  return `rgba(${Math.round((r1+r2)/2)},${Math.round((g1+g2)/2)},${Math.round((b1+b2)/2)},${a})`
}

function measureNodeWidth(ctx: CanvasRenderingContext2D, text: string): number {
  ctx.font = '600 12px "Inter", system-ui, sans-serif'
  return Math.min(280, Math.max(100, ctx.measureText(text).width + NODE_PAD * 2 + 24))
}

/** Generate heuristic edges + track the reason for each connection */
export function generateHeuristicEdges(nodes: ConstellationNode[]): (ConstellationEdge & { reason: string })[] {
  const edges: (ConstellationEdge & { reason: string })[] = []
  const edgeSet = new Set<string>()

  for (let i = 0; i < nodes.length; i++) {
    const candidates: { idx: number; score: number; reason: string }[] = []
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      let score = 0
      const reasons: string[] = []

      const commonTags = nodes[i].tags.filter(t => nodes[j].tags.includes(t))
      if (commonTags.length > 0) {
        score += commonTags.length * 5
        reasons.push(commonTags.map(t => `#${t}`).join(', '))
      }

      if (nodes[i].type === nodes[j].type && nodes[i].type !== 'thought') {
        score += 2
        reasons.push(`both ${nodes[i].type}s`)
      }

      score += (1 - Math.abs(nodes[i].importance - nodes[j].importance)) * 0.5

      if (score > 0) {
        candidates.push({ idx: j, score, reason: reasons.join(' · ') || 'related' })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    for (const c of candidates.slice(0, 3)) {
      const key = Math.min(i, c.idx) + '-' + Math.max(i, c.idx)
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        edges.push({
          source: nodes[i].id, target: nodes[c.idx].id,
          similarity: Math.min(1, c.score / 10), reason: c.reason,
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
  private edges: (ConstellationEdge & { reason?: string })[] = []
  private constellationSim: d3.Simulation<ConstellationNodePos, undefined> | null = null
  private constellationColor = '#888888'

  // Zoom transform
  private transform = d3.zoomIdentity

  // Interaction
  private hoveredId: string | null = null
  private hoveredEdgeReason: string | null = null
  private mouseX = 0
  private mouseY = 0
  private isDragging = false

  // Transition
  private transitionProgress = 0
  private transitionTarget = 0

  onHover: ((hit: HitResult | null) => void) | null = null
  onClick: ((hit: HitResult | null) => void) | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.setupInteractions()
  }

  private setupInteractions() {
    const self = this
    const sel = d3.select(this.canvas)

    // Zoom
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.3, 5])
      .on('zoom', (e) => {
        self.transform = e.transform
      })
    sel.call(zoom)

    // Drag (constellation only)
    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        if (self.transitionProgress < 0.5) return null as any
        const x = self.transform.invertX(e.x)
        const y = self.transform.invertY(e.y)
        // Find nearest node
        let closest: ConstellationNodePos | null = null
        let minDist = Infinity
        for (const n of self.nodes) {
          const dx = x - n.x, dy = y - n.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < Math.max(n.width, n.height) / 2 + 10 && dist < minDist) {
            closest = n; minDist = dist
          }
        }
        return closest
      })
      .on('start', (e) => {
        if (!e.subject) return
        self.isDragging = true
        if (self.constellationSim) self.constellationSim.alphaTarget(0.3).restart()
        e.subject.fx = e.subject.x
        e.subject.fy = e.subject.y
      })
      .on('drag', (e) => {
        if (!e.subject) return
        e.subject.fx = self.transform.invertX(e.x)
        e.subject.fy = self.transform.invertY(e.y)
      })
      .on('end', (e) => {
        if (!e.subject) return
        self.isDragging = false
        if (self.constellationSim) self.constellationSim.alphaTarget(0)
        e.subject.fx = null
        e.subject.fy = null
      })
    sel.call(drag as any)

    // Hover + click via mousemove
    this.canvas.addEventListener('mousemove', this.handleMouseMove)
    this.canvas.addEventListener('click', this.handleClick)
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
    this.transform = d3.zoomIdentity // Reset zoom
    const cx = this.viewport.width / 2, cy = this.viewport.height / 2
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
      .alphaDecay(0.06).on('tick', () => {})

    this.transitionProgress = 0
    this.transitionTarget = 0
    this.startAnimation()
  }

  // ── Constellation Mode ──────────────────────────────────────

  setConstellationData(thoughts: ConstellationNode[], edges: ConstellationEdge[], color: string) {
    this.edges = edges.length > 0 ? edges : generateHeuristicEdges(thoughts)
    this.constellationColor = color
    this.transform = d3.zoomIdentity // Reset zoom
    const cx = this.viewport.width / 2, cy = this.viewport.height / 2

    // Measure text widths for compact pills
    this.nodes = thoughts.map(t => {
      const truncated = t.text.length > 55 ? t.text.slice(0, 52) + '...' : t.text
      const w = measureNodeWidth(this.ctx, truncated)
      return {
        ...t,
        text: truncated,
        x: cx + (Math.random() - 0.5) * 150,
        y: cy + (Math.random() - 0.5) * 150,
        width: w, height: NODE_H,
      }
    })

    const nodeMap = new Map(this.nodes.map((n, i) => [n.id, i]))
    const links = this.edges
      .map(e => ({ source: nodeMap.get(e.source)!, target: nodeMap.get(e.target)!, value: e.similarity }))
      .filter(l => l.source !== undefined && l.target !== undefined)

    this.constellationSim?.stop()
    this.constellationSim = d3.forceSimulation(this.nodes)
      .force('center', d3.forceCenter(cx, cy).strength(0.12))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('link', d3.forceLink(links).distance(90).strength(0.6))
      .force('collide', d3.forceCollide<ConstellationNodePos>().radius(d => d.width / 2 + 8).strength(0.9))
      .force('x', d3.forceX(cx).strength(0.06))
      .force('y', d3.forceY(cy).strength(0.06))
      .alphaDecay(0.025).on('tick', () => {})
  }

  // ── Transitions ─────────────────────────────────────────────

  transitionToConstellation(_id: string) {
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
    ctx.save()
    ctx.fillStyle = '#08080c'
    ctx.fillRect(0, 0, width, height)

    // Apply zoom transform
    ctx.translate(this.transform.x, this.transform.y)
    ctx.scale(this.transform.k, this.transform.k)

    if (this.transitionProgress < 0.5) this.drawGalaxy(1 - this.transitionProgress * 2)
    if (this.transitionProgress > 0.3) this.drawConstellation(Math.min(1, (this.transitionProgress - 0.3) / 0.7))

    ctx.restore()

    // Draw tooltip (not transformed)
    this.drawTooltip()
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
      ctx.beginPath()
      const mx = (src.x + tgt.x) / 2, my = (src.y + tgt.y) / 2 - 40
      ctx.moveTo(src.x, src.y)
      ctx.quadraticCurveTo(mx, my, tgt.x, tgt.y)
      ctx.strokeStyle = blendColors(src.color, tgt.color, Math.max(0.08, aff.strength * 0.5))
      ctx.lineWidth = Math.max(1.5, aff.volume * 0.6)
      ctx.stroke()
    }

    // Bubbles
    for (const bubble of this.bubbles) {
      const isHovered = this.hoveredId === bubble.id
      const breathe = 1 + Math.sin(this.time * 0.7 + this.bubbles.indexOf(bubble) * 1.8) * 0.02
      const r = bubble.radius * breathe * (isHovered ? 1.08 : 1)

      if (isHovered) { ctx.shadowBlur = 30; ctx.shadowColor = hexToRgba(bubble.color, 0.4) }

      // Outer glow
      ctx.beginPath(); ctx.arc(bubble.x, bubble.y, r + 10, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, 0.04); ctx.fill()

      // Main
      ctx.beginPath(); ctx.arc(bubble.x, bubble.y, r, 0, Math.PI * 2)
      ctx.fillStyle = hexToRgba(bubble.color, isHovered ? 0.25 : 0.15); ctx.fill()
      ctx.strokeStyle = hexToRgba(bubble.color, isHovered ? 0.65 : 0.35)
      ctx.lineWidth = isHovered ? 2.5 : 1.5; ctx.stroke()

      ctx.shadowBlur = 0

      // Count
      ctx.fillStyle = hexToRgba(bubble.color, 0.95)
      ctx.font = `bold ${Math.max(22, r * 0.45)}px "Inter", system-ui, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(bubble.count), bubble.x, bubble.y - 6)

      // "captures" label (replaces "thoughts")
      ctx.fillStyle = hexToRgba(bubble.color, 0.4)
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText('captures', bubble.x, bubble.y + r * 0.25 + 4)

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = `600 14px "Inter", system-ui, sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(bubble.label, bubble.x, bubble.y + r + 14)
    }

    ctx.restore()
  }

  // ── Constellation Drawing ───────────────────────────────────

  private drawConstellation(opacity: number) {
    const { ctx } = this

    // Theme tint
    ctx.fillStyle = hexToRgba(this.constellationColor, 0.015 * opacity)
    ctx.fillRect(
      -this.transform.x / this.transform.k,
      -this.transform.y / this.transform.k,
      this.viewport.width / this.transform.k,
      this.viewport.height / this.transform.k,
    )

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
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = isLit
        ? hexToRgba(this.constellationColor, Math.max(0.15, edge.similarity * 0.6))
        : 'rgba(255,255,255,0.03)'
      ctx.lineWidth = isLit ? Math.max(1, edge.similarity * 3) : 0.3
      ctx.stroke()
    }

    // ── Nodes (compact pills) ──
    for (const node of this.nodes) {
      const isHovered = this.hoveredId === node.id
      const isLit = !this.hoveredId || connected.has(node.id)
      const tc = TYPE_COLORS[node.type] || '#a8a29e'
      const shape = TYPE_SHAPES[node.type] || '●'

      const x = node.x - node.width / 2, y = node.y - NODE_H / 2
      const w = node.width

      ctx.save()
      ctx.globalAlpha = opacity * (isLit ? 1 : 0.15)

      // Hover glow
      if (isHovered) { ctx.shadowBlur = 20; ctx.shadowColor = hexToRgba(tc, 0.5) }

      // Pill background
      ctx.beginPath()
      ctx.roundRect(x, y, w, NODE_H, NODE_R)
      ctx.fillStyle = isHovered ? 'rgba(30, 30, 38, 0.95)' : 'rgba(16, 16, 22, 0.9)'
      ctx.fill()
      ctx.strokeStyle = isHovered ? hexToRgba(tc, 0.6) : 'rgba(255,255,255,0.07)'
      ctx.lineWidth = isHovered ? 1.5 : 0.7
      ctx.stroke()

      ctx.shadowBlur = 0

      // Type shape indicator (left)
      ctx.fillStyle = tc
      ctx.font = '12px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(shape, x + 14, y + NODE_H / 2)

      // Text label (single line, truncated)
      ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.8)'
      ctx.font = node.type === 'code'
        ? '11px "SF Mono", "JetBrains Mono", monospace'
        : '600 12px "Inter", system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.text, x + 28, y + NODE_H / 2, w - 38)

      ctx.restore()
    }

    ctx.restore()
  }

  // ── Tooltip ─────────────────────────────────────────────────

  private drawTooltip() {
    if (this.isDragging) return

    // Edge reason tooltip
    if (this.hoveredId && this.hoveredEdgeReason) {
      const { ctx } = this
      const tx = this.mouseX + 14, ty = this.mouseY - 20
      ctx.save()
      ctx.font = '11px system-ui, sans-serif'
      const tw = ctx.measureText(this.hoveredEdgeReason).width + 16
      ctx.fillStyle = 'rgba(20,20,28,0.95)'
      ctx.beginPath()
      ctx.roundRect(tx, ty, tw, 24, 4)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.textBaseline = 'middle'
      ctx.fillText(this.hoveredEdgeReason, tx + 8, ty + 12)
      ctx.restore()
    }

    // Node tooltip (show tags on hover)
    if (this.hoveredId && this.transitionProgress > 0.5) {
      const node = this.nodes.find(n => n.id === this.hoveredId)
      if (node && node.tags.length > 0) {
        const { ctx } = this
        const tagText = node.tags.slice(0, 4).map(t => `#${t}`).join('  ')
        const tx = this.mouseX + 14, ty = this.mouseY + 16
        ctx.save()
        ctx.font = '10px "SF Mono", monospace'
        const tw = ctx.measureText(tagText).width + 16
        ctx.fillStyle = 'rgba(20,20,28,0.92)'
        ctx.beginPath()
        ctx.roundRect(tx, ty, tw, 22, 4)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.textBaseline = 'middle'
        ctx.fillText(tagText, tx + 8, ty + 11)
        ctx.restore()
      }
    }
  }

  // ── Hit Testing ─────────────────────────────────────────────

  private hitTest(screenX: number, screenY: number): HitResult | null {
    // Invert zoom transform
    const x = this.transform.invertX(screenX)
    const y = this.transform.invertY(screenY)

    if (this.transitionProgress < 0.5) {
      for (const b of this.bubbles) {
        const dx = x - b.x, dy = y - b.y
        if (dx * dx + dy * dy <= b.radius * b.radius) {
          return { type: 'bubble', id: b.id, data: b }
        }
      }
    } else {
      // Test nodes
      for (const n of this.nodes) {
        const nx = n.x - n.width / 2, ny = n.y - NODE_H / 2
        if (x >= nx && x <= nx + n.width && y >= ny && y <= ny + NODE_H) {
          // Find edge reasons for this node
          const reasons = this.edges
            .filter(e => e.source === n.id || e.target === n.id)
            .map(e => (e as any).reason)
            .filter(Boolean)
          this.hoveredEdgeReason = reasons.length > 0 ? `Linked: ${reasons[0]}` : null
          return { type: 'node', id: n.id, data: n }
        }
      }
    }
    this.hoveredEdgeReason = null
    return null
  }

  // ── Events ────────────────────────────────────────────────────

  private handleMouseMove = (e: MouseEvent) => {
    if (this.isDragging) return
    const rect = this.canvas.getBoundingClientRect()
    this.mouseX = e.clientX - rect.left
    this.mouseY = e.clientY - rect.top
    const hit = this.hitTest(this.mouseX, this.mouseY)
    this.hoveredId = hit?.id || null
    this.canvas.style.cursor = hit ? 'pointer' : (this.isDragging ? 'grabbing' : 'grab')
    this.onHover?.(hit)
  }

  private handleClick = () => {
    if (this.isDragging) return
    const hit = this.hitTest(this.mouseX, this.mouseY)
    this.onClick?.(hit || null)
  }
}
