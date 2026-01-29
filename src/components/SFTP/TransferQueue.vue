<template>
  <div class="transfer-queue">
    <div class="queue-header">
      <h3>传输队列</h3>
      <div class="queue-actions">
        <button @click="pauseAll" class="btn-secondary" :disabled="!hasActiveTransfers">
          ⏸️ 全部暂停
        </button>
        <button @click="resumeAll" class="btn-secondary" :disabled="!hasPausedTransfers">
          ▶️ 全部恢复
        </button>
        <button @click="clearCompleted" class="btn-secondary">
          🗑️ 清除已完成
        </button>
      </div>
    </div>

    <div class="queue-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        :class="['tab', { active: activeTab === tab.value }]"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
        <span v-if="tab.count > 0" class="badge">{{ tab.count }}</span>
      </button>
    </div>

    <div class="queue-list">
      <div v-if="filteredTasks.length === 0" class="empty-state">
        <div class="empty-icon">📦</div>
        <p>{{ emptyMessage }}</p>
      </div>

      <div
        v-for="task in filteredTasks"
        :key="task.id"
        class="transfer-item"
        :class="task.status"
      >
        <div class="transfer-icon">
          {{ task.type === 'upload' ? '⬆️' : '⬇️' }}
        </div>

        <div class="transfer-info">
          <div class="transfer-name">
            {{ getFileName(task.type === 'upload' ? task.localPath : task.remotePath) }}
          </div>
          <div class="transfer-path">
            {{ task.type === 'upload' ? task.remotePath : task.localPath }}
          </div>

          <div v-if="task.status === 'active'" class="transfer-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${task.progress.percentage}%` }"></div>
            </div>
            <div class="progress-info">
              <span>{{ formatSize(task.progress.transferred) }} / {{ formatSize(task.progress.total) }}</span>
              <span>{{ formatSpeed(task.progress.speed) }}</span>
              <span>剩余 {{ formatTime(task.progress.eta) }}</span>
            </div>
          </div>

          <div v-else-if="task.status === 'completed'" class="transfer-status">
            ✅ 传输完成
          </div>

          <div v-else-if="task.status === 'failed'" class="transfer-status error">
            ❌ {{ task.error || '传输失败' }}
          </div>

          <div v-else-if="task.status === 'paused'" class="transfer-status">
            ⏸️ 已暂停
          </div>

          <div v-else-if="task.status === 'cancelled'" class="transfer-status">
            🚫 已取消
          </div>
        </div>

        <div class="transfer-actions">
          <button
            v-if="task.status === 'active'"
            @click="pauseTask(task.id)"
            class="btn-icon"
            title="暂停"
          >
            ⏸️
          </button>

          <button
            v-if="task.status === 'paused'"
            @click="resumeTask(task.id)"
            class="btn-icon"
            title="恢复"
          >
            ▶️
          </button>

          <button
            v-if="task.status === 'active' || task.status === 'paused'"
            @click="cancelTask(task.id)"
            class="btn-icon"
            title="取消"
          >
            ✖️
          </button>

          <button
            v-if="task.status === 'failed'"
            @click="retryTask(task)"
            class="btn-icon"
            title="重试"
          >
            🔄
          </button>

          <button
            v-if="task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled'"
            @click="removeTask(task.id)"
            class="btn-icon"
            title="移除"
          >
            🗑️
          </button>

          <!-- 优先级调整 -->
          <button
            v-if="task.status === 'pending' || task.status === 'paused'"
            @click="moveUp(task.id)"
            class="btn-icon"
            title="提高优先级"
            :disabled="isFirst(task.id)"
          >
            ⬆️
          </button>

          <button
            v-if="task.status === 'pending' || task.status === 'paused'"
            @click="moveDown(task.id)"
            class="btn-icon"
            title="降低优先级"
            :disabled="isLast(task.id)"
          >
            ⬇️
          </button>
        </div>
      </div>
    </div>

    <!-- 传输历史 -->
    <div v-if="activeTab === 'history'" class="history-actions">
      <button @click="exportHistory" class="btn-secondary">
        📤 导出历史
      </button>
      <button @click="clearHistory" class="btn-secondary">
        🗑️ 清空历史
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface TransferTask {
  id: string
  type: 'upload' | 'download'
  localPath: string
  remotePath: string
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: {
    transferred: number
    total: number
    percentage: number
    speed: number
    eta: number
  }
  error?: string
  priority?: number
  createdAt?: string
}

interface Props {
  connectionId: string
}

const props = defineProps<Props>()

const tasks = ref<TransferTask[]>([])
const activeTab = ref<'all' | 'active' | 'completed' | 'failed' | 'history'>('all')
const history = ref<TransferTask[]>([])

// 标签页配置
const tabs = computed(() => [
  { label: '全部', value: 'all', count: tasks.value.length },
  { label: '进行中', value: 'active', count: activeTasks.value.length },
  { label: '已完成', value: 'completed', count: completedTasks.value.length },
  { label: '失败', value: 'failed', count: failedTasks.value.length },
  { label: '历史记录', value: 'history', count: history.value.length }
])

