<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useThoughts } from '@/composables/useThoughts'

const { thoughts, fetchThoughts } = useThoughts()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const selectedStar = ref<{ id: string; text: string; type: string; x: number; y: number } | null>(null)
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)

interface Star {
  id: string
  x: number
  y: number
  size: number
  brightness: number
  twinkleSpeed: number
  twinklePhase: number
  color: string
  isThought: boolean
  text?: string
  type?: string
}

const typeColors: Record<string, string> = {
  thought: '#a1a1aa',
  decision: '#a78bfa',
  insight: '#38bdf8',
  code: '#4ade80',
  todo: '#fb923c',
  link: '#f472b6',
}

// Pan and zoom state
let offsetX = 0
let offsetY = 0
let scale = 1
let isDragging = false
let lastX = 0
let lastY = 0

let animationId: number
let stars: Star[] = []
let ctx: CanvasRenderingContext2D | null = null
let canvasWidth = 0
let canvasHeight = 0

// Thought data from API (with fallback)
const thoughtData = computed(() => {
  if (thoughts.value.length > 0) {
    return thoughts.value.map(t => ({
      id: t.id,
      text: t.text,
      type: t.type
    }))
  }
  // Fallback mock data
  return [
    { id: '1', text: 'OAuth vs JWT decision', type: 'decision' },
    { id: '2', text: 'Performance insights', type: 'insight' },
    { id: '3', text: 'API fetch function', type: 'code' },
    { id: '4', text: 'Review PR', type: 'todo' },
    { id: '5', text: 'Design principles', type: 'insight' },
    { id: '6', text: 'Vite migration', type: 'thought' },
    { id: '7', text: 'Type definitions', type: 'code' },
    { id: '8', text: 'Linear issue link', type: 'link' },
  ]
})

const initCanvas = () => {
  const canvas = canvasRef.value
  if (!canvas) return

  ctx = canvas.getContext('2d')
  if (!ctx) return

  const resize = () => {
    canvasWidth = canvas.offsetWidth
    canvasHeight = canvas.offsetHeight
    canvas.width = canvasWidth * window.devicePixelRatio
    canvas.height = canvasHeight * window.devicePixelRatio
    ctx!.scale(window.devicePixelRatio, window.devicePixelRatio)
    windowWidth.value = window.innerWidth
  }
  resize()
  window.addEventListener('resize', resize)

  // Background stars
  for (let i = 0; i < 200; i++) {
    stars.push({
      id: `bg-${i}`,
      x: Math.random() * canvasWidth * 2 - canvasWidth * 0.5,
      y: Math.random() * canvasHeight * 2 - canvasHeight * 0.5,
      size: 0.5 + Math.random() * 1,
      brightness: 0.1 + Math.random() * 0.3,
      twinkleSpeed: 0.005 + Math.random() * 0.015,
      twinklePhase: Math.random() * Math.PI * 2,
      color: '#ffffff',
      isThought: false,
    })
  }

  // Thought stars
  thoughtData.value.forEach((thought) => {
    stars.push({
      id: thought.id,
      x: 150 + Math.random() * (canvasWidth - 300),
      y: 150 + Math.random() * (canvasHeight - 300),
      size: 3 + Math.random() * 3,
      brightness: 0.7 + Math.random() * 0.3,
      twinkleSpeed: 0.01 + Math.random() * 0.01,
      twinklePhase: Math.random() * Math.PI * 2,
      color: typeColors[thought.type] || '#a1a1aa',
      isThought: true,
      text: thought.text,
      type: thought.type,
    })
  })
}

const getTransformedPos = (x: number, y: number) => ({
  x: (x + offsetX) * scale + canvasWidth / 2,
  y: (y + offsetY) * scale + canvasHeight / 2,
})

const getWorldPos = (screenX: number, screenY: number) => ({
  x: (screenX - canvasWidth / 2) / scale - offsetX,
  y: (screenY - canvasHeight / 2) / scale - offsetY,
})

const handleMouseDown = (e: MouseEvent) => {
  isDragging = true
  lastX = e.clientX
  lastY = e.clientY
  if (canvasRef.value) canvasRef.value.style.cursor = 'grabbing'
}

const handleMouseMove = (e: MouseEvent) => {
  if (isDragging) {
    offsetX += (e.clientX - lastX) / scale
    offsetY += (e.clientY - lastY) / scale
    lastX = e.clientX
    lastY = e.clientY
  }
}

const handleMouseUp = () => {
  isDragging = false
  if (canvasRef.value) canvasRef.value.style.cursor = 'grab'
}

const handleWheel = (e: WheelEvent) => {
  e.preventDefault()
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
  scale = Math.max(0.5, Math.min(3, scale * zoomFactor))
}

const handleClick = (e: MouseEvent) => {
  if (!canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const screenX = e.clientX - rect.left
  const screenY = e.clientY - rect.top
  const worldPos = getWorldPos(screenX, screenY)

  // Find clicked star
  const thoughtStars = stars.filter((s) => s.isThought)
  for (const star of thoughtStars) {
    const dx = star.x - worldPos.x
    const dy = star.y - worldPos.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < star.size * 3) {
      const transformed = getTransformedPos(star.x, star.y)
      selectedStar.value = {
        id: star.id,
        text: star.text || '',
        type: star.type || 'thought',
        x: transformed.x,
        y: transformed.y,
      }
      return
    }
  }
  selectedStar.value = null
}

