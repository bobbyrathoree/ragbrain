<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useThoughts } from '@/composables/useThoughts'

const { thoughts, fetchThoughts } = useThoughts()

const currentMonth = ref(new Date())
const selectedDate = ref<string | null>(null)

// Type colors
const typeColors: Record<string, string> = {
  thought: 'bg-stone-400',
  decision: 'bg-violet-500',
  insight: 'bg-sky-500',
  code: 'bg-emerald-500',
  todo: 'bg-amber-500',
  link: 'bg-rose-400',
}

// Group thoughts by date from API data
const thoughtsByDate = computed(() => {
  const grouped: Record<string, Array<{ id: string; text: string; type: string; time: string }>> = {}

  for (const thought of thoughts.value) {
    const date = thought.createdAt.split('T')[0] // YYYY-MM-DD
    const time = new Date(thought.createdAt).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })

    if (!grouped[date]) grouped[date] = []
    grouped[date].push({
      id: thought.id,
      text: thought.text,
      type: thought.type,
      time
    })
  }

  return grouped
})

onMounted(() => fetchThoughts())

const monthName = computed(() => {
  return currentMonth.value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
})

const heatmapData = computed(() => {
  const year = currentMonth.value.getFullYear()
  const month = currentMonth.value.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()

  const days: Array<{ date: string; count: number }> = []

  for (let i = 0; i < firstDay; i++) {
    days.push({ date: '', count: 0 })
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const dayThoughts = thoughtsByDate.value[dateStr] || []
    days.push({ date: dateStr, count: dayThoughts.length })
  }

  return days
})

const selectedDateThoughts = computed(() => {
  if (!selectedDate.value) return []
  return thoughtsByDate.value[selectedDate.value] || []
})

const formatSelectedDate = computed(() => {
  if (!selectedDate.value) return ''
  return new Date(selectedDate.value).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
})

const getOpacity = (count: number) => {
  if (count === 0) return 'opacity-[0.08]'
  if (count < 2) return 'opacity-25'
  if (count < 4) return 'opacity-50'
  if (count < 6) return 'opacity-75'
  return 'opacity-100'
}

const prevMonth = () => {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() - 1)
  selectedDate.value = null
}

const nextMonth = () => {
  currentMonth.value = new Date(currentMonth.value.getFullYear(), currentMonth.value.getMonth() + 1)
  selectedDate.value = null
}

const selectDate = (date: string) => {
  if (!date) return
  selectedDate.value = selectedDate.value === date ? null : date
}
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 sm:px-6">
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
      <!-- Heatmap -->
      <div>
        <!-- Month navigation -->
        <div class="flex items-center justify-between mb-6">
          <button @click="prevMonth" class="p-2 text-text-tertiary hover:text-text-primary transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 class="text-base font-medium text-text-primary">{{ monthName }}</h2>
          <button @click="nextMonth" class="p-2 text-text-tertiary hover:text-text-primary transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <!-- Day labels -->
        <div class="grid grid-cols-7 gap-1.5 mb-1.5">
          <div v-for="day in ['S', 'M', 'T', 'W', 'T', 'F', 'S']" :key="day" class="text-center text-[10px] text-text-tertiary py-1">
            {{ day }}
          </div>
        </div>

        <!-- Heatmap grid -->
        <div class="grid grid-cols-7 gap-1.5">
          <button
            v-for="(day, index) in heatmapData"
            :key="index"
            :class="[
              'aspect-square rounded-md transition-all',
              day.date ? 'cursor-pointer hover:ring-1 hover:ring-text-primary/30' : 'cursor-default',
              day.date === selectedDate ? 'ring-2 ring-text-primary' : '',
              day.date ? `bg-text-primary ${getOpacity(day.count)}` : 'bg-transparent'
            ]"
            :disabled="!day.date"
            @click="selectDate(day.date)"
          />
        </div>

        <!-- Legend -->
        <div class="flex items-center justify-end gap-1.5 mt-4 text-[10px] text-text-tertiary">
          <span>Less</span>
          <div class="w-2.5 h-2.5 rounded-sm bg-text-primary opacity-[0.08]" />
          <div class="w-2.5 h-2.5 rounded-sm bg-text-primary opacity-25" />
          <div class="w-2.5 h-2.5 rounded-sm bg-text-primary opacity-50" />
          <div class="w-2.5 h-2.5 rounded-sm bg-text-primary opacity-75" />
          <div class="w-2.5 h-2.5 rounded-sm bg-text-primary" />
          <span>More</span>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-3 mt-8">
          <div class="text-center p-3 bg-bg-tertiary/50 rounded-lg">
            <div class="text-xl font-semibold text-text-primary">127</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">Total</div>
          </div>
          <div class="text-center p-3 bg-bg-tertiary/50 rounded-lg">
            <div class="text-xl font-semibold text-text-primary">23</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">Days</div>
          </div>
          <div class="text-center p-3 bg-bg-tertiary/50 rounded-lg">
            <div class="text-xl font-semibold text-text-primary">12</div>
            <div class="text-[10px] text-text-tertiary mt-0.5">Streak</div>
          </div>
        </div>
      </div>

      <!-- Thought stream -->
      <div>
        <Transition name="slide" mode="out-in">
          <div v-if="selectedDate" :key="selectedDate">
            <h3 class="text-sm font-medium text-text-primary mb-1">{{ formatSelectedDate }}</h3>
            <p class="text-xs text-text-tertiary mb-4">{{ selectedDateThoughts.length }} thoughts</p>

            <div v-if="selectedDateThoughts.length" class="space-y-3">
              <div
                v-for="thought in selectedDateThoughts"
                :key="thought.id"
                class="relative pl-4 py-2 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:rounded-full"
                :class="typeColors[thought.type] ? `before:${typeColors[thought.type]}` : 'before:bg-stone-400'"
              >
                <p class="text-sm text-text-primary">{{ thought.text }}</p>
                <div class="flex items-center gap-2 mt-1 text-[10px] text-text-tertiary">
                  <span class="uppercase tracking-wider">{{ thought.type }}</span>
                  <span>·</span>
                  <span>{{ thought.time }}</span>
                </div>
              </div>
            </div>

            <div v-else class="text-sm text-text-tertiary py-8 text-center">
              No thoughts on this day
            </div>
          </div>

          <div v-else class="text-center py-16">
            <p class="text-sm text-text-tertiary">Select a day to see thoughts</p>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

/* Dynamic type colors for before pseudo-element */
.before\:bg-stone-400::before { background-color: #a1a1aa; }
.before\:bg-violet-500::before { background-color: #8b5cf6; }
.before\:bg-sky-500::before { background-color: #0ea5e9; }
.before\:bg-emerald-500::before { background-color: #10b981; }
.before\:bg-amber-500::before { background-color: #f59e0b; }
.before\:bg-rose-400::before { background-color: #fb7185; }
</style>
