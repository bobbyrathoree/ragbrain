/**
 * D3 force simulation for knowledge graph layout.
 * Takes nodes/edges and a position buffer, mutates positions on each tick.
 * Decoupled from Three.js — only writes to a Float32Array.
 */
import * as d3 from 'd3'
import type { GraphNode, GraphEdge } from '@/types'

interface SimNode extends GraphNode {
  x: number
  y: number
  vx?: number
  vy?: number
  index: number
}

export function startSimulation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Float32Array,
  onTick: () => void,
): d3.Simulation<SimNode, undefined> {
  const simNodes: SimNode[] = nodes.map((n, i) => ({
    ...n,
    x: positions[i * 3],
    y: positions[i * 3 + 1],
    index: i,
  }))

  const simLinks = edges.map(e => ({
    source: simNodes.findIndex(n => n.id === e.source),
    target: simNodes.findIndex(n => n.id === e.target),
  }))

  const simulation = d3.forceSimulation(simNodes)
    .force('charge', d3.forceManyBody().strength(-40))
    .force('center', d3.forceCenter(0, 0).strength(0.05))
    .force('link', d3.forceLink(simLinks).distance(8).strength(0.2))
    .force('cluster', (alpha: number) => {
      // Pull nodes toward their theme centroid
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
        positions[i * 3] = n.x!
        positions[i * 3 + 1] = n.y!
      })
      onTick()
    })
    .alpha(1)
    .alphaDecay(0.05)

  return simulation as d3.Simulation<SimNode, undefined>
}
