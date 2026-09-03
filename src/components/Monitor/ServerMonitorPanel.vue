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
        <button
          @click="refreshMetrics"
          class="btn-refresh"
          :disabled="!isMonitoring || refreshing"
          title="刷新"
        >
          🔄
        </button>
        <button @click="$emit('close')" class="btn-close" title="关闭监控">
          ×
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="monitor-error">
      {{ errorMessage }}
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
        <div class="metric-info">{{ formatDiskInfo(metrics.disk) }}</div>
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
              <th style="text-align: right;">状态</th>
              <th style="text-align: right;">CPU</th>
              <th style="text-align: right;">MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="container in metrics.dockerContainers" :key="container.name">
              <td class="truncate" :title="container.name">{{ container.name }}</td>
              <td class="truncate" style="text-align: right;" :title="container.status">{{ container.status }}</td>
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
defineEmits<{
  close: []
}>()

const isMonitoring = ref(false)
const metrics = ref<any>(null)
const errorMessage = ref('')
const refreshing = ref(false)
let metricsUnsubscribe: (() => void) | null = null
let errorUnsubscribe: (() => void) | null = null

const formatMonitorError = (error: any) => {
  return error?.message || String(error || '监控采集失败')
}

const startMonitoring = async () => {
  errorMessage.value = ''
  const result = await window.electronAPI.serverMonitor?.start?.(props.sessionId, {
    interval: 3000
  })
  if (result?.success === false) {
    errorMessage.value = result.error || '监控启动失败'
    isMonitoring.value = false
    return
  }

  isMonitoring.value = true
}

// 切换监控
const toggleMonitoring = async () => {
  if (isMonitoring.value) {
    await window.electronAPI.serverMonitor?.stop?.(props.sessionId)
    isMonitoring.value = false
  } else {
    await startMonitoring()
  }
}

// 刷新指标
const refreshMetrics = async () => {
  if (!isMonitoring.value) return
  refreshing.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.serverMonitor?.refresh?.(props.sessionId)
    if (result?.success && result.data) {
      metrics.value = result.data
    } else if (result?.success === false) {
      errorMessage.value = result.error || '监控刷新失败'
    }
  } catch (error: any) {
    errorMessage.value = formatMonitorError(error)
    console.error('Failed to refresh metrics:', error)
  } finally {
    refreshing.value = false
  }
}

// 监听指标更新
const handleMetricsUpdate = (sessionId: string, data: any) => {
  if (sessionId === props.sessionId) {
    errorMessage.value = ''
    metrics.value = data
  }
}

