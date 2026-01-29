<template>
  <div class="command-history-panel">
    <div class="panel-header">
      <h3>命令历史</h3>
      <div class="header-actions">
        <el-button :icon="Refresh" size="small" @click="loadHistory">刷新</el-button>
        <el-button :icon="Download" size="small" @click="exportHistory">导出</el-button>
        <el-button :icon="Delete" size="small" type="danger" @click="clearHistory">清空</el-button>
      </div>
    </div>

    <div class="panel-toolbar">
      <el-input
        v-model="searchQuery"
        placeholder="搜索命令..."
        :prefix-icon="Search"
        clearable
        @input="handleSearch"
        style="flex: 1"
      />
      <el-select v-model="filterSession" placeholder="所有会话" clearable style="width: 200px; margin-left: 8px">
        <el-option label="所有会话" value="" />
        <el-option
          v-for="session in sessions"
          :key="session"
          :label="session"
          :value="session"
        />
      </el-select>
      <el-select v-model="filterType" placeholder="全部" style="width: 120px; margin-left: 8px">
        <el-option label="全部" value="all" />
        <el-option label="收藏" value="favorites" />
        <el-option label="今天" value="today" />
      </el-select>
    </div>

    <div class="history-stats">
      <div class="stat-item">
        <span class="stat-label">总命令数:</span>
        <span class="stat-value">{{ statistics.totalCommands }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">唯一命令:</span>
        <span class="stat-value">{{ statistics.uniqueCommands }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">收藏数:</span>
        <span class="stat-value">{{ statistics.favoritesCount }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">今日命令:</span>
        <span class="stat-value">{{ statistics.todayCount }}</span>
      </div>
    </div>

    <div class="history-list" v-loading="loading">
      <div
        v-for="item in displayedHistory"
        :key="item.id"
        class="history-item"
        @click="selectCommand(item)"
      >
        <div class="item-header">
          <div class="item-command">{{ item.command }}</div>
          <div class="item-actions">
            <el-button
              :icon="item.favorite ? StarFilled : Star"
              link
              size="small"
              @click.stop="toggleFavorite(item.id)"
              :type="item.favorite ? 'warning' : 'default'"
            />
            <el-button
              :icon="CopyDocument"
              link
              size="small"
              @click.stop="copyCommand(item.command)"
            />
            <el-button
              :icon="Delete"
              link
              size="small"
              type="danger"
              @click.stop="deleteCommand(item.id)"
            />
          </div>
        </div>
        <div class="item-meta">
          <span class="meta-session">{{ item.sessionName }}</span>
          <span class="meta-time">{{ formatTime(item.timestamp) }}</span>
          <span v-if="item.exitCode !== undefined" class="meta-exit" :class="{ success: item.exitCode === 0, error: item.exitCode !== 0 }">
            退出码: {{ item.exitCode }}
          </span>
          <span v-if="item.duration" class="meta-duration">
            耗时: {{ formatDuration(item.duration) }}
          </span>
        </div>
      </div>

      <div v-if="displayedHistory.length === 0" class="empty-state">
        <el-icon :size="64"><Document /></el-icon>
        <p>暂无命令历史</p>
      </div>
    </div>

    <!-- 最常用命令 -->
    <div class="most-used-section">
      <h4>最常用命令</h4>
      <div class="most-used-list">
        <div
          v-for="(cmd, index) in mostUsedCommands"
          :key="index"
          class="most-used-item"
          @click="copyCommand(cmd.command)"
        >
          <span class="rank">{{ index + 1 }}</span>
          <span class="command">{{ cmd.command }}</span>
          <el-tag size="small" type="primary">{{ cmd.count }}次</el-tag>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Search, Refresh, Download, Delete, Star, StarFilled,
  CopyDocument, Document
} from '@element-plus/icons-vue'

interface CommandHistory {
  id: string
  command: string
  sessionId: string
  sessionName: string
  timestamp: string
  exitCode?: number
  duration?: number
  favorite: boolean
}

interface Statistics {
  totalCommands: number
  uniqueCommands: number
  favoritesCount: number
  sessionsCount: number
  todayCount: number
}

const emit = defineEmits<{
  select: [command: string]
}>()

const loading = ref(false)
const searchQuery = ref('')
const filterSession = ref('')
const filterType = ref('all')
const history = ref<CommandHistory[]>([])
const mostUsedCommands = ref<Array<{ command: string; count: number }>>([])
const statistics = ref<Statistics>({
  totalCommands: 0,
  uniqueCommands: 0,
  favoritesCount: 0,
  sessionsCount: 0,
  todayCount: 0
})

const sessions = computed(() => {
  const sessionSet = new Set(history.value.map(h => h.sessionName))
  return Array.from(sessionSet)
})

const displayedHistory = computed(() => {
  let filtered = history.value

  // 按类型过滤
  if (filterType.value === 'favorites') {
    filtered = filtered.filter(h => h.favorite)
  } else if (filterType.value === 'today') {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    filtered = filtered.filter(h => new Date(h.timestamp) >= today)
  }

  // 按会话过滤
  if (filterSession.value) {
    filtered = filtered.filter(h => h.sessionName === filterSession.value)
  }

  // 搜索过滤
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(h => h.command.toLowerCase().includes(query))
  }

  return filtered
})

const loadHistory = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.commandHistory?.getAll?.(1000)
    if (result?.success && result.data) {
      history.value = result.data
    }

    // 加载统计信息
    const statsResult = await window.electronAPI.commandHistory?.getStatistics?.()
    if (statsResult?.success && statsResult.data) {
      statistics.value = statsResult.data
    }

    // 加载最常用命令
    const mostUsedResult = await window.electronAPI.commandHistory?.getMostUsed?.(10)
    if (mostUsedResult?.success && mostUsedResult.data) {
      mostUsedCommands.value = mostUsedResult.data
    }
  } catch (error: any) {
    ElMessage.error(`加载历史失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

const handleSearch = async () => {
  if (!searchQuery.value) {
    await loadHistory()
    return
  }

  loading.value = true
  try {
    const result = await window.electronAPI.commandHistory?.search?.(
      searchQuery.value,
      filterSession.value || undefined
    )
    if (result?.success && result.data) {
      history.value = result.data
    }
  } catch (error: any) {
    ElMessage.error(`搜索失败: ${error.message}`)
  } finally {
    loading.value = false
  }
}

const toggleFavorite = async (id: string) => {
  try {
    const result = await window.electronAPI.commandHistory?.toggleFavorite?.(id)
    if (result?.success) {
      const item = history.value.find(h => h.id === id)
      if (item) {
        item.favorite = !item.favorite
        ElMessage.success(item.favorite ? '已添加到收藏' : '已取消收藏')
      }
      // 重新加载统计
      const statsResult = await window.electronAPI.commandHistory?.getStatistics?.()
      if (statsResult?.success && statsResult.data) {
        statistics.value = statsResult.data
      }
    }
  } catch (error: any) {
    ElMessage.error(`操作失败: ${error.message}`)
  }
}

const copyCommand = async (command: string) => {
  try {
    await navigator.clipboard.writeText(command)
    ElMessage.success('已复制到剪贴板')
  } catch (error) {
    ElMessage.error('复制失败')
  }
}

const selectCommand = (item: CommandHistory) => {
  emit('select', item.command)
}

const deleteCommand = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定要删除这条历史记录吗？', '确认删除', {
      type: 'warning'
    })

    const result = await window.electronAPI.commandHistory?.delete?.(id)
    if (result?.success) {
      history.value = history.value.filter(h => h.id !== id)
      ElMessage.success('已删除')
      // 重新加载统计
      const statsResult = await window.electronAPI.commandHistory?.getStatistics?.()
      if (statsResult?.success && statsResult.data) {
        statistics.value = statsResult.data
      }
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`删除失败: ${error.message}`)
    }
  }
}

const exportHistory = async () => {
  try {
    const result = await window.electronAPI.dialog.saveFile({
      defaultPath: `command-history-${Date.now()}.json`,
      filters: [
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result) {
      const exportResult = await window.electronAPI.commandHistory?.export?.(result)
      if (exportResult?.success) {
        ElMessage.success('历史记录已导出')
      } else {
        ElMessage.error(`导出失败: ${exportResult?.error}`)
      }
    }
  } catch (error: any) {
    ElMessage.error(`导出失败: ${error.message}`)
  }
}

const clearHistory = async () => {
  try {
    await ElMessageBox.confirm(
      '确定要清空所有历史记录吗？收藏的命令将被保留。',
      '确认清空',
      {
        type: 'warning',
        confirmButtonText: '清空',
        cancelButtonText: '取消'
      }
    )

    const result = await window.electronAPI.commandHistory?.clearAll?.(true)
    if (result?.success) {
      await loadHistory()
      ElMessage.success('历史记录已清空')
    }
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(`清空失败: ${error.message}`)
    }
  }
}

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

onMounted(() => {
  loadHistory()
})
</script>

<style scoped>
.command-history-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-main);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 6px;
}

.panel-toolbar {
  display: flex;
  padding: 10px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-main);
}

.history-stats {
  display: flex;
  gap: 20px;
  padding: 10px 12px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.stat-item {
  display: flex;
  gap: 6px;
  align-items: center;
}

.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.stat-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary-color);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  min-height: 0; /* 关键：允许flex子元素正确收缩 */
}

.history-item {
  padding: 10px;
  margin-bottom: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.history-item:hover {
  border-color: var(--primary-color);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  background: var(--bg-main);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 6px;
  gap: 8px;
}

.item-command {
  flex: 1;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  line-height: 1.4;
}

.item-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.item-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-secondary);
  flex-wrap: wrap;
}

.meta-session {
  color: var(--primary-color);
}

.meta-exit.success {
  color: var(--success-color);
}

.meta-exit.error {
  color: var(--error-color);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.empty-state p {
  margin-top: 16px;
  font-size: 14px;
}

.most-used-section {
  flex-shrink: 0; /* 防止被压缩 */
  border-top: 1px solid var(--border-color);
  padding: 12px;
  background: var(--bg-secondary);
  max-height: 280px; /* 限制最大高度 */
  overflow-y: auto; /* 如果内容过多，允许滚动 */
}

.most-used-section h4 {
  margin: 0 0 10px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.most-used-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.most-used-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-main);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.most-used-item:hover {
  border-color: var(--primary-color);
  background: var(--bg-secondary);
}

.most-used-item .rank {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-color);
  color: white;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.most-used-item .command {
  flex: 1;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
