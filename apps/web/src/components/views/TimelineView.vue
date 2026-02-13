<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useThoughts } from '@/composables/useThoughts'
import { useTimelineAnalytics } from '@/composables/useTimelineAnalytics'

const { thoughts, isLoading, fetchThoughts } = useThoughts()
const timeRange = ref<string>('all')

const {
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
} = useTimelineAnalytics(thoughts, timeRange)

const timeRanges = [
  { value: '1w', label: '1W' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: 'all', label: 'All' },
]

const typeLabelColors: Record<string, string> = {
  thought: 'text-stone-400',
  decision: 'text-violet-400',
  insight: 'text-sky-400',
  code: 'text-emerald-400',
  todo: 'text-amber-400',
  link: 'text-rose-400',
}

const typeAccentBg: Record<string, string> = {
  thought: 'bg-stone-400',
  decision: 'bg-violet-500',
  insight: 'bg-sky-500',
  code: 'bg-emerald-500',
  todo: 'bg-amber-500',
  link: 'bg-rose-400',
}

// Sparkline SVG path from velocity data
const sparklinePath = computed(() => {
  const data = weeklyVelocity.value
  if (data.length < 2) return ''
  const max = Math.max(...data.map(d => d.count), 1)
  const w = 80, h = 24
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (d.count / max) * h
    return `${x},${y}`
  })
  return `M${points.join('L')}`
})

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr + 'T00:00:00')
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0]
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

