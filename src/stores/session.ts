import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { SessionConfig } from '@/types/session'

export const useSessionStore = defineStore('session', () => {
  const sessions = ref<SessionConfig[]>([])
  const currentSessionId = ref<string | null>(null)

  async function loadSessions() {
    try {
      const loadedSessions = await window.electronAPI.session.getAll()
      sessions.value = loadedSessions
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  async function createSession(config: Omit<SessionConfig, 'id' | 'createdAt' | 'updatedAt'>) {
    try {
      const result = await window.electronAPI.session.create(config)
      if (result.success) {
        sessions.value.push(result.data)
        return result.data
      } else {
        throw new Error(result.error || '创建会话失败')
      }
    } catch (error) {
      console.error('Failed to create session:', error)
      throw error
    }
  }

  async function updateSession(id: string, updates: Partial<SessionConfig>) {
    try {
      const result = await window.electronAPI.session.update(id, updates)
      if (!result.success) {
        throw new Error(result.error || '更新会话失败')
      }
      const index = sessions.value.findIndex((s) => s.id === id)
      if (index !== -1) {
        sessions.value[index] = { ...sessions.value[index], ...updates }
      }
    } catch (error) {
      console.error('Failed to update session:', error)
      throw error
    }
  }

  async function deleteSession(id: string) {
    try {
      await window.electronAPI.session.delete(id)
      sessions.value = sessions.value.filter((s) => s.id !== id)
    } catch (error) {
      console.error('Failed to delete session:', error)
      throw error
    }
  }

  function setCurrentSession(id: string | null) {
    currentSessionId.value = id
  }

  return {
    sessions,
    currentSessionId,
    loadSessions,
    createSession,
    updateSession,
    deleteSession,
    setCurrentSession
  }
})
