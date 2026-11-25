<template>
  <div class="server-monitor-panel compact">
    <div class="monitor-header">
      <h3>监控</h3>
      <div class="header-actions">
        <button
          @click="toggleMonitoring"
          :class="['btn-toggle', { active: wanted }]"
          :aria-label="wanted ? '暂停监控' : '开始监控'"
          :title="wanted ? '暂停监控' : '开始监控'"
        >
          {{ wanted ? '⏸' : '▶' }}
        </button>
        <button
          @click="refreshMetrics"
          class="btn-refresh"
          :disabled="!isMonitoring || refreshing"
          aria-label="立即刷新监控"
          title="立即刷新"
        >
          ↻
        </button>
        <button @click="$emit('close')" class="btn-close" aria-label="关闭监控" title="关闭监控">
          ×
        </button>
      </div>
    </div>
    <div class="monitor-controls">
      <label
        >刷新
        <select v-model.number="interval" aria-label="监控刷新间隔" @change="changeInterval">
          <option v-for="value in MONITOR_INTERVALS" :key="value" :value="value">
            {{ value / 1000 }} 秒
          </option>
        </select>
      </label>
      <span :class="['monitor-status', { stale: isStale }]" role="status">{{ statusText }}</span>
    </div>
    <div v-if="errorMessage" class="monitor-error" role="alert">{{ errorMessage }}</div>
    <div v-if="!metrics" class="monitor-empty">
      <div v-if="wanted && !errorMessage" class="spinner"></div>
      <p>{{ wanted ? '等待第一份监控数据' : '监控已暂停' }}</p>
    </div>
    <div v-else class="monitor-content compact">
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">CPU</span
          ><span class="metric-value">{{ percent(metrics.cpu.usage) }}</span>
        </div>
        <div class="progress-bar mini">
          <div
            class="progress-fill"
            :style="{ width: (metrics.cpu.usage ?? 0) + '%', background: 'var(--primary-color)' }"
          ></div>
        </div>
        <svg
          viewBox="0 0 100 32"
          preserveAspectRatio="none"
          class="metric-trend"
          role="img"
          aria-label="CPU 最近 60 次采样趋势"
        >
          <polyline :points="trendPoints('cpu')" />
        </svg>
        <div class="metric-info">
          {{ metrics.cpu.cores }} 核 · 负载 {{ metrics.cpu.loadAverage[0].toFixed(2) }}
        </div>
      </div>
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">内存</span
          ><span class="metric-value">{{ percent(metrics.memory.usage) }}</span>
        </div>
        <div class="progress-bar mini">
          <div
            class="progress-fill"
            :style="{ width: metrics.memory.usage + '%', background: 'var(--success-color)' }"
          ></div>
        </div>
        <svg
          viewBox="0 0 100 32"
          preserveAspectRatio="none"
          class="metric-trend memory-trend"
          role="img"
          aria-label="内存最近 60 次采样趋势"
        >
          <polyline :points="trendPoints('memory')" />
        </svg>
        <div class="metric-info">
          {{ formatBytes(metrics.memory.used) }} / {{ formatBytes(metrics.memory.total) }}
        </div>
        <div class="metric-info">已用 = 总量 − 可用 · 趋势为最近 60 次采样</div>
      </div>
      <div class="metric-card compact">
        <div class="metric-header">
          <span class="metric-title">磁盘</span
          ><span class="metric-value">{{ metrics.disk ? percent(metrics.disk.usage) : '—' }}</span>
        </div>
        <div v-if="metrics.disk" class="metric-info">
          {{ formatBytes(metrics.disk.free) }} 可用 · {{ metrics.disk.filesystems.length }} 挂载
        </div>
        <div class="metric-info">每 10 秒 · {{ ageLabel(metrics.sources.disk.timestamp) }}</div>
        <div v-if="metrics.sources.disk.error" class="source-error">
          {{ metrics.sources.disk.error }}
        </div>
      </div>
      <div class="metric-card compact">
        <div class="metric-header"><span class="metric-title">系统</span></div>
        <div class="system-info">
          <div class="info-row">
            <span class="info-label">运行</span
            ><span class="info-value">{{ formatUptime(metrics.system.uptime) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">进程</span
            ><span class="info-value"
              >{{ metrics.processes.total }}（{{ metrics.processes.running }} 运行）</span
            >
          </div>
          <div class="info-row">
            <span class="info-label">主机</span
            ><span class="info-value" :title="metrics.system.hostname">{{
              metrics.system.hostname
            }}</span>
          </div>
        </div>
      </div>
      <div class="metric-card compact full-width">
        <div class="metric-header">
          <span class="metric-title">网络</span><span class="metric-info">非 lo 接口合计</span>
        </div>
        <div class="network-row">
          <span class="network-label">↓ 接收</span>
          <div class="network-stats">
            <span class="network-speed">{{ speed(metrics.network.speedIn) }}</span
            ><span class="network-total">{{ formatBytes(metrics.network.bytesIn) }}</span>
          </div>
        </div>
        <div class="network-row">
          <span class="network-label">↑ 发送</span>
          <div class="network-stats">
            <span class="network-speed">{{ speed(metrics.network.speedOut) }}</span
            ><span class="network-total">{{ formatBytes(metrics.network.bytesOut) }}</span>
          </div>
        </div>
      </div>
      <div
        class="metric-card compact full-width security-card"
        :class="{ 'has-risk': untrustedSources.length > 0 }"
        role="button"
        tabindex="0"
        title="查看在线会话、连接来源、登录历史和认证日志"
        @click="openSecurityDetails()"
        @keydown.enter="openSecurityDetails()"
      >
        <div class="metric-header">
          <span class="metric-title">安全</span>
          <span
            :class="['security-status', untrustedSources.length ? 'risk' : security ? 'ok' : '']"
            >{{ securityStatusText }}</span
          >
        </div>
        <div v-if="securityError" class="source-error">{{ securityError }}</div>
        <template v-if="security">
          <div class="security-grid">
            <div class="security-stat">
              <span class="info-label">在线用户</span>
              <strong>{{ onlineUsers }}</strong>
              <small>{{ security.sessions.length }} 个会话</small>
            </div>
            <div class="security-stat">
              <span class="info-label">远程连接</span>
              <strong>{{ security.connections.length }}</strong>
              <small>{{ sourceIps.length }} 个来源 IP</small>
            </div>
            <div class="security-stat" :class="{ danger: untrustedSources.length }">
              <span class="info-label">非信任 IP</span>
              <strong>{{ untrustedSources.length }}</strong>
              <small>{{ trustRules.length }} 条信任规则</small>
            </div>
            <div
              class="security-stat"
              :class="{ warn: (security.failedLastHour ?? 0) >= 10 }"
              @click.stop="openSecurityDetails('failed')"
            >
              <span class="info-label">1 小时失败</span>
              <strong>{{ security.failedLastHour ?? '—' }}</strong>
              <small>{{ security.failedLastHour === null ? '无日志权限' : '次认证失败' }}</small>
            </div>
          </div>
          <div v-if="sourceIps.length" class="security-sources">
            <span
              v-for="source in sourceIps.slice(0, 6)"
              :key="source.ip"
              :class="['source-chip', source.level]"
              :title="sourceTitle(source)"
              >{{ source.ip }}</span
            >
            <span v-if="sourceIps.length > 6" class="source-chip more"
              >+{{ sourceIps.length - 6 }}</span
            >
          </div>
          <div class="metric-info">
            每 15 秒 · {{ ageLabel(security.collectedAt) }} · 点击查看登录详情与日志
          </div>
        </template>
        <div v-else-if="!securityError" class="metric-info">正在采集安全信息…</div>
      </div>
      <div class="metric-card compact full-width">
        <div class="metric-header">
          <span class="metric-title">实时进程</span
          ><span class="metric-info"
            >{{ visibleProcesses.length }} / {{ filteredProcesses.length }}</span
          >
        </div>
        <div class="process-controls">
          <input v-model="processQuery" placeholder="筛选进程 / PID" aria-label="筛选监控进程" />
          <select v-model="sortBy" aria-label="进程排序">
            <option value="cpu">CPU ↓</option>
            <option value="memory">内存 ↓</option>
            <option value="pid">PID ↑</option>
          </select>
          <select v-model.number="processLimit" aria-label="进程显示数量">
            <option :value="20">20 条</option>
            <option :value="50">50 条</option>
            <option :value="100">100 条</option>
          </select>
        </div>
        <div class="metric-info">CPU 为采样期间占用；单核满载 100%，多线程可超过 100%。</div>
        <table class="compact-table">
          <thead>
            <tr>
              <th style="width: 45%; text-align: left">进程 / PID</th>
              <th>CPU</th>
              <th>MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="proc in visibleProcesses" :key="proc.pid">
              <td
                class="truncate"
                :title="proc.command + ' · PID ' + proc.pid + ' · 用户 ' + proc.user"
              >
                {{ proc.command }}<small class="process-pid">{{ proc.pid }}</small>
              </td>
              <td>{{ percent(proc.cpu, '—') }}</td>
              <td>{{ percent(proc.memory) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!visibleProcesses.length" class="metric-info">没有匹配的进程</div>
      </div>
      <div class="metric-card compact full-width">
        <div class="metric-header">
          <span class="metric-title">Docker</span
          ><span class="metric-info"
            >每 5 秒 · {{ ageLabel(metrics.sources.docker.timestamp) }}</span
          >
        </div>
        <div v-if="metrics.sources.docker.error" class="source-error">
          {{ metrics.sources.docker.error }}
        </div>
        <div v-else-if="metrics.sources.docker.available === false" class="metric-info">
          未安装 Docker
        </div>
        <table v-else-if="metrics.dockerContainers.length" class="compact-table">
          <thead>
            <tr>
              <th>容器</th>
              <th>状态</th>
              <th>CPU</th>
              <th>MEM</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="container in metrics.dockerContainers" :key="container.name">
              <td class="truncate" :title="container.name">{{ container.name }}</td>
              <td class="truncate" :title="container.status">{{ container.status }}</td>
              <td>{{ container.cpu }}</td>
              <td>{{ container.memory }}</td>
            </tr>
          </tbody>
        </table>
        <div v-else class="metric-info">
          {{ metrics.sources.docker.timestamp ? '暂无容器' : '正在采集容器数据…' }}
        </div>
      </div>
      <SecurityDetailsDialog
        v-if="securityDialogMounted"
        v-model="securityDialogVisible"
        :session-id="sessionId"
        :summary="security"
        :rules="trustRules"
        :initial-tab="securityDialogTab"
        @update:rules="updateTrustRules"
      />
      <div class="update-time full-width">
        基础指标：{{ ageLabel(metrics.timestamp) }} · {{ formatTime(metrics.timestamp) }}<br />
        {{
          metrics.sampleIntervalMs === null
            ? '正在建立采样基线'
            : '实际采样间隔 ' + (metrics.sampleIntervalMs / 1000).toFixed(1) + ' 秒'
        }}
        · 耗时 {{ metrics.collectionDurationMs }} ms
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// Share lifecycle ordering across panel instances during rapid tab switches/remounts.
let monitorOperationQueue = Promise.resolve()
</script>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { MONITOR_INTERVALS, type ServerMetrics } from '@/types/monitor'
import type { SecuritySummary } from '@/types/security'
import {
  collectSourceIps,
  loadTrustRules,
  saveTrustRules,
  trustLabel,
  type SourceIp
} from '@/utils/security-trust'
import SecurityDetailsDialog from './SecurityDetailsDialog.vue'

const props = withDefaults(
  defineProps<{ sessionId: string; active?: boolean; hostKey?: string }>(),
  { active: true }
)
defineEmits<{ close: [] }>()
const wanted = ref(true)
const isMonitoring = ref(false)
const metrics = ref<ServerMetrics | null>(null)
const errorMessage = ref('')
const refreshing = ref(false)
const interval = ref(1000)
try {
  const saved = Number(localStorage.getItem('mshell-monitor-interval'))
  if ((MONITOR_INTERVALS as readonly number[]).includes(saved)) interval.value = saved
} catch {}
const now = ref(Date.now())
const pageVisible = ref(!document.hidden)
const processQuery = ref('')
const sortBy = ref<'cpu' | 'memory' | 'pid'>('cpu')
const processLimit = ref(20)
const history = ref<Array<{ timestamp: string; cpu: number | null; memory: number }>>([])
const filteredProcesses = computed(() => {
  const query = processQuery.value.trim().toLowerCase()
  return (metrics.value?.topProcesses || [])
    .filter(
      (proc) =>
        !query || proc.command.toLowerCase().includes(query) || String(proc.pid).includes(query)
    )
    .slice()
    .sort((a, b) =>
      sortBy.value === 'pid'
        ? a.pid - b.pid
        : (b[sortBy.value] ?? -1) - (a[sortBy.value] ?? -1) || a.pid - b.pid
    )
})
const visibleProcesses = computed(() => filteredProcesses.value.slice(0, processLimit.value))
const age = (timestamp?: string) =>
  timestamp ? Math.max(0, Math.floor((now.value - new Date(timestamp).getTime()) / 1000)) : null
const ageLabel = (timestamp?: string) => {
  const seconds = age(timestamp)
  return seconds === null ? '等待更新' : seconds === 0 ? '刚刚更新' : seconds + ' 秒前更新'
}
const isStale = computed(
  () =>
    wanted.value &&
    isMonitoring.value &&
    (age(metrics.value?.timestamp) ?? 0) > Math.max(5, interval.value / 500)
)
const statusText = computed(() => {
  if (!wanted.value) return '已暂停'
  if (!props.active || !pageVisible.value) return '页面隐藏，已暂停'
  if (metrics.value?.connection === 'waiting') return '等待 SSH 重连'
  if (errorMessage.value) return '采集异常'
  if (!isMonitoring.value) return '正在启动'
  return isStale.value ? '数据延迟' : '自动监控'
})
const formatMonitorError = (error: unknown) =>
  error instanceof Error ? error.message : String(error || '监控采集失败')
let disposed = false
let runningSession = ''
let appliedInterval = 0
let clock: ReturnType<typeof setInterval> | undefined
const unsubscribers: Array<() => void> = []

const handleMetricsUpdate = (sessionId: string, data: ServerMetrics) => {
  if (
    disposed ||
    !wanted.value ||
    !props.active ||
    !pageVisible.value ||
    sessionId !== props.sessionId ||
    data.sessionId !== props.sessionId
  )
    return
  const changed = data.timestamp !== metrics.value?.timestamp
  metrics.value = data
  errorMessage.value = data.sources.core.error || ''
  now.value = Date.now()
  if (changed) {
    if (data.cpu.usage === null) history.value = []
    history.value = [
      ...history.value,
      { timestamp: data.timestamp, cpu: data.cpu.usage, memory: data.memory.usage }
    ].slice(-60)
  }
}

// Serialize start/stop/update requests; a late start response must still be stopped after unmount.
const reconcile = () => {
  monitorOperationQueue = monitorOperationQueue
    .then(async () => {
      const api = window.electronAPI.serverMonitor
      const shouldRun = wanted.value && props.active && pageVisible.value && !disposed
      if (runningSession && (!shouldRun || runningSession !== props.sessionId)) {
        const result = await api?.stop(runningSession)
        if (result?.success === false) throw new Error(result.error || '监控暂停失败')
        runningSession = ''
        isMonitoring.value = false
      }
      if (!shouldRun) return
      if (!api) throw new Error('当前环境不支持服务器监控')
      if (!runningSession) {
        errorMessage.value = ''
        const id = props.sessionId
        const requestedInterval = interval.value
        const result = await api.start(id, { interval: requestedInterval })
        if (!result.success) throw new Error(result.error || '监控启动失败')
        runningSession = id
        appliedInterval = requestedInterval
        isMonitoring.value = true
      } else if (appliedInterval !== interval.value) {
        const requestedInterval = interval.value
        const result = await api.updateConfig(runningSession, { interval: requestedInterval })
        if (!result.success) throw new Error(result.error || '修改刷新间隔失败')
        appliedInterval = requestedInterval
      }
    })
    .catch((error) => {
      if (!disposed) errorMessage.value = formatMonitorError(error)
      if (!runningSession) {
        isMonitoring.value = false
        wanted.value = false
      }
    })
  return monitorOperationQueue
}
const toggleMonitoring = () => {
  wanted.value = !wanted.value
  void reconcile()
}
const changeInterval = () => {
  try {
    localStorage.setItem('mshell-monitor-interval', String(interval.value))
  } catch {}
  void reconcile()
}
const refreshMetrics = async () => {
  if (!isMonitoring.value || refreshing.value) return
  refreshing.value = true
  const sessionId = props.sessionId
  try {
    const result = await window.electronAPI.serverMonitor?.refresh(sessionId)
    if (!result?.success || !result.data) throw new Error(result?.error || '监控刷新失败')
    handleMetricsUpdate(sessionId, result.data)
  } catch (error) {
    if (!disposed && wanted.value) errorMessage.value = formatMonitorError(error)
  } finally {
    refreshing.value = false
  }
}
const onVisibility = () => {
  pageVisible.value = !document.hidden
  void reconcile()
}
watch(
  () => props.active,
  () => {
    void reconcile()
  }
)
watch(
  () => props.sessionId,
  () => {
    metrics.value = null
    history.value = []
    void reconcile()
  }
)
onMounted(() => {
  const api = window.electronAPI.serverMonitor
  const metricsOff = api?.onMetrics(handleMetricsUpdate)
  const errorOff = api?.onError((id, error) => {
    if (id === props.sessionId && wanted.value && !disposed)
      errorMessage.value = formatMonitorError(error)
  })
  if (metricsOff) unsubscribers.push(metricsOff)
  if (errorOff) unsubscribers.push(errorOff)
  document.addEventListener('visibilitychange', onVisibility)
  clock = setInterval(() => {
    now.value = Date.now()
  }, 1000)
  void reconcile()
})
// 安全信息：与基础指标独立，每 15 秒轮询；监控暂停或页面隐藏时停止
const SECURITY_INTERVAL = 15000
const security = ref<SecuritySummary | null>(null)
const securityError = ref('')
const securityDialogVisible = ref(false)
const securityDialogTab = ref('sources')
// 首次打开时才挂载详情弹窗
const securityDialogMounted = ref(false)
const trustHostKey = computed(
  () => props.hostKey || metrics.value?.system.hostname || props.sessionId
)
const trustRules = ref<string[]>([])
let securityTimer: ReturnType<typeof setTimeout> | undefined
let securityRequest = 0

watch(
  trustHostKey,
  (key) => {
    trustRules.value = loadTrustRules(key)
  },
  { immediate: true }
)
const updateTrustRules = (rules: string[]) => {
  saveTrustRules(trustHostKey.value, rules)
  trustRules.value = loadTrustRules(trustHostKey.value)
}
const sourceIps = computed(() =>
  security.value ? collectSourceIps(security.value, trustRules.value) : []
)
const untrustedSources = computed(() =>
  sourceIps.value.filter((source) => source.level === 'untrusted')
)
const onlineUsers = computed(
  () => new Set((security.value?.sessions || []).map((session) => session.user)).size
)
const securityStatusText = computed(() => {
  if (!security.value) return securityError.value ? '采集失败' : '检测中'
  if (untrustedSources.value.length) return `发现 ${untrustedSources.value.length} 个非信任 IP`
  return '来源均可信'
})
const sourceTitle = (source: SourceIp) =>
  `${trustLabel[source.level]} · ${source.connections} 个连接` +
  (source.users.length ? ' · ' + source.users.join(', ') : '')
const securityShouldRun = () =>
  !disposed && wanted.value && isMonitoring.value && props.active && pageVisible.value
const stopSecurityPolling = () => {
  if (securityTimer) clearTimeout(securityTimer)
  securityTimer = undefined
}
const pollSecurity = async () => {
  stopSecurityPolling()
  if (!securityShouldRun()) return
  const id = props.sessionId
  const current = ++securityRequest
  try {
    const result = await window.electronAPI.serverMonitor?.getSecurity(id)
    if (current !== securityRequest || id !== props.sessionId || disposed) return
    if (!result?.success || !result.data) throw new Error(result?.error || '安全信息采集失败')
    security.value = result.data
    securityError.value = ''
  } catch (error) {
    if (current !== securityRequest || id !== props.sessionId || disposed) return
    securityError.value = formatMonitorError(error)
  } finally {
    if (current === securityRequest && securityShouldRun()) {
      securityTimer = setTimeout(() => void pollSecurity(), SECURITY_INTERVAL)
    }
  }
}
watch(
  () => [wanted.value, isMonitoring.value, props.active, pageVisible.value] as const,
  () => {
    if (securityShouldRun()) {
      if (!securityTimer) void pollSecurity()
    } else {
      securityRequest++
      stopSecurityPolling()
    }
  }
)
watch(
  () => props.sessionId,
  () => {
    securityRequest++
    stopSecurityPolling()
    security.value = null
    securityError.value = ''
    securityDialogVisible.value = false
    if (securityShouldRun()) void pollSecurity()
  }
)
const openSecurityDetails = (tab = untrustedSources.value.length ? 'sources' : 'sessions') => {
  securityDialogTab.value = tab
  securityDialogMounted.value = true
  securityDialogVisible.value = true
}

onUnmounted(() => {
  disposed = true
  securityRequest++
  stopSecurityPolling()
  clearInterval(clock)
  document.removeEventListener('visibilitychange', onVisibility)
  unsubscribers.forEach((unsubscribe) => unsubscribe())
  void reconcile()
})

const percent = (value: number | null, empty = '采样中') =>
  value === null ? empty : value.toFixed(1) + '%'
const formatBytes = (value: number) => {
  if (value < 1024) return value.toFixed(0) + ' B'
  if (value < 1024 ** 2) return (value / 1024).toFixed(1) + ' KB'
  if (value < 1024 ** 3) return (value / 1024 ** 2).toFixed(1) + ' MB'
  return (value / 1024 ** 3).toFixed(1) + ' GB'
}
const speed = (value: number | null) => (value === null ? '采样中' : formatBytes(value) + '/s')
const formatTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN')
const formatUptime = (value: number) => {
  const days = Math.floor(value / 86400),
    hours = Math.floor((value % 86400) / 3600),
    minutes = Math.floor((value % 3600) / 60)
  return days
    ? days + '天 ' + hours + '小时'
    : hours
      ? hours + '小时 ' + minutes + '分钟'
      : minutes + '分钟'
}
const trendPoints = (key: 'cpu' | 'memory') =>
  history.value
    .flatMap((point, i) =>
      point[key] === null
        ? []
        : [`${(i / 59) * 100},${31 - (Math.min(100, Math.max(0, point[key]!)) / 100) * 30}`]
    )
    .join(' ')
</script>
<style scoped>
.monitor-controls,
.process-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.monitor-controls {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  justify-content: space-between;
}
.monitor-controls label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.process-controls {
  margin-bottom: 8px;
  gap: 5px;
}
.process-controls input {
  flex: 1 1 100px;
  min-width: 0;
}
.monitor-controls select,
.process-controls select,
.process-controls input {
  min-height: 28px;
  padding: 3px 6px;
  color: var(--text-primary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  font-size: 12px;
}
.monitor-status {
  color: var(--text-secondary);
  font-size: 12px;
}
.monitor-status.stale,
.source-error {
  color: var(--warning-color);
}
.source-error {
  font-size: 12px;
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.metric-trend {
  width: 100%;
  height: 36px;
  margin: 6px 0;
}
.metric-trend polyline {
  fill: none;
  stroke: var(--primary-color);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.memory-trend polyline {
  stroke: var(--success-color);
}
.process-pid {
  display: block;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.compact-table td:not(:first-child),
.compact-table th:not(:first-child) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.metric-info {
  line-height: 1.5;
}
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
  overflow-wrap: anywhere;
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
  to {
    transform: rotate(360deg);
  }
}

.monitor-content.compact {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  align-content: start;
}

.metric-card.full-width,
.update-time.full-width {
  grid-column: 1 / -1;
}

.metric-card.compact {
  min-width: 0;
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
  transition: none;
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
.security-card {
  cursor: pointer;
  transition: border-color 0.2s;
}

.security-card:hover,
.security-card:focus-visible {
  border-color: var(--primary-color);
  outline: none;
}

.security-card.has-risk {
  border-color: var(--danger-color, #dc2626);
}

.security-status {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.security-status.ok {
  color: var(--success-color, #16a34a);
}

.security-status.risk {
  color: var(--danger-color, #dc2626);
  font-weight: 600;
}

.security-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin: 6px 0;
}

.security-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.security-stat strong {
  font-size: var(--text-base);
}

.security-stat small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.security-stat.danger strong {
  color: var(--danger-color, #dc2626);
}

.security-stat.warn strong {
  color: var(--warning-color, #d97706);
}

.security-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.source-chip {
  padding: 0 6px;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 18px;
  color: var(--text-secondary);
  background: rgba(127, 127, 127, 0.12);
}

.source-chip.untrusted {
  color: var(--danger-color, #dc2626);
  background: rgba(220, 38, 38, 0.12);
}

.source-chip.trusted {
  color: var(--success-color, #16a34a);
  background: rgba(22, 163, 74, 0.12);
}

@media (max-width: 420px) {
  .security-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