const formatTime = (date: string) => {
  return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const todoAge = (date: string) => {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

const todoAgeClass = (date: string) => {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days > 30) return 'border-l-2 border-rose-500/50'
  if (days > 7) return 'border-l-2 border-amber-500/50'
  return ''
}

onMounted(() => {
  fetchThoughts(200)
})
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6 pt-20 pb-24">
    <!-- Loading -->
    <div v-if="isLoading" class="text-center py-16">
      <div class="text-text-tertiary text-sm">Loading brain pulse...</div>
    </div>

    <template v-else>
      <!-- Time Range Selector -->
      <div class="flex justify-center mb-8">
        <div class="flex items-center gap-1 px-2 py-1.5 bg-bg-elevated/80 backdrop-blur-xl border border-border-secondary rounded-full">
          <button
            v-for="tr in timeRanges"
            :key="tr.value"
            @click="timeRange = tr.value"
            :class="[
              'px-3 py-1 text-xs font-medium rounded-full transition-all',
              timeRange === tr.value
                ? 'bg-text-primary text-bg-primary'
                : 'text-text-tertiary hover:text-text-secondary'
            ]"
          >
            {{ tr.label }}
          </button>
        </div>
      </div>

      <!-- Section 1: Pulse Header -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <!-- Velocity -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-4">
          <div class="text-xs text-text-tertiary uppercase tracking-wider mb-2">Velocity</div>
          <div class="flex items-end gap-3">
            <span class="text-2xl font-bold text-text-primary">{{ thisWeekCount }}</span>
            <span class="text-xs text-text-tertiary mb-1">/week</span>
            <span :class="[
              'text-xs mb-1 font-medium',
              velocityTrend === 'up' ? 'text-emerald-400' : velocityTrend === 'down' ? 'text-rose-400' : 'text-text-tertiary'
            ]">
              {{ velocityTrend === 'up' ? '↑' : velocityTrend === 'down' ? '↓' : '→' }}
            </span>
          </div>
          <svg class="w-full h-6 mt-2" viewBox="0 0 80 24" preserveAspectRatio="none">
            <path :d="sparklinePath" fill="none" stroke="currentColor" stroke-width="1.5" class="text-text-tertiary" />
          </svg>
        </div>

        <!-- Most Active Day -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-4">
          <div class="text-xs text-text-tertiary uppercase tracking-wider mb-2">Peak Day</div>
          <div class="text-2xl font-bold text-text-primary">{{ mostActiveDay.day }}</div>
          <div class="flex gap-1 mt-2">
            <div
              v-for="(count, i) in mostActiveDay.distribution"
              :key="i"
              class="flex-1 rounded-sm"
              :style="{
                height: Math.max(4, (count / Math.max(...mostActiveDay.distribution, 1)) * 20) + 'px',
                backgroundColor: count === Math.max(...mostActiveDay.distribution) ? 'var(--text-primary)' : 'var(--bg-tertiary)'
              }"
            />
          </div>
        </div>

        <!-- Streak -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-4">
          <div class="text-xs text-text-tertiary uppercase tracking-wider mb-2">Streak</div>
          <div class="flex items-end gap-2">
            <span class="text-2xl font-bold text-text-primary">{{ currentStreak }}</span>
            <span class="text-xs text-text-tertiary mb-1">days</span>
            <span class="text-lg mb-0.5" :style="{ opacity: Math.min(1, 0.3 + currentStreak * 0.15) }">🔥</span>
          </div>
        </div>

        <!-- Top Type -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-4">
          <div class="text-xs text-text-tertiary uppercase tracking-wider mb-2">Top Type</div>
          <div class="flex items-end gap-2">
            <div :class="['w-3 h-3 rounded-full mb-1', typeAccentBg[topType.type] || 'bg-stone-400']" />
            <span class="text-2xl font-bold text-text-primary capitalize">{{ topType.type }}</span>
          </div>
          <div class="text-xs text-text-tertiary mt-1">{{ topType.count }} this period</div>
        </div>
      </div>

      <!-- Section 3: Tag Trends -->
      <div v-if="tagTrends.length > 0" class="bg-bg-elevated border-2 border-border-primary rounded-xl p-5 mb-8">
        <h3 class="text-xs text-text-tertiary uppercase tracking-wider mb-4">Trending Topics</h3>
        <div class="space-y-3">
          <div v-for="tag in tagTrends" :key="tag.tag" class="flex items-center gap-3">
            <span class="text-xs text-text-secondary w-24 truncate font-mono">#{{ tag.tag }}</span>
            <div class="flex-1 h-2 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                class="h-full bg-text-primary/60 rounded-full transition-all duration-500"
                :style="{ width: `${(tag.count / Math.max(...tagTrends.map(t => t.count), 1)) * 100}%` }"
              />
            </div>
            <span class="text-xs text-text-tertiary w-6 text-right">{{ tag.count }}</span>
            <span :class="[
              'text-xs w-4',
              tag.trend === 'up' ? 'text-emerald-400' : tag.trend === 'down' ? 'text-rose-400' : 'text-text-tertiary'
            ]">
              {{ tag.trend === 'up' ? '↑' : tag.trend === 'down' ? '↓' : '→' }}
            </span>
          </div>
        </div>
      </div>
      <div v-else class="bg-bg-elevated border-2 border-border-primary rounded-xl p-5 mb-8 text-center">
        <p class="text-text-tertiary text-sm">Add #tags to your thoughts to see topic trends here.</p>
      </div>

      <!-- Section 4: Decision Log + Open TODOs -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <!-- Decision Log -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-5">
          <h3 class="text-xs text-text-tertiary uppercase tracking-wider mb-4">Decision Log</h3>
          <div v-if="decisions.length === 0" class="text-xs text-text-tertiary py-4 text-center">
            No decisions captured yet
          </div>
          <div v-else class="space-y-0">
            <div v-for="(d, i) in decisions.slice(0, 8)" :key="d.id" class="flex gap-3">
              <div class="flex flex-col items-center">
                <div class="w-2.5 h-2.5 rounded-full bg-violet-500 flex-shrink-0 mt-1.5" />
                <div v-if="i < Math.min(decisions.length, 8) - 1" class="w-0.5 flex-1 bg-violet-500/20 my-1" />
              </div>
              <div class="pb-4 min-w-0">
                <p class="text-sm text-text-primary line-clamp-2">{{ d.text }}</p>
                <p class="text-[10px] text-text-tertiary mt-1">
                  {{ new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Open TODOs -->
        <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-5">
          <h3 class="text-xs text-text-tertiary uppercase tracking-wider mb-4">Open TODOs</h3>
          <div v-if="openTodos.length === 0" class="text-xs text-text-tertiary py-4 text-center">
            No open TODOs
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="todo in openTodos.slice(0, 8)"
              :key="todo.id"
              :class="['flex items-start gap-3 p-2 rounded-lg', todoAgeClass(todo.createdAt)]"
            >
              <div class="w-4 h-4 rounded-full border-2 border-amber-500/60 flex-shrink-0 mt-0.5" />
              <div class="min-w-0 flex-1">
                <p class="text-sm text-text-primary line-clamp-2">{{ todo.text }}</p>
                <p class="text-[10px] text-text-tertiary mt-0.5">{{ todoAge(todo.createdAt) }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Section 5: Activity Stream -->
      <div class="bg-bg-elevated border-2 border-border-primary rounded-xl p-5">
        <h3 class="text-xs text-text-tertiary uppercase tracking-wider mb-4">Activity Stream</h3>
        <div v-if="Object.keys(thoughtsByDate).length === 0" class="text-xs text-text-tertiary py-4 text-center">
          No activity in this period
        </div>
        <div v-else class="space-y-1 max-h-[500px] overflow-y-auto">
          <template v-for="(dateThoughts, dateKey) in thoughtsByDate" :key="dateKey">
            <!-- Date header -->
            <div class="sticky top-0 bg-bg-elevated py-2 flex items-center gap-3 z-10">
              <span class="text-xs font-semibold text-text-secondary">{{ formatDate(dateKey) }}</span>
              <span class="text-[10px] text-text-tertiary">{{ dateThoughts.length }} thoughts</span>
              <div class="flex gap-0.5">
                <div
                  v-for="t in dateThoughts.slice(0, 6)"
                  :key="t.id"
                  :class="['w-1.5 h-1.5 rounded-full', typeAccentBg[t.type] || 'bg-stone-400']"
                />
              </div>
            </div>
            <!-- Thoughts for this date -->
            <div
              v-for="t in dateThoughts"
              :key="t.id"
              class="flex items-start gap-3 py-1.5 px-2 rounded-lg hover:bg-bg-tertiary/50 transition-colors"
            >
              <span class="text-[10px] text-text-tertiary w-14 flex-shrink-0 mt-0.5">{{ formatTime(t.createdAt) }}</span>
              <span :class="[
                'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0',
                typeLabelColors[t.type] || 'text-stone-400'
              ]">{{ t.type }}</span>
              <p class="text-sm text-text-primary truncate flex-1 min-w-0">{{ t.text }}</p>
              <div v-if="t.tags?.length" class="flex gap-1 flex-shrink-0">
                <span v-for="tag in t.tags.slice(0, 2)" :key="tag" class="text-[9px] text-text-tertiary">#{{ tag }}</span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
