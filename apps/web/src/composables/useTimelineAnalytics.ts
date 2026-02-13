import { computed, type Ref } from 'vue'
import type { Thought } from '@/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TYPE_COLORS: Record<string, string> = {
  thought: '#a1a1aa',
  decision: '#8b5cf6',
  insight: '#0ea5e9',
  code: '#10b981',
  todo: '#f59e0b',
  link: '#fb7185',
}

function getWeekKey(date: Date): string {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dayOfWeek = d.getDay()
  d.setDate(d.getDate() - dayOfWeek) // Start of week (Sunday)
  return d.toISOString().split('T')[0]
}

function getDateKey(date: Date): string {
  return date.toISOString().split('T')[0]
}

function filterByTimeRange(thoughts: Thought[], range: string): Thought[] {
  if (range === 'all') return thoughts
  const now = new Date()
  const days = range === '1w' ? 7 : range === '1m' ? 30 : 90
  const cutoff = new Date(now.getTime() - days * 86400000)
  return thoughts.filter(t => new Date(t.createdAt) >= cutoff)
}

export function useTimelineAnalytics(thoughts: Ref<Thought[]>, timeRange: Ref<string>) {
  const filtered = computed(() => filterByTimeRange(thoughts.value, timeRange.value))

  // Weekly velocity - count per week for last 8 weeks
  const weeklyVelocity = computed(() => {
    const weeks: Record<string, number> = {}
    const now = new Date()
    // Initialize last 8 weeks
    for (let i = 0; i < 8; i++) {
      const d = new Date(now.getTime() - i * 7 * 86400000)
      weeks[getWeekKey(d)] = 0
    }
    thoughts.value.forEach(t => {
      const key = getWeekKey(new Date(t.createdAt))
      if (key in weeks) weeks[key]++
    })
    return Object.entries(weeks)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, count]) => ({ week, count }))
  })

  // Velocity trend - this week vs last week
  const velocityTrend = computed<'up' | 'down' | 'stable'>(() => {
    const v = weeklyVelocity.value
    if (v.length < 2) return 'stable'
    const current = v[v.length - 1].count
    const previous = v[v.length - 2].count
    if (current > previous) return 'up'
    if (current < previous) return 'down'
    return 'stable'
  })

  // This week's count
  const thisWeekCount = computed(() => {
    const v = weeklyVelocity.value
    return v.length > 0 ? v[v.length - 1].count : 0
  })

  // Current streak - consecutive days with at least 1 thought
  const currentStreak = computed(() => {
    const byDate = new Map<string, number>()
    thoughts.value.forEach(t => {
      const key = getDateKey(new Date(t.createdAt))
      byDate.set(key, (byDate.get(key) || 0) + 1)
    })

    let streak = 0
    const now = new Date()
    const todayKey = getDateKey(now)

    // If today has thoughts, start counting from today
    // Otherwise start from yesterday
    let checkDate = new Date(now)
    if (!byDate.has(todayKey)) {
      checkDate.setDate(checkDate.getDate() - 1)
    }

    for (let i = 0; i < 365; i++) {
      const key = getDateKey(checkDate)
      if (byDate.has(key)) {
        streak++
        checkDate.setDate(checkDate.getDate() - 1)
      } else {
        break
      }
    }
    return streak
  })

  // Most active day of week
  const mostActiveDay = computed(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    filtered.value.forEach(t => {
      counts[new Date(t.createdAt).getDay()]++
    })
    const maxIdx = counts.indexOf(Math.max(...counts))
    return { day: DAYS[maxIdx], distribution: counts }
  })

  // Top type this period
  const topType = computed(() => {
    const counts: Record<string, number> = {}
    filtered.value.forEach(t => {
      counts[t.type] = (counts[t.type] || 0) + 1
    })
    const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a)
    return sorted.length > 0
      ? { type: sorted[0][0], count: sorted[0][1], color: TYPE_COLORS[sorted[0][0]] || '#666' }
      : { type: 'none', count: 0, color: '#666' }
  })

  // Tag trends - top 8 with period-over-period comparison
  const tagTrends = computed(() => {
    const now = new Date()
    const halfRange = timeRange.value === '1w' ? 7 : timeRange.value === '1m' ? 15 : 45
    const midpoint = new Date(now.getTime() - halfRange * 86400000)
    const start = new Date(now.getTime() - halfRange * 2 * 86400000)

    const current: Record<string, number> = {}
    const previous: Record<string, number> = {}

    thoughts.value.forEach(t => {
      const d = new Date(t.createdAt)
      const tags = t.tags || []
      tags.forEach(tag => {
        if (d >= midpoint) current[tag] = (current[tag] || 0) + 1
        else if (d >= start) previous[tag] = (previous[tag] || 0) + 1
      })
    })

    return Object.entries(current)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([tag, count]) => {
        const prev = previous[tag] || 0
        const trend: 'up' | 'down' | 'stable' = count > prev ? 'up' : count < prev ? 'down' : 'stable'
        return { tag, count, trend }
      })
  })

  // Decisions - newest first
  const decisions = computed(() =>
    filtered.value
      .filter(t => t.type === 'decision')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  )

  // Open TODOs
  const openTodos = computed(() =>
    filtered.value
      .filter(t => t.type === 'todo')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  )

  // Thoughts grouped by date
  const thoughtsByDate = computed(() => {
    const groups: Record<string, Thought[]> = {}
    filtered.value
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .forEach(t => {
        const key = getDateKey(new Date(t.createdAt))
        if (!groups[key]) groups[key] = []
        groups[key].push(t)
      })
    return groups
  })

  return {
    filtered,
    weeklyVelocity,
    velocityTrend,
    thisWeekCount,
    currentStreak,
    mostActiveDay,
    topType,
    tagTrends,
    decisions,
    openTodos,
    thoughtsByDate,
    TYPE_COLORS,
  }
}
