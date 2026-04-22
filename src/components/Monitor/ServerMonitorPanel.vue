<template>
  <div class="server-monitor-panel compact">
    <div class="monitor-header">
      <h3>监控</h3>
      <div class="header-actions">
        <button
          @click="toggleMonitoring"
          :class="['btn-toggle', { active: isMonitoring }]"
          title="开启/暂停监控"
        >
          {{ isMonitoring ? '⏸' : '▶' }}
        </button>
        <button @click="refreshMetrics" class="btn-refresh" :disabled="!isMonitoring" title="刷新">
          🔄
        </button>
      </div>
    </div>

    <div v-if="!isMonitoring" class="monitor-empty">
      <div class="empty-icon">📊</div>
      <p>点击开始监控</p>
    </div>

    <div v-else-if="!metrics" class="monitor-loading">
      <div class="spinner"></div>
    </div>

    <div v-else class="monitor-content compact">
      <!-- CPU -->
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">CPU</span>
          <span class="metric-value">{{ metrics.cpu.usage.toFixed(1) }}%</span>
        </div>
        <div class="progress-bar mini">
          <div
            class="progress-fill"
            :style="{ width: `${metrics.cpu.usage}%`, background: getCPUColor(metrics.cpu.usage) }"
          ></div>
        </div>
        <div class="metric-info">{{ metrics.cpu.cores }}核 · 负载 {{ metrics.cpu.loadAverage[0].toFixed(2) }}</div>
      </div>

      <!-- 内存 -->
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">内存</span>
          <span class="metric-value">{{ metrics.memory.usage.toFixed(1) }}%</span>
        </div>
        <div class="progress-bar mini">
          <div
            class="progress-fill"
            :style="{ width: `${metrics.memory.usage}%`, background: getMemoryColor(metrics.memory.usage) }"
          ></div>
        </div>
        <div class="metric-info">{{ formatBytes(metrics.memory.used) }} / {{ formatBytes(metrics.memory.total) }}</div>
      </div>

      <!-- 磁盘 -->
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">磁盘</span>
          <span class="metric-value">{{ metrics.disk.usage.toFixed(1) }}%</span>
        </div>
        <div class="progress-bar mini">
          <div
            class="progress-fill"
            :style="{ width: `${metrics.disk.usage}%`, background: getDiskColor(metrics.disk.usage) }"
          ></div>
        </div>
        <div class="metric-info">{{ formatBytes(metrics.disk.free) }} 可用</div>
      </div>

      <!-- 系统信息 -->
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">系统</span>
        </div>
        <div class="system-info">
          <div class="info-row">
            <span class="info-label">运行</span>
            <span class="info-value">{{ formatUptime(metrics.system.uptime) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">进程</span>
            <span class="info-value">{{ metrics.processes.total }} ({{ metrics.processes.running }} 运行)</span>
          </div>
        </div>
      </div>

      <!-- 网络 -->
      <div class="metric-card compact full-width">
        <div class="metric-header">
          <span class="metric-title">网络</span>
        </div>
        <div class="network-compact">
          <div class="network-row">
            <span class="network-label">⬇️ 接收</span>
            <div class="network-stats">
              <span class="network-speed" v-if="metrics.network.speedIn !== undefined">{{ formatSpeed(metrics.network.speedIn) }}</span>
              <span class="network-total">{{ formatBytes(metrics.network.bytesIn) }}</span>
            </div>
          </div>
          <div class="network-row">
            <span class="network-label">⬆️ 发送</span>
             <div class="network-stats">
              <span class="network-speed" v-if="metrics.network.speedOut !== undefined">{{ formatSpeed(metrics.network.speedOut) }}</span>
              <span class="network-total">{{ formatBytes(metrics.network.bytesOut) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Top 进程 -->
      <div class="metric-card compact full-width" v-if="metrics.topProcesses && metrics.topProcesses.length > 0">
        <div class="metric-header">
          <span class="metric-title">Top 进程</span>
        </div>
        <table class="compact-table">
          <thead>
            <tr>
              <th style="text-align: left;">进程</th>
              <th style="text-align: right;">CPU</th>
              <th style="text-align: right;">MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="proc in metrics.topProcesses" :key="proc.pid">
              <td class="truncate" :title="proc.command">{{ proc.command }}</td>
              <td style="text-align: right;">{{ proc.cpu }}%</td>
              <td style="text-align: right;">{{ proc.memory }}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Docker 容器 -->
      <div class="metric-card compact full-width" v-if="metrics.dockerContainers && metrics.dockerContainers.length > 0">
        <div class="metric-header">
          <span class="metric-title">Docker</span>
        </div>
        <table class="compact-table">
          <thead>
            <tr>
              <th style="text-align: left;">容器</th>
              <th style="text-align: right;">CPU</th>
              <th style="text-align: right;">MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="container in metrics.dockerContainers" :key="container.name">
              <td class="truncate" :title="container.name">{{ container.name }}</td>
              <td style="text-align: right;">{{ container.cpu }}</td>
              <td style="text-align: right;">{{ container.memory }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 更新时间 -->
      <div class="update-time full-width">{{ formatTime(metrics.timestamp) }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

interface Props {
  sessionId: string
}

const props = defineProps<Props>()

const isMonitoring = ref(false)
const metrics = ref<any>(null)
let metricsUnsubscribe: (() => void) | null = null

// 切换监控
const toggleMonitoring = async () => {
  if (isMonitoring.value) {
    await window.electronAPI.serverMonitor?.stop?.(props.sessionId)
    isMonitoring.value = false
  } else {
    await window.electronAPI.serverMonitor?.start?.(props.sessionId)
    isMonitoring.value = true
  }
}

// 刷新指标
const refreshMetrics = async () => {
  if (!isMonitoring.value) return
  try {
    const result = await window.electronAPI.serverMonitor?.getMetrics?.(props.sessionId)
    if (result?.success && result.data) {
      metrics.value = result.data
    }
  } catch (error) {
    console.error('Failed to refresh metrics:', error)
  }
}

// 监听指标更新
const handleMetricsUpdate = (sessionId: string, data: any) => {
  if (sessionId === props.sessionId) {
    metrics.value = data
  }
}

// 格式化字节
const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// 格式化速度
const formatSpeed = (bytesPerSecond: number): string => {
  return `${formatBytes(bytesPerSecond)}/s`
}

// 格式化运行时间
const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}天 ${hours}小时`
  if (hours > 0) return `${hours}小时 ${minutes}分钟`
  return `${minutes}分钟`
}

// 格式化时间
const formatTime = (timestamp: string): string => {
  return new Date(timestamp).toLocaleTimeString('zh-CN')
}

// 获取颜色
const getCPUColor = (usage: number): string => {
  if (usage < 50) return '#10b981'
  if (usage < 80) return '#f59e0b'
  return '#ef4444'
}

const getMemoryColor = (usage: number): string => {
  if (usage < 70) return '#10b981'
  if (usage < 90) return '#f59e0b'
  return '#ef4444'
}

const getDiskColor = (usage: number): string => {
  if (usage < 80) return '#10b981'
  if (usage < 95) return '#f59e0b'
  return '#ef4444'
}

onMounted(() => {
  const unsub = window.electronAPI.serverMonitor?.onMetrics?.(handleMetricsUpdate)
  if (unsub) metricsUnsubscribe = unsub
})

onUnmounted(() => {
  if (isMonitoring.value) {
    window.electronAPI.serverMonitor?.stop?.(props.sessionId)
  }
  if (metricsUnsubscribe) {
    metricsUnsubscribe()
    metricsUnsubscribe = null
  }
})
</script>

<style scoped>
.server-monitor-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.server-monitor-panel.compact {
  width: 280px;
  border-left: 1px solid var(--border-color);
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.monitor-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 6px;
}

.btn-toggle,
.btn-refresh {
  padding: 4px 10px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--text-md);
  transition: all 0.2s;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.btn-toggle.active {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
}

.btn-refresh:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--primary-color);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.monitor-empty,
.monitor-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  padding: 20px;
}

.empty-icon {
  font-size: var(--text-5xl);
  margin-bottom: 12px;
  opacity: 0.5;
}

.monitor-empty p {
  font-size: var(--text-md);
  margin: 0;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--primary-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.monitor-content.compact {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-content: start;
}

.metric-card.full-width,
.update-time.full-width {
  grid-column: 1 / -1;
}

.metric-card.compact {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
}

.metric-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.metric-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
}

.metric-value {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--text-primary);
}

.progress-bar.mini {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 6px;
}

.progress-fill {
  height: 100%;
  transition: width 0.5s ease;
}

.metric-info {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.network-compact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.network-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: var(--text-sm);
}

.network-label {
  color: var(--text-secondary);
}

.network-value {
  color: var(--text-primary);
  font-weight: 500;
}

.system-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  font-size: var(--text-xs);
}

.info-label {
  color: var(--text-secondary);
}

.info-value {
  color: var(--text-primary);
  font-weight: 500;
  text-align: right;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-time {
  text-align: center;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  padding: 6px;
}

.compact-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
  table-layout: fixed;
}

.compact-table th {
  color: var(--text-secondary);
  font-weight: normal;
  padding: 2px 0;
  border-bottom: 1px solid var(--border-color);
}

.compact-table td {
  color: var(--text-primary);
  padding: 3px 0;
}

.network-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.network-speed {
  color: var(--primary-color);
  font-weight: 600;
  font-size: var(--text-md);
}

.network-total {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