const handleMonitorError = (sessionId: string, error: any) => {
  if (sessionId === props.sessionId) {
    errorMessage.value = formatMonitorError(error)
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

const formatDiskInfo = (disk: any): string => {
  const filesystems = Array.isArray(disk?.filesystems) ? disk.filesystems : []
  if (filesystems.length === 0) {
    return `${formatBytes(disk.free)} 可用`
  }

  const busiest = [...filesystems].sort((a, b) => (b.usage || 0) - (a.usage || 0))[0]
  const mountInfo = busiest?.mount ? ` · 最高 ${busiest.mount} ${Number(busiest.usage || 0).toFixed(0)}%` : ''
  return `${formatBytes(disk.free)} 可用 · ${filesystems.length} 挂载${mountInfo}`
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
  const unsubError = window.electronAPI.serverMonitor?.onError?.(handleMonitorError)
  if (unsubError) errorUnsubscribe = unsubError
  void startMonitoring()
})

onUnmounted(() => {
  if (isMonitoring.value) {
    window.electronAPI.serverMonitor?.stop?.(props.sessionId)
  }
  if (metricsUnsubscribe) {
    metricsUnsubscribe()
    metricsUnsubscribe = null
  }
  if (errorUnsubscribe) {
    errorUnsubscribe()
    errorUnsubscribe = null
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
.btn-refresh,
.btn-close {
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

.btn-close:hover {
  background: var(--error-color);
  border-color: var(--error-color);
  color: white;
}

.monitor-error {
  margin: 10px 12px 0;
  padding: 8px 10px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.08);
  color: var(--error-color);
  font-size: var(--text-xs);
  line-height: 1.45;
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

:global(:root.app-appearance-terminal .monitor-sidebar) {
  background: var(--bg-main);
  border-left: 1px solid var(--border-strong);
  box-shadow: inset 1px 0 0 rgba(var(--primary-color-rgb), 0.06);
}

:global(:root.app-appearance-terminal .monitor-sidebar .server-monitor-panel.compact) {
  width: 100%;
  border-left: 0;
}

:global(:root.app-appearance-terminal .server-monitor-panel) {
  --monitor-card-bg: #020404;
  --monitor-card-bg-soft: #07100f;
  --monitor-card-border: var(--terminal-line);
  --monitor-text: #d7f7ec;
  --monitor-muted: #91b9ad;
  --monitor-dim: #6f9288;
  --monitor-strong: #b9fbe3;
  --monitor-track: rgba(215, 247, 236, 0.16);

  background: var(--bg-main);
  color: var(--text-primary);
}

:global(:root.light-theme.app-appearance-terminal .server-monitor-panel) {
  --monitor-card-bg: #03110d;
  --monitor-card-bg-soft: #071a14;
  --monitor-card-border: rgba(var(--primary-color-rgb), 0.34);
  --monitor-text: #d9fff0;
  --monitor-muted: #9ccfbc;
  --monitor-dim: #76a493;
  --monitor-strong: #bfffe9;
  --monitor-track: rgba(217, 255, 240, 0.18);
}

:global(:root.app-appearance-terminal .server-monitor-panel .monitor-header) {
  min-height: 48px;
  padding: 10px 14px;
  background:
    linear-gradient(90deg, rgba(var(--primary-color-rgb), 0.08), transparent 210px),
    var(--bg-secondary);
  border-bottom: 1px solid var(--border-strong);
}

:global(:root.app-appearance-terminal .server-monitor-panel .monitor-header h3) {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-base);
  letter-spacing: 0;
}

:global(:root.app-appearance-terminal .server-monitor-panel .monitor-header h3::before) {
  content: '$ ';
  color: var(--primary-color);
}

:global(:root.app-appearance-terminal .server-monitor-panel .header-actions) {
  gap: 8px;
}

:global(:root.app-appearance-terminal .server-monitor-panel .btn-toggle),
:global(:root.app-appearance-terminal .server-monitor-panel .btn-refresh),
:global(:root.app-appearance-terminal .server-monitor-panel .btn-close) {
  width: 40px;
  height: 28px;
  min-width: 40px;
  padding: 0;
  border-radius: var(--radius-sm);
  border-color: var(--border-medium);
  background: var(--bg-main);
  color: var(--primary-color);
  font-family: var(--font-mono);
  line-height: 1;
  box-shadow: none;
}

:global(:root.app-appearance-terminal .server-monitor-panel .btn-toggle.active) {
  background: var(--primary-color);
  border-color: var(--primary-hover);
  color: var(--text-inverse);
}

:global(:root.app-appearance-terminal .server-monitor-panel .btn-refresh:hover:not(:disabled)),
:global(:root.app-appearance-terminal .server-monitor-panel .btn-toggle:hover) {
  background: rgba(var(--primary-color-rgb), 0.12);
  border-color: var(--terminal-line);
  color: var(--primary-light);
}

:global(:root.app-appearance-terminal .server-monitor-panel .btn-close:hover) {
  background: var(--error-color);
  border-color: var(--error-color);
  color: var(--text-inverse);
}

:global(:root.app-appearance-terminal .server-monitor-panel .btn-refresh:disabled) {
  color: var(--text-disabled);
  border-color: var(--border-color);
}

:global(:root.app-appearance-terminal .server-monitor-panel .monitor-content.compact) {
  padding: 12px;
  gap: 10px;
  background: var(--bg-main);
}

:global(:root.app-appearance-terminal .server-monitor-panel .metric-card.compact) {
  background:
    linear-gradient(180deg, rgba(var(--primary-color-rgb), 0.055), transparent 62px),
    var(--monitor-card-bg) !important;
  border: 1px solid var(--monitor-card-border) !important;
  border-radius: var(--radius-sm) !important;
  box-shadow: inset 0 0 0 1px rgba(var(--primary-color-rgb), 0.045) !important;
}

:global(:root.app-appearance-terminal .server-monitor-panel .metric-title),
:global(:root.app-appearance-terminal .server-monitor-panel .network-label),
:global(:root.app-appearance-terminal .server-monitor-panel .info-label),
:global(:root.app-appearance-terminal .server-monitor-panel .compact-table th) {
  color: var(--monitor-muted) !important;
  font-family: var(--font-mono);
  letter-spacing: 0;
}

:global(:root.app-appearance-terminal .server-monitor-panel .metric-value),
:global(:root.app-appearance-terminal .server-monitor-panel .info-value),
:global(:root.app-appearance-terminal .server-monitor-panel .compact-table td) {
  color: var(--monitor-text) !important;
  font-family: var(--font-mono);
}

:global(:root.app-appearance-terminal .server-monitor-panel .metric-info),
:global(:root.app-appearance-terminal .server-monitor-panel .network-total),
:global(:root.app-appearance-terminal .server-monitor-panel .update-time) {
  color: var(--monitor-dim) !important;
  font-family: var(--font-mono);
}

:global(:root.app-appearance-terminal .server-monitor-panel .progress-bar.mini) {
  background: var(--monitor-track);
  border-radius: var(--radius-xs);
}

:global(:root.app-appearance-terminal .server-monitor-panel .network-row),
:global(:root.app-appearance-terminal .server-monitor-panel .info-row) {
  gap: 8px;
  min-width: 0;
}

:global(:root.app-appearance-terminal .server-monitor-panel .network-stats) {
  min-width: 0;
  justify-content: flex-end;
}

:global(:root.app-appearance-terminal .server-monitor-panel .network-speed) {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--primary-color) !important;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

:global(:root.app-appearance-terminal .server-monitor-panel .network-total) {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}

:global(:root.app-appearance-terminal .server-monitor-panel .compact-table) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

:global(:root.app-appearance-terminal .server-monitor-panel .compact-table th) {
  border-bottom-color: rgba(var(--primary-color-rgb), 0.22);
}

:global(:root.app-appearance-terminal .server-monitor-panel .compact-table tbody tr:hover td) {
  background: var(--monitor-card-bg-soft);
}

:global(:root.app-appearance-terminal .server-monitor-panel .monitor-empty),
:global(:root.app-appearance-terminal .server-monitor-panel .monitor-loading) {
  background: var(--bg-main);
  color: var(--text-secondary);
}

:global(:root.app-appearance-terminal .server-monitor-panel .spinner) {
  border-color: var(--border-color);
  border-top-color: var(--primary-color);
}
</style>
