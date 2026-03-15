/**
 * Canvas 2D renderer for the knowledge galaxy.
 * Galaxy: theme bubbles with type distribution bars + affinity rivers
 * Constellation: compact pill nodes with D3 zoom/drag, edge reason tooltips
 */
import * as d3 from 'd3'
import type { GalaxyTheme, ThemeAffinity, ConstellationNode, ConstellationEdge } from '@/types'

// ── Constants ───────────────────────────────────────────────────

const NODE_H = 36
const NODE_PAD = 18
const NODE_R = 8

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
  return Math.min(320, Math.max(120, ctx.measureText(text).width + NODE_PAD * 2 + 30))
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
  // Edge reason displayed in tooltip (set during hitTest)
  private hoveredNode: ConstellationNodePos | null = null
  private mouseX = 0
  private mouseY = 0
  private isDragging = false
  private dragNode: ConstellationNodePos | null = null
  private dragStartX = 0
  private dragStartY = 0
  private dragMoved = false

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

    // D3 zoom for pan/zoom (background only)
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.3, 5])
      .filter((e) => {
        // Don't zoom-pan when over a node (let our manual drag handle it)
        if (self.dragNode) return false
        if (e.type === 'mousedown' || e.type === 'touchstart') {
          const rect = self.canvas.getBoundingClientRect()
          const mx = e.clientX - rect.left, my = e.clientY - rect.top
          const hit = self.hitTest(mx, my)
          if (hit?.type === 'node') return false // Let node drag handle this
        }
        return true
      })
      .on('zoom', (e) => { self.transform = e.transform })
    d3.select(this.canvas).call(zoom)

    // Manual node drag + hover + click via native events
    this.canvas.addEventListener('mousedown', this.handleMouseDown)
    this.canvas.addEventListener('mousemove', this.handleMouseMove)
    this.canvas.addEventListener('mouseup', this.handleMouseUp)
  }

  dispose() {
    cancelAnimationFrame(this.animationId)
    this.galaxySim?.stop()
    this.constellationSim?.stop()
    this.canvas.removeEventListener('mousedown', this.handleMouseDown)
    this.canvas.removeEventListener('mousemove', this.handleMouseMove)
    this.canvas.removeEventListener('mouseup', this.handleMouseUp)
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
    // Bloom spawn: all nodes start at center and explode outward via physics
    this.nodes = thoughts.map(t => {
      const truncated = t.text.length > 55 ? t.text.slice(0, 52) + '...' : t.text
      const w = measureNodeWidth(this.ctx, truncated)
      return {
        ...t,
        text: truncated,
        x: cx + (Math.random() - 0.5) * 20,
        y: cy + (Math.random() - 0.5) * 20,
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

      const isDirectlyConnected = this.hoveredId && (edge.source === this.hoveredId || edge.target === this.hoveredId)
      const isLit = !this.hoveredId || (connected.has(edge.source) && connected.has(edge.target))

      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)

      if (isDirectlyConnected) {
        // Bright theme-colored edge for direct connections
        ctx.strokeStyle = hexToRgba(this.constellationColor, 0.7)
        ctx.lineWidth = 1.5
      } else if (isLit) {
        // Subtle neutral for visible but not focused
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
        ctx.lineWidth = 0.5
      } else {
        // Nearly invisible when dimmed
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)'
        ctx.lineWidth = 0.3
      }
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
      ctx.font = '13px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(shape, x + 16, y + NODE_H / 2)

      // Text label (single line, with breathing room)
      ctx.fillStyle = isHovered ? '#fff' : 'rgba(255,255,255,0.8)'
      ctx.font = node.type === 'code'
        ? '11px "SF Mono", "JetBrains Mono", monospace'
        : '600 12px "Inter", system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.text, x + 32, y + NODE_H / 2, w - 48)

      ctx.restore()
    }

    ctx.restore()
  }

  // ── Tooltip ─────────────────────────────────────────────────

  private drawTooltip() {
    if (this.isDragging || !this.hoveredNode) return
    if (this.transitionProgress < 0.5) return

    const node = this.hoveredNode
    const { ctx } = this
    const tc = TYPE_COLORS[node.type] || '#a8a29e'

    // Position tooltip near the node but not overlapping
    const tx = this.mouseX + 16
    const ty = this.mouseY + 16
    const maxW = 320
    const padX = 14, padY = 12

    ctx.save()
    ctx.font = '13px "Inter", system-ui, sans-serif'

    // Word-wrap the full text
    const fullText = node.text
    const words = fullText.split(' ')
    const lines: string[] = []
    let currentLine = ''
    for (const word of words) {
      const test = currentLine ? currentLine + ' ' + word : word
      if (ctx.measureText(test).width > maxW - padX * 2) {
        if (currentLine) lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = test
      }
    }
    if (currentLine) lines.push(currentLine)

    // Tags line
    const tagLine = node.tags.length > 0 ? node.tags.slice(0, 4).map(t => `#${t}`).join('  ') : ''

    // Edge reasons
    const reasons = this.edges
      .filter(e => e.source === node.id || e.target === node.id)
      .map(e => (e as any).reason)
      .filter(Boolean)
    const reasonText = reasons.length > 0 ? `Connected: ${reasons[0]}` : ''

    // Calculate tooltip height
    const lineH = 18
    const textH = lines.length * lineH
    const typeH = 20
    const tagH = tagLine ? 18 : 0
    const reasonH = reasonText ? 18 : 0
    const totalH = padY + typeH + textH + (tagH ? 8 + tagH : 0) + (reasonH ? 8 + reasonH : 0) + padY
    const totalW = Math.min(maxW, Math.max(200, ...lines.map(l => ctx.measureText(l).width + padX * 2 + 10)))

    // Ensure tooltip stays on screen
    const finalX = Math.min(tx, this.viewport.width - totalW - 10)
    const finalY = Math.min(ty, this.viewport.height - totalH - 10)

    // Background
    ctx.fillStyle = 'rgba(16, 16, 24, 0.96)'
    ctx.beginPath()
    ctx.roundRect(finalX, finalY, totalW, totalH, 8)
    ctx.fill()
    ctx.strokeStyle = hexToRgba(tc, 0.3)
    ctx.lineWidth = 1
    ctx.stroke()

    let cy = finalY + padY

    // Type label
    ctx.fillStyle = tc
    ctx.font = 'bold 10px system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`${(TYPE_SHAPES[node.type] || '●')} ${node.type.toUpperCase()}`, finalX + padX, cy)
    cy += typeH

    // Full text
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.font = '13px "Inter", system-ui, sans-serif'
    for (const line of lines) {
      ctx.fillText(line, finalX + padX, cy)
      cy += lineH
    }

    // Tags
    if (tagLine) {
      cy += 8
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.font = '10px "SF Mono", monospace'
      ctx.fillText(tagLine, finalX + padX, cy)
      cy += tagH
    }

    // Connection reason
    if (reasonText) {
      cy += 8
      ctx.fillStyle = hexToRgba(tc, 0.5)
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText(reasonText, finalX + padX, cy)
    }

    ctx.restore()
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
          // Reason is shown in the tooltip via drawTooltip()
          return { type: 'node', id: n.id, data: n }
        }
      }
    }
    // no node hovered
    return null
  }

  // ── Events ────────────────────────────────────────────────────

  private handleMouseDown = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.mouseX = e.clientX - rect.left
    this.mouseY = e.clientY - rect.top
    this.dragStartX = this.mouseX
    this.dragStartY = this.mouseY
    this.dragMoved = false

    const hit = this.hitTest(this.mouseX, this.mouseY)
    if (hit?.type === 'node') {
      this.dragNode = hit.data as ConstellationNodePos
      this.isDragging = true
      // Keep sim warm — edges act as soft rubber bands pulling neighbors slightly
      this.constellationSim?.alphaTarget(0.08).restart()
      this.dragNode.fx = this.dragNode.x
      this.dragNode.fy = this.dragNode.y
      e.preventDefault() // Prevent D3 zoom from capturing this
    }
  }

  private handleMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect()
    this.mouseX = e.clientX - rect.left
    this.mouseY = e.clientY - rect.top

    if (this.isDragging && this.dragNode) {
      // Move only the dragged node — edges stretch like rubber bands
      const wx = this.transform.invertX(this.mouseX)
      const wy = this.transform.invertY(this.mouseY)
      this.dragNode.fx = wx
      this.dragNode.fy = wy
      this.dragNode.x = wx
      this.dragNode.y = wy
      // Only count as drag if moved more than 4px (prevents jitter-canceling clicks)
      const dist = Math.sqrt((this.mouseX - this.dragStartX) ** 2 + (this.mouseY - this.dragStartY) ** 2)
      if (dist > 4) this.dragMoved = true
      this.canvas.style.cursor = 'grabbing'
      return
    }

    // Hover detection
    const hit = this.hitTest(this.mouseX, this.mouseY)
    this.hoveredId = hit?.id || null
    this.hoveredNode = hit?.type === 'node' ? (hit.data as ConstellationNodePos) : null
    this.canvas.style.cursor = hit ? 'pointer' : 'default'
    this.onHover?.(hit)
  }

  private handleMouseUp = (_e: MouseEvent) => {
    if (this.isDragging && this.dragNode) {
      // Release the node
      this.dragNode.fx = null
      this.dragNode.fy = null

      if (!this.dragMoved) {
        // Click (no drag movement) — fire click handler
        const hit = this.hitTest(this.mouseX, this.mouseY)
        this.onClick?.(hit || null)
      }

      // Let simulation cool down naturally — node drifts back, neighbors settle
      this.constellationSim?.alphaTarget(0)

      this.dragNode = null
      this.isDragging = false
      this.canvas.style.cursor = 'default'
      return
    }

    // Background click (no node was being dragged)
    const dx = this.mouseX - this.dragStartX
    const dy = this.mouseY - this.dragStartY
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
      // Genuine click (not a pan)
      const hit = this.hitTest(this.mouseX, this.mouseY)
      if (hit) {
        this.onClick?.(hit)
      } else if (this.transitionProgress > 0.5) {
        this.onClick?.(null) // Background click → drill out
      }
    }
  }
}
