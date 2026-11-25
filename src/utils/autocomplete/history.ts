import { ref } from 'vue'
import { isSingleLineCommand } from './input'

export const completionHistory = ref<string[]>([])
let epoch = 0
let loadedAt = 0
let pending: Promise<string[]> | undefined
let unsubscribe: (() => void) | undefined
let consumers = 0

export function loadCompletionHistory(force = false): Promise<string[]> {
  if (!force && pending) return pending
  if (!force && loadedAt && Date.now() - loadedAt < 5000)
    return Promise.resolve(completionHistory.value)
  const version = ++epoch
  const request = Promise.resolve().then(async () => {
    try {
      const result = await window.electronAPI.commandHistory.getRecentUnique(100)
      if (version === epoch && result.success && result.data) {
        completionHistory.value = result.data.filter(isSingleLineCommand)
        loadedAt = Date.now()
      }
    } catch {
      /* Keep the previous snapshot; the next input can retry. */
    } finally {
      if (version === epoch) pending = undefined
    }
    return completionHistory.value
  })
  pending = request
  return request
}

export function retainCompletionHistory() {
  consumers++
  if (!unsubscribe)
    unsubscribe = window.electronAPI.commandHistory.onChanged?.(() => {
      loadedAt = 0
      void loadCompletionHistory(true)
    })
  void loadCompletionHistory()
  return () => {
    if (--consumers === 0) {
      unsubscribe?.()
      unsubscribe = undefined
      epoch++
      pending = undefined
      loadedAt = 0
      completionHistory.value = []
    }
  }
}
