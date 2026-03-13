<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useConversations } from '@/composables/useConversations'

marked.setOptions({ breaks: true, gfm: true })

const {
  conversations,
  activeConversationId,
  messages,
  isLoadingList,
  isLoadingMessages,
  isSending,
  error: chatError,
  fetchConversations,
  selectConversation,
  startConversation,
  sendMessage,
  deleteConversation,
  newChat,
} = useConversations()

const inputText = ref('')
const timeWindow = ref<string | undefined>(undefined)
const threadRef = ref<HTMLDivElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const expandedCitations = ref<Set<string>>(new Set())

const timeWindows = [
  { value: undefined, label: 'All time' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
]

const activeTitle = computed(() => {
  const conv = conversations.value.find(c => c.id === activeConversationId.value)
  return conv?.title || 'New conversation'
})

const formatTime = (date: string) => {
  const d = new Date(date)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (hours < 1) return 'now'
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const renderMarkdown = (text: string) => {
  return DOMPurify.sanitize(marked.parse(text) as string)
}

const toggleCitations = (messageId: string) => {
  if (expandedCitations.value.has(messageId)) {
    expandedCitations.value.delete(messageId)
  } else {
    expandedCitations.value.add(messageId)
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    if (threadRef.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  })
}

const handleSend = async () => {
  const text = inputText.value.trim()
  if (!text) return
  inputText.value = ''

  if (!activeConversationId.value) {
    await startConversation(text)
  } else {
    await sendMessage(text, timeWindow.value)
  }
  scrollToBottom()
}

// Auto-scroll on new messages
watch(messages, () => scrollToBottom(), { deep: true })

// Focus input when view loads
onMounted(() => {
  fetchConversations()
  nextTick(() => inputRef.value?.focus())
})
</script>

<template>
  <div class="h-screen flex">
    <!-- Sidebar -->
    <aside class="w-64 border-r border-border-secondary flex flex-col bg-bg-elevated flex-shrink-0">
      <div class="p-3 border-b border-border-secondary">
        <button
          @click="newChat"
          class="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary bg-bg-tertiary hover:bg-bg-tertiary/80 rounded-lg transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          New chat
        </button>
      </div>

      <div class="flex-1 overflow-auto py-2">
        <div v-if="isLoadingList" class="px-3 py-4 text-xs text-text-tertiary text-center">
          Loading...
        </div>
        <div v-else-if="conversations.length === 0" class="px-3 py-4 text-xs text-text-tertiary text-center">
          No conversations yet
        </div>
        <button
          v-for="conv in conversations"
          :key="conv.id"
          @click="selectConversation(conv.id)"
          :class="[
            'w-full text-left px-3 py-2.5 group transition-colors',
            activeConversationId === conv.id
              ? 'bg-bg-tertiary'
              : 'hover:bg-bg-tertiary/50'
          ]"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <p class="text-sm text-text-primary truncate">{{ conv.title }}</p>
              <p class="text-[11px] text-text-tertiary mt-0.5">
                {{ conv.messageCount }} messages · {{ formatTime(conv.updatedAt) }}
              </p>
            </div>
            <button
              @click.stop="deleteConversation(conv.id)"
              class="opacity-0 group-hover:opacity-100 text-text-tertiary hover:text-rose-400 transition-all flex-shrink-0 mt-0.5"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </button>
      </div>
    </aside>

    <!-- Main chat area -->
    <div class="flex-1 flex flex-col bg-bg-primary">
      <!-- Header -->
      <div v-if="activeConversationId" class="px-6 py-3 border-b border-border-secondary">
        <h2 class="text-sm font-medium text-text-primary">{{ activeTitle }}</h2>
      </div>

      <!-- Message thread -->
      <div ref="threadRef" class="flex-1 overflow-auto px-6 py-4">
        <!-- Empty state -->
        <div v-if="!activeConversationId && !isSending" class="h-full flex flex-col items-center justify-center">
          <div class="text-center max-w-md">
            <h2 class="text-lg font-semibold text-text-primary mb-2">Chat with your knowledge</h2>
            <p class="text-sm text-text-tertiary mb-8">
              Have a multi-turn conversation with your notes. Ask questions, follow up, and explore your thinking.
            </p>
          </div>
        </div>

        <!-- Loading messages -->
        <div v-else-if="isLoadingMessages" class="h-full flex items-center justify-center">
          <div class="text-text-tertiary text-sm">Loading messages...</div>
        </div>

        <!-- Messages -->
        <div v-else class="space-y-6 max-w-3xl mx-auto">
          <div
            v-for="msg in messages"
            :key="msg.id"
            :class="[
              'flex',
              msg.role === 'user' ? 'justify-end' : 'justify-start'
            ]"
          >
            <!-- User message -->
            <div
              v-if="msg.role === 'user'"
              class="max-w-[80%] bg-bg-tertiary rounded-2xl rounded-br-md px-4 py-3"
            >
              <p class="text-sm text-text-primary">{{ msg.content }}</p>
            </div>

            <!-- Assistant message -->
            <div
              v-else
              class="max-w-[85%] space-y-3"
            >
              <div
                class="prose prose-sm dark:prose-invert max-w-none prose-p:text-text-primary prose-headings:text-text-primary prose-code:text-emerald-600 dark:prose-code:text-emerald-400 prose-code:bg-bg-tertiary prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none"
                v-html="renderMarkdown(msg.content)"
              />

              <!-- Confidence + Citations toggle -->
              <div v-if="msg.citations?.length" class="flex items-center gap-3 text-[11px] text-text-tertiary">
                <div v-if="msg.confidence" class="flex items-center gap-1.5">
                  <div class="w-10 h-1 bg-bg-tertiary rounded-full overflow-hidden">
                    <div class="h-full bg-text-primary rounded-full" :style="{ width: `${msg.confidence * 100}%` }" />
                  </div>
                  <span>{{ Math.round(msg.confidence * 100) }}%</span>
                </div>
                <button
                  @click="toggleCitations(msg.id)"
                  class="text-text-tertiary hover:text-text-secondary transition-colors"
                >
                  {{ expandedCitations.has(msg.id) ? 'Hide' : 'Show' }} {{ msg.citations.length }} source{{ msg.citations.length !== 1 ? 's' : '' }}
                </button>
              </div>

              <!-- Expanded citations -->
              <div v-if="msg.citations?.length && expandedCitations.has(msg.id)" class="space-y-1.5">
                <div
                  v-for="citation in msg.citations"
                  :key="citation.id"
                  class="p-2.5 bg-bg-tertiary/50 rounded-lg"
                >
                  <p class="text-xs text-text-primary line-clamp-2">{{ citation.preview }}</p>
                  <div class="flex items-center gap-2 mt-1 text-[10px] text-text-tertiary">
                    <span class="uppercase">{{ citation.type }}</span>
                    <span>·</span>
                    <span>{{ Math.round(citation.score * 100) }}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Sending indicator -->
          <div v-if="isSending" class="flex justify-start">
            <div class="text-sm text-text-tertiary animate-pulse">Thinking...</div>
          </div>
        </div>
      </div>

      <!-- Input area -->
      <div class="border-t border-border-secondary px-6 py-4 bg-bg-elevated">
        <div class="max-w-3xl mx-auto">
          <div v-if="chatError" class="mb-3 px-4 py-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg">
            {{ chatError }}
          </div>
          <div class="flex gap-3">
            <input
              ref="inputRef"
              v-model="inputText"
              type="text"
              :placeholder="activeConversationId ? 'Ask a follow-up...' : 'Start a conversation...'"
              class="flex-1 bg-bg-tertiary border border-border-secondary rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-border-primary transition-colors"
              :disabled="isSending"
              @keydown.enter="handleSend"
            />
            <button
              @click="handleSend"
              :disabled="!inputText.trim() || isSending"
              class="px-4 py-2.5 bg-text-primary text-bg-primary rounded-xl text-sm font-medium disabled:opacity-50 transition-opacity"
            >
              Send
            </button>
          </div>
          <div class="flex gap-2 mt-2">
            <button
              v-for="tw in timeWindows"
              :key="tw.label"
              @click="timeWindow = tw.value"
              :class="[
                'px-2 py-1 text-[11px] rounded-md transition-colors',
                timeWindow === tw.value
                  ? 'bg-text-primary text-bg-primary'
                  : 'text-text-tertiary hover:text-text-secondary'
              ]"
            >
              {{ tw.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