// 过滤任务
const filteredTasks = computed(() => {
  if (activeTab.value === 'history') {
    return history.value
  }

  let filtered = tasks.value

  if (activeTab.value === 'active') {
    filtered = filtered.filter(t => t.status === 'active' || t.status === 'pending' || t.status === 'paused')
  } else if (activeTab.value === 'completed') {
    filtered = filtered.filter(t => t.status === 'completed')
  } else if (activeTab.value === 'failed') {
    filtered = filtered.filter(t => t.status === 'failed')
  }

  // 按优先级和创建时间排序
  return filtered.sort((a, b) => {
    if (a.priority !== b.priority) {
      return (b.priority || 0) - (a.priority || 0)
    }
    return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  })
})

const activeTasks = computed(() => 
  tasks.value.filter(t => t.status === 'active' || t.status === 'pending' || t.status === 'paused')
)

const completedTasks = computed(() => 
  tasks.value.filter(t => t.status === 'completed')
)

const failedTasks = computed(() => 
  tasks.value.filter(t => t.status === 'failed')
)

const hasActiveTransfers = computed(() => 
  tasks.value.some(t => t.status === 'active')
)

const hasPausedTransfers = computed(() => 
  tasks.value.some(t => t.status === 'paused')
)

const emptyMessage = computed(() => {
  if (activeTab.value === 'active') return '没有进行中的传输'
  if (activeTab.value === 'completed') return '没有已完成的传输'
  if (activeTab.value === 'failed') return '没有失败的传输'
  if (activeTab.value === 'history') return '没有历史记录'
  return '没有传输任务'
})

// 获取文件名
const getFileName = (path: string): string => {
  return path.split('/').pop() || path.split('\\').pop() || path
}

// 格式化文件大小
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// 格式化速度
const formatSpeed = (bytesPerSecond: number): string => {
  return `${formatSize(bytesPerSecond)}/s`
}

// 格式化时间
const formatTime = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}秒`
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`
  return `${Math.round(seconds / 3600)}小时`
}

// 暂停任务
const pauseTask = async (taskId: string) => {
  try {
    const result = await window.electronAPI.sftp.pauseTransfer(taskId)
    if (result.success) {
      const task = tasks.value.find(t => t.id === taskId)
      if (task) {
        task.status = 'paused'
      }
    }
  } catch (error) {
    console.error('Failed to pause task:', error)
  }
}

// 恢复任务
const resumeTask = async (taskId: string) => {
  try {
    const result = await window.electronAPI.sftp.resumeTransfer(props.connectionId, taskId)
    if (result.success) {
      const task = tasks.value.find(t => t.id === taskId)
      if (task) {
        task.status = 'active'
      }
    }
  } catch (error) {
    console.error('Failed to resume task:', error)
  }
}

// 取消任务
const cancelTask = async (taskId: string) => {
  try {
    const result = await window.electronAPI.sftp.cancelTask(taskId)
    if (result.success) {
      const task = tasks.value.find(t => t.id === taskId)
      if (task) {
        task.status = 'cancelled'
        // 移动到历史记录
        setTimeout(() => {
          moveToHistory(task)
        }, 2000)
      }
    }
  } catch (error) {
    console.error('Failed to cancel task:', error)
  }
}

// 重试任务
const retryTask = async (task: TransferTask) => {
  try {
    if (task.type === 'upload') {
      await window.electronAPI.sftp.uploadFile(props.connectionId, task.localPath, task.remotePath)
    } else {
      await window.electronAPI.sftp.downloadFile(props.connectionId, task.remotePath, task.localPath)
    }
    // 移除失败的任务
    removeTask(task.id)
  } catch (error) {
    console.error('Failed to retry task:', error)
  }
}

// 移除任务
const removeTask = (taskId: string) => {
  const index = tasks.value.findIndex(t => t.id === taskId)
  if (index !== -1) {
    const task = tasks.value[index]
    // 如果是已完成或失败的任务，移动到历史记录
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      moveToHistory(task)
    }
    tasks.value.splice(index, 1)
  }
}

// 移动到历史记录
const moveToHistory = (task: TransferTask) => {
  if (!history.value.find(t => t.id === task.id)) {
    history.value.unshift(task)
    // 限制历史记录数量
    if (history.value.length > 100) {
      history.value = history.value.slice(0, 100)
    }
    // 保存到本地存储
    saveHistory()
  }
}

// 全部暂停
const pauseAll = async () => {
  for (const task of tasks.value) {
    if (task.status === 'active') {
      await pauseTask(task.id)
    }
  }
}

// 全部恢复
const resumeAll = async () => {
  for (const task of tasks.value) {
    if (task.status === 'paused') {
      await resumeTask(task.id)
    }
  }
}

