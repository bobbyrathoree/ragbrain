import { ref } from 'vue'
import { conversationsApi } from '@/api'
import type { ConversationSummary, ConversationMessage } from '@/types'

const conversations = ref<ConversationSummary[]>([])
const activeConversationId = ref<string | null>(null)
const messages = ref<ConversationMessage[]>([])
const isLoadingList = ref(false)
const isLoadingMessages = ref(false)
const isSending = ref(false)
const error = ref<string | null>(null)

export function useConversations() {
  const fetchConversations = async () => {
    isLoadingList.value = true
    error.value = null
    try {
      const response = await conversationsApi.list()
      conversations.value = response.conversations
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load conversations'
    } finally {
      isLoadingList.value = false
    }
  }

  const selectConversation = async (id: string) => {
    activeConversationId.value = id
    isLoadingMessages.value = true
    error.value = null
    try {
      const response = await conversationsApi.get(id)
      messages.value = response.messages
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load conversation'
      messages.value = []
    } finally {
      isLoadingMessages.value = false
    }
  }

  const startConversation = async (message: string) => {
    isSending.value = true
    error.value = null
    try {
      const response = await conversationsApi.create(message)
      activeConversationId.value = response.id

      // If the API returned messages (from initialMessage), use them
      if (response.messages && response.messages.length > 0) {
        messages.value = response.messages
      } else {
        // Otherwise load them
        await selectConversation(response.id)
      }

      // Refresh the sidebar list
      await fetchConversations()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to start conversation'
      throw e
    } finally {
      isSending.value = false
    }
  }

  const sendMessage = async (content: string, timeWindow?: string) => {
    if (!activeConversationId.value) return
    isSending.value = true
    error.value = null

    // Optimistic: add user message immediately
    const tempUserMsg: ConversationMessage = {
      id: `temp_${Date.now()}`,
      conversationId: activeConversationId.value,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    messages.value.push(tempUserMsg)

    try {
      const response = await conversationsApi.sendMessage(
        activeConversationId.value,
        content,
        timeWindow
      )

      // Replace temp message with real one, add assistant response
      const tempIdx = messages.value.findIndex(m => m.id === tempUserMsg.id)
      if (tempIdx !== -1) {
        messages.value[tempIdx] = response.userMessage
      }
      messages.value.push(response.assistantMessage)

      // Update conversation in sidebar (message count, updatedAt)
      const conv = conversations.value.find(c => c.id === activeConversationId.value)
      if (conv) {
        conv.messageCount += 2
        conv.updatedAt = new Date().toISOString()
      }
    } catch (e) {
      // Remove optimistic message on failure
      messages.value = messages.value.filter(m => m.id !== tempUserMsg.id)
      error.value = e instanceof Error ? e.message : 'Failed to send message'
      throw e
    } finally {
      isSending.value = false
    }
  }

  const deleteConversation = async (id: string) => {
    try {
      await conversationsApi.remove(id)
      conversations.value = conversations.value.filter(c => c.id !== id)
      if (activeConversationId.value === id) {
        activeConversationId.value = null
        messages.value = []
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete conversation'
    }
  }

  const newChat = () => {
    activeConversationId.value = null
    messages.value = []
  }

  return {
    conversations,
    activeConversationId,
    messages,
    isLoadingList,
    isLoadingMessages,
    isSending,
    error,
    fetchConversations,
    selectConversation,
    startConversation,
    sendMessage,
    deleteConversation,
    newChat,
  }
}