let time = 0
const animate = () => {
  if (!ctx) return

  ctx.fillStyle = '#050508'
  ctx.fillRect(0, 0, canvasWidth, canvasHeight)

  time += 0.016

  // Draw constellation lines
  const thoughtStars = stars.filter((s) => s.isThought)
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.08)'
  ctx.lineWidth = 1
  for (let i = 0; i < thoughtStars.length; i++) {
    for (let j = i + 1; j < thoughtStars.length; j++) {
      const dx = thoughtStars[i].x - thoughtStars[j].x
      const dy = thoughtStars[i].y - thoughtStars[j].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 200) {
        const p1 = getTransformedPos(thoughtStars[i].x, thoughtStars[i].y)
        const p2 = getTransformedPos(thoughtStars[j].x, thoughtStars[j].y)
        ctx.beginPath()
        ctx.moveTo(p1.x, p1.y)
        ctx.lineTo(p2.x, p2.y)
        ctx.stroke()
      }
    }
  }

  // Draw stars
  for (const star of stars) {
    const twinkle = Math.sin(time * star.twinkleSpeed * 60 + star.twinklePhase)
    const currentBrightness = star.brightness * (0.7 + 0.3 * twinkle)
    const pos = getTransformedPos(star.x, star.y)
    const size = star.size * scale

    // Skip if off screen
    if (pos.x < -50 || pos.x > canvasWidth + 50 || pos.y < -50 || pos.y > canvasHeight + 50) continue

    if (star.isThought) {
      // Glow
      const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, size * 4)
      gradient.addColorStop(0, star.color + '60')
      gradient.addColorStop(1, 'transparent')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, size * 4, 0, Math.PI * 2)
      ctx.fill()

      // Core
      ctx.fillStyle = star.color
      ctx.globalAlpha = currentBrightness
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1

      // Selection ring
      if (selectedStar.value?.id === star.id) {
        ctx.strokeStyle = star.color
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(pos.x, pos.y, size + 8, 0, Math.PI * 2)
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = `rgba(255, 255, 255, ${currentBrightness})`
      ctx.beginPath()
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  animationId = requestAnimationFrame(animate)
}

onMounted(() => {
  fetchThoughts()
  initCanvas()
  animate()

  canvasRef.value?.addEventListener('mousedown', handleMouseDown)
  canvasRef.value?.addEventListener('mousemove', handleMouseMove)
  canvasRef.value?.addEventListener('mouseup', handleMouseUp)
  canvasRef.value?.addEventListener('mouseleave', handleMouseUp)
  canvasRef.value?.addEventListener('wheel', handleWheel, { passive: false })
  canvasRef.value?.addEventListener('click', handleClick)
})

onUnmounted(() => {
  cancelAnimationFrame(animationId)
  canvasRef.value?.removeEventListener('mousedown', handleMouseDown)
  canvasRef.value?.removeEventListener('mousemove', handleMouseMove)
  canvasRef.value?.removeEventListener('mouseup', handleMouseUp)
  canvasRef.value?.removeEventListener('mouseleave', handleMouseUp)
  canvasRef.value?.removeEventListener('wheel', handleWheel)
  canvasRef.value?.removeEventListener('click', handleClick)
})
</script>

<template>
  <div class="h-[calc(100vh-5rem)] relative bg-[#050508]">
    <canvas ref="canvasRef" class="w-full h-full cursor-grab" />

    <!-- Selected star card -->
    <Transition name="fade">
      <div
        v-if="selectedStar"
        class="absolute bg-bg-elevated/95 backdrop-blur-sm border border-border-secondary rounded-xl p-4 shadow-xl max-w-xs z-10"
        :style="{ left: Math.min(selectedStar.x + 20, windowWidth - 300) + 'px', top: selectedStar.y - 20 + 'px' }"
      >
        <div class="flex items-center gap-2 mb-2">
          <div class="w-2 h-2 rounded-full" :style="{ backgroundColor: typeColors[selectedStar.type] }" />
          <span class="text-xs text-text-tertiary uppercase tracking-wider">{{ selectedStar.type }}</span>
        </div>
        <p class="text-sm text-text-primary">{{ selectedStar.text }}</p>
        <button
          @click="selectedStar = null"
          class="mt-3 text-xs text-text-tertiary hover:text-text-secondary"
        >
          Close
        </button>
      </div>
    </Transition>

    <!-- Controls -->
    <div class="absolute bottom-6 left-6 text-xs text-white/30 space-y-1">
      <p>Drag to pan</p>
      <p>Scroll to zoom</p>
      <p>Click star to view</p>
    </div>

    <!-- Zoom indicator -->
    <div class="absolute bottom-6 right-6 text-xs text-white/30">
      {{ Math.round(scale * 100) }}%
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