// 清除已完成
const clearCompleted = () => {
  const completed = tasks.value.filter(t => t.status === 'completed')
  completed.forEach(task => {
    moveToHistory(task)
  })
  tasks.value = tasks.value.filter(t => t.status !== 'completed')
}

// 提高优先级
const moveUp = (taskId: string) => {
  const index = filteredTasks.value.findIndex(t => t.id === taskId)
  if (index > 0) {
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      task.priority = (task.priority || 0) + 1
    }
  }
}

// 降低优先级
const moveDown = (taskId: string) => {
  const index = filteredTasks.value.findIndex(t => t.id === taskId)
  if (index < filteredTasks.value.length - 1) {
    const task = tasks.value.find(t => t.id === taskId)
    if (task) {
      task.priority = (task.priority || 0) - 1
    }
  }
}

// 是否是第一个
const isFirst = (taskId: string): boolean => {
  return filteredTasks.value[0]?.id === taskId
}

// 是否是最后一个
const isLast = (taskId: string): boolean => {
  return filteredTasks.value[filteredTasks.value.length - 1]?.id === taskId
}

// 导出历史
const exportHistory = async () => {
  try {
    const filePath = await window.electronAPI.dialog.saveFile({
      defaultPath: `transfer-history-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (filePath) {
      const data = JSON.stringify(history.value, null, 2)
      // TODO: 实现文件保存
      console.log('Export history to:', filePath)
    }
  } catch (error) {
    console.error('Failed to export history:', error)
  }
}

// 清空历史
const clearHistory = () => {
  if (confirm('确定要清空所有历史记录吗？')) {
    history.value = []
    saveHistory()
  }
}

// 保存历史到本地存储
const saveHistory = () => {
  try {
    localStorage.setItem('transfer-history', JSON.stringify(history.value))
  } catch (error) {
    console.error('Failed to save history:', error)
  }
}

// 加载历史
const loadHistory = () => {
  try {
    const saved = localStorage.getItem('transfer-history')
    if (saved) {
      history.value = JSON.parse(saved)
    }
  } catch (error) {
    console.error('Failed to load history:', error)
  }
}

// 加载任务
const loadTasks = async () => {
  try {
    const result = await window.electronAPI.sftp.getAllTasks()
    if (result.success && result.tasks) {
      tasks.value = result.tasks
    }
  } catch (error) {
    console.error('Failed to load tasks:', error)
  }
}

// 监听传输进度
const handleProgress = (taskId: string, progress: any) => {
  const task = tasks.value.find(t => t.id === taskId)
  if (task) {
    task.progress = progress
  }
}

// 监听传输完成
const handleComplete = (taskId: string) => {
  const task = tasks.value.find(t => t.id === taskId)
  if (task) {
    task.status = 'completed'
    // 2秒后移动到历史记录
    setTimeout(() => {
      moveToHistory(task)
      removeTask(taskId)
    }, 2000)
  }
}

// 监听传输错误
const handleError = (taskId: string, error: string) => {
  const task = tasks.value.find(t => t.id === taskId)
  if (task) {
    task.status = 'failed'
    task.error = error
  }
}

onMounted(() => {
  loadHistory()
  loadTasks()

  // 注册事件监听
  window.electronAPI.sftp.onProgress(handleProgress)
  window.electronAPI.sftp.onComplete(handleComplete)
  window.electronAPI.sftp.onError(handleError)
})

onUnmounted(() => {
  // 清理事件监听
  // TODO: 实现事件监听清理
})
</script>

<style scoped>
.transfer-queue {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.queue-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
}

.queue-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.queue-actions {
  display: flex;
  gap: 8px;
}

.queue-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.tab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tab.active {
  background: var(--primary-color);
  color: white;
}

.badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 12px;
}

.tab.active .badge {
  background: rgba(255, 255, 255, 0.3);
}

.queue-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
}

.empty-icon {
  font-size: 48px;
  opacity: 0.5;
  margin-bottom: 16px;
}

.transfer-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 8px;
  transition: all 0.2s;
}

.transfer-item:hover {
  background: var(--bg-hover);
}

.transfer-item.completed {
  opacity: 0.7;
}

.transfer-item.failed {
  border-left: 3px solid var(--error-color);
}

.transfer-icon {
  font-size: 24px;
  flex-shrink: 0;
}

.transfer-info {
  flex: 1;
  min-width: 0;
}

.transfer-name {
  font-weight: 500;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-path {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.transfer-progress {
  margin-top: 8px;
}

.progress-bar {
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 6px;
}

.progress-fill {
  height: 100%;
  background: var(--primary-color);
  transition: width 0.3s;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}

.transfer-status {
  margin-top: 8px;
  font-size: 14px;
}

.transfer-status.error {
  color: var(--error-color);
}

.transfer-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn-icon {
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-icon:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.btn-icon:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.history-actions {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--border-color);
}
</style>
