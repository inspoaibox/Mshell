<template>
  <div class="port-panel">
    <div class="port-header">
      <div>
        <h3>端口管理</h3>
        <p>{{ subtitle }}</p>
      </div>
      <div class="header-actions">
        <el-button
          :icon="Refresh"
          :loading="refreshing"
          :disabled="closing || !connected"
          @click="loadOverview"
          >刷新</el-button
        >
        <el-button :icon="Close" link @click="$emit('close')" />
      </div>
    </div>

    <div class="port-toolbar">
      <el-input
        v-model="filter.keyword"
        :prefix-icon="Search"
        clearable
        size="small"
        placeholder="搜索端口、范围(8000-9000)、进程、PID、用户、服务"
      />
      <div class="filter-row">
        <el-radio-group v-model="filter.protocol" size="small">
          <el-radio-button value="all">全部</el-radio-button>
          <el-radio-button value="tcp">TCP</el-radio-button>
          <el-radio-button value="udp">UDP</el-radio-button>
        </el-radio-group>
        <el-radio-group v-model="filter.exposure" size="small">
          <el-radio-button value="any">全部地址</el-radio-button>
          <el-radio-button value="all">对外开放</el-radio-button>
          <el-radio-button value="local">仅本机</el-radio-button>
        </el-radio-group>
      </div>
      <div class="refresh-row">
        <label
          >自动刷新
          <select v-model.number="refreshInterval" aria-label="端口自动刷新间隔">
            <option :value="3000">3 秒</option>
            <option :value="5000">5 秒</option>
            <option :value="10000">10 秒</option>
            <option :value="30000">30 秒</option>
            <option :value="0">关闭</option>
          </select>
        </label>
        <span role="status">{{ refreshStatus }}</span>
      </div>
    </div>

    <div v-loading="loading" class="port-content">
      <el-alert v-if="errorMessage" type="error" :title="errorMessage" show-icon :closable="false" />
      <el-alert
        v-for="warning in overview?.warnings || []"
        :key="warning"
        :title="warning"
        type="warning"
        :closable="false"
      />

      <template v-if="overview">
        <div class="port-summary">
          <div class="summary-card">
            <span class="label">监听端口</span>
            <strong>{{ overview.ports.length }}</strong>
          </div>
          <div class="summary-card">
            <span class="label">TCP / UDP</span>
            <strong>{{ tcpCount }} / {{ overview.ports.length - tcpCount }}</strong>
          </div>
          <div class="summary-card">
            <span class="label">对外开放</span>
            <strong>{{ publicCount }}</strong>
          </div>
          <div class="summary-card">
            <span class="label">入站连接</span>
            <strong>{{ totalConnections }}</strong>
          </div>
        </div>

        <div class="list-head">
          <span>显示 {{ visiblePorts.length }} / {{ overview.ports.length }}</span>
          <el-button v-if="expandedKeys.size" link size="small" @click="expandedKeys = new Set()"
            >全部收起</el-button
          >
        </div>

        <el-empty
          v-if="!visiblePorts.length"
          :description="overview.ports.length ? '没有匹配的端口' : '没有检测到监听端口'"
          :image-size="64"
        />

        <div v-else class="port-list">
          <div
            v-for="entry in visiblePorts"
            :key="entry.key"
            class="port-row"
            :class="{ 'is-expanded': expandedKeys.has(entry.key), 'is-new': newKeys.has(entry.key) }"
          >
            <div class="row-main" @click="toggleExpanded(entry.key)">
              <div class="port-number">
                <strong>{{ entry.port }}</strong>
                <span class="proto" :class="entry.protocol">{{ entry.protocol.toUpperCase() }}</span>
              </div>
              <div class="row-info">
                <div class="row-title">
                  <span class="process-name" :title="primaryProcess(entry)?.command">
                    {{ processLabel(entry) }}
                  </span>
                  <span class="exposure" :class="entry.exposure">{{
                    exposureLabel[entry.exposure]
                  }}</span>
                  <span v-if="entry.isSshPort" class="badge ssh">当前 SSH</span>
                  <span v-if="entry.containers.length" class="badge docker"
                    >Docker：{{ entry.containers.join('、') }}</span
                  >
                </div>
                <div class="row-meta">
                  <span :title="entry.addresses.join(', ')">{{ addressText(entry) }}</span>
                  <span v-if="primaryProcess(entry)?.user">用户 {{ primaryProcess(entry)?.user }}</span>
                  <span v-if="entry.protocol === 'tcp'"
                    >连接 {{ entry.connections
                    }}<template v-if="entry.remoteClients">（{{ entry.remoteClients }} 个来源）</template></span
                  >
                  <span v-if="primaryProcess(entry)?.cpu">CPU {{ primaryProcess(entry)?.cpu }}%</span>
                  <span v-if="primaryProcess(entry)?.rssKb !== undefined"
                    >内存 {{ formatRss(primaryProcess(entry)?.rssKb) }}</span
                  >
                </div>
              </div>
              <div class="row-actions" @click.stop>
                <el-tooltip
                  :content="closeBlockReason(entry) || '关闭端口：结束占用进程或停止服务'"
                  placement="left"
                >
                  <span>
                    <el-dropdown
                      trigger="click"
                      :disabled="!!closeBlockReason(entry) || !canOperate"
                      @command="(mode: PortCloseMode) => closePort(entry, mode)"
                    >
                      <el-button
                        size="small"
                        type="danger"
                        plain
                        :icon="SwitchButton"
                        :disabled="!!closeBlockReason(entry) || !canOperate"
                        :loading="closingKey === entry.key"
                        >关闭</el-button
                      >
                      <template #dropdown>
                        <el-dropdown-menu>
                          <el-dropdown-item command="term">结束进程（SIGTERM）</el-dropdown-item>
                          <el-dropdown-item command="kill">强制结束（SIGKILL）</el-dropdown-item>
                          <el-dropdown-item v-if="stoppableUnitOf(entry)" command="service" divided
                            >停止服务 {{ stoppableUnitOf(entry) }}</el-dropdown-item
                          >
                        </el-dropdown-menu>
                      </template>
                    </el-dropdown>
                  </span>
                </el-tooltip>
              </div>
            </div>

            <div v-if="expandedKeys.has(entry.key)" class="row-detail">
              <div class="detail-line">
                <span class="label">监听地址</span>
                <span class="mono">{{ entry.addresses.join('  ') }}</span>
              </div>
              <div v-if="entry.processHidden" class="detail-line muted">
                占用进程不可见（需要 root 或免密 sudo）
              </div>
              <div
                v-for="process in entry.processes"
                :key="process.pid"
                class="process-card"
                :class="{ 'is-root': entry.rootPids.includes(process.pid) }"
              >
                <div class="process-head">
                  <strong>{{ process.name || '未知进程' }}</strong>
                  <span>PID {{ process.pid }}</span>
                  <span v-if="process.ppid">PPID {{ process.ppid }}</span>
                  <span v-if="entry.rootPids.includes(process.pid)" class="badge">主进程</span>
                  <span v-if="process.unit" class="badge unit">{{ process.unit }}</span>
                </div>
                <div class="process-grid">
                  <span>用户 {{ process.user || '-' }}</span>
                  <span>CPU {{ process.cpu || '-' }}%</span>
                  <span>内存 {{ process.memory || '-' }}% · {{ formatRss(process.rssKb) }}</span>
                  <span>运行 {{ formatElapsed(process.elapsed) }}</span>
                </div>
                <div v-if="process.command" class="command mono" :title="process.command">
                  {{ process.command }}
                  <el-button
                    link
                    size="small"
                    :icon="CopyDocument"
                    title="复制命令"
                    @click="copyText(process.command)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="lastOutput" class="output-box">
      <div class="output-head">
        <span>{{ lastSummary }}</span>
        <el-button link size="small" :icon="Close" @click="lastOutput = ''" />
      </div>
      <pre>{{ lastOutput }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, CopyDocument, Refresh, Search, SwitchButton } from '@element-plus/icons-vue'
import type { PortCloseMode, PortEntry, PortOverview } from '@/types/ports'
import {
  closeBlockReason,
  exposureLabel,
  filterPorts,
  formatElapsed,
  formatRss,
  stoppableUnitOf,
  type PortFilter
} from '@/utils/port-utils'

const props = withDefaults(defineProps<{ connectionId: string; active?: boolean }>(), {
  active: true
})
defineEmits<{ close: [] }>()

const overview = ref<PortOverview | null>(null)
const refreshing = ref(false)
const closingKey = ref('')
const closing = computed(() => !!closingKey.value)
const connected = ref(true)
const visible = ref(!document.hidden)
const errorMessage = ref('')
const lastUpdated = ref('')
const lastOutput = ref('')
const lastSummary = ref('')
const refreshInterval = ref(5000)
const expandedKeys = ref<Set<string>>(new Set())
const newKeys = ref<Set<string>>(new Set())
const filter = reactive({
  keyword: '',
  protocol: 'all' as 'all' | 'tcp' | 'udp',
  exposure: 'any' as PortFilter['exposure']
})

let disposed = false
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Promise<void> | undefined
const cleanups: Array<() => void> = []

const loading = computed(() => refreshing.value && !overview.value)
const canRefresh = computed(() => props.active && visible.value && connected.value && !closing.value)
const canOperate = computed(() => connected.value && !closing.value && !!overview.value)

const visiblePorts = computed(() =>
  overview.value
    ? filterPorts(overview.value.ports, filter)
    : []
)
const tcpCount = computed(() => overview.value?.ports.filter((p) => p.protocol === 'tcp').length || 0)
const publicCount = computed(
  () => overview.value?.ports.filter((p) => p.exposure === 'all').length || 0
)
const totalConnections = computed(
  () => overview.value?.ports.reduce((sum, p) => sum + p.connections, 0) || 0
)
const subtitle = computed(() => {
  if (!overview.value) return '检测服务器监听端口与占用进程'
  const host = overview.value.hostname ? overview.value.hostname + ' · ' : ''
  const tool = overview.value.tool ? `通过 ${overview.value.tool}` : '缺少 ss/netstat'
  return `${host}${tool}${overview.value.privileged ? '' : ' · 非特权'}`
})
const refreshStatus = computed(() => {
  if (!connected.value) return '连接已断开 · 数据未更新'
  if (closing.value) return '操作中 · 自动刷新暂停'
  if (!props.active || !visible.value) return '页面隐藏 · 自动刷新暂停'
  if (refreshing.value) return '正在刷新…'
  if (errorMessage.value && overview.value) return '刷新失败 · 显示上次数据'
  return lastUpdated.value ? '更新于 ' + lastUpdated.value : '等待检测'
})

const primaryProcess = (entry: PortEntry) =>
  entry.processes.find((item) => entry.rootPids.includes(item.pid)) || entry.processes[0]

const processLabel = (entry: PortEntry) => {
  if (!entry.processes.length) return entry.processHidden ? '进程不可见' : '未知进程'
  const main = primaryProcess(entry)!
  const extra = entry.processes.length > 1 ? ` +${entry.processes.length - 1}` : ''
  return `${main.name || '未知'} (${main.pid})${extra}`
}

const addressText = (entry: PortEntry) => {
  const [first, ...rest] = entry.addresses
  return rest.length ? `${first} 等 ${entry.addresses.length} 个地址` : first || '-'
}

const toggleExpanded = (key: string) => {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

const stopTimer = () => {
  if (timer) clearTimeout(timer)
  timer = undefined
}

const schedule = () => {
  stopTimer()
  if (disposed || !refreshInterval.value || !canRefresh.value) return
  timer = setTimeout(() => void loadOverview(), refreshInterval.value)
}

const applyOverview = (next: PortOverview) => {
  const previous = overview.value
  newKeys.value = previous
    ? new Set(next.ports.filter((p) => !previous.ports.some((o) => o.key === p.key)).map((p) => p.key))
    : new Set()
  const keys = new Set(next.ports.map((p) => p.key))
  expandedKeys.value = new Set([...expandedKeys.value].filter((key) => keys.has(key)))
  overview.value = next
  lastUpdated.value = new Date().toLocaleTimeString()
}

const loadOverview = (): Promise<void> => {
  if (disposed || !connected.value) return Promise.resolve()
  stopTimer()
  if (pending) return pending
  const version = generation
  const id = props.connectionId
  refreshing.value = true
  pending = (async () => {
    try {
      const result = await window.electronAPI.ports.inspect(id)
      if (disposed || version !== generation || id !== props.connectionId) return
      if (!result.success || !result.data) throw new Error(result.error || '端口检测失败')
      applyOverview(result.data)
      errorMessage.value = ''
    } catch (error) {
      if (disposed || version !== generation || id !== props.connectionId) return
      errorMessage.value = error instanceof Error ? error.message : String(error)
    } finally {
      pending = undefined
      refreshing.value = false
      schedule()
    }
  })()
  return pending
}

const modeLabel: Record<PortCloseMode, string> = {
  term: '结束进程（SIGTERM）',
  kill: '强制结束（SIGKILL）',
  service: '停止服务'
}

const closePort = async (entry: PortEntry, mode: PortCloseMode) => {
  if (closing.value || closeBlockReason(entry)) return
  const id = props.connectionId
  const unit = stoppableUnitOf(entry)
  const targets = entry.processes.filter((item) => entry.rootPids.includes(item.pid))
  const label = `${entry.protocol.toUpperCase()} ${entry.port}`
  const warnings: string[] = []
  if (mode !== 'service' && unit) {
    warnings.push(`该进程属于 ${unit}，systemd 可能会自动重启它；要彻底关闭请选择“停止服务”。`)
  }
  if (mode === 'kill') warnings.push('SIGKILL 不会给进程清理的机会，可能导致数据未保存。')
  if (mode === 'service') warnings.push('停止服务不会禁用开机自启，重启服务器后可能再次监听。')
  if (entry.processes.length > targets.length) {
    warnings.push(`将作用于主进程，其 ${entry.processes.length - targets.length} 个子进程通常会随之退出。`)
  }

  try {
    await ElMessageBox.confirm(
      h('div', { class: 'port-confirm' }, [
        h('p', `确认关闭 ${label}？方式：${modeLabel[mode]}${mode === 'service' ? ` ${unit}` : ''}`),
        ...targets.map((item) =>
          h('p', { class: 'port-confirm-process' }, [
            h('strong', `PID ${item.pid} ${item.name}`),
            item.user ? ` · ${item.user}` : '',
            item.command ? h('code', item.command) : ''
          ])
        ),
        ...warnings.map((text) => h('p', { class: 'port-confirm-warning' }, text))
      ]),
      '关闭端口',
      { type: 'warning', confirmButtonText: '确认关闭', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  if (disposed || id !== props.connectionId) return

  closingKey.value = entry.key
  stopTimer()
  generation++
  try {
    const result = await window.electronAPI.ports.close(id, {
      protocol: entry.protocol,
      port: entry.port,
      mode,
      expectedPids: [...entry.rootPids]
    })
    if (disposed || id !== props.connectionId) return
    if (!result.success || !result.data) throw new Error(result.error || '关闭端口失败')
    lastSummary.value = result.data.message
    lastOutput.value = result.data.output
    if (result.data.closed) ElMessage.success(result.data.message)
    else ElMessage.warning({ message: result.data.message, duration: 6000 })
  } catch (error) {
    if (disposed || id !== props.connectionId) return
    const message = error instanceof Error ? error.message : String(error)
    lastSummary.value = `${label} 关闭失败`
    lastOutput.value = message
    ElMessage.error(message)
  } finally {
    if (!disposed && id === props.connectionId) {
      closingKey.value = ''
      void loadOverview()
    }
  }
}

const onVisibility = () => {
  visible.value = !document.hidden
}

watch(refreshInterval, schedule)
watch(
  () => [props.connectionId, props.active, connected.value, visible.value] as const,
  (next, previous) => {
    generation++
    stopTimer()
    if (previous && next[0] !== previous[0]) {
      overview.value = null
      errorMessage.value = ''
      lastUpdated.value = ''
      lastOutput.value = ''
      expandedKeys.value = new Set()
      newKeys.value = new Set()
      connected.value = true
      closingKey.value = ''
    }
    if (canRefresh.value) void loadOverview()
  }
)

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  const ssh = window.electronAPI.ssh
  const close = ssh?.onClose?.((id) => {
    if (id !== props.connectionId) return
    connected.value = false
    errorMessage.value = 'SSH 连接已断开，保留上次数据，重连后自动刷新'
  })
  const reconnect = ssh?.onReconnected?.((id) => {
    if (id !== props.connectionId) return
    if (!connected.value) connected.value = true
    else void loadOverview()
  })
  if (close) cleanups.push(close)
  if (reconnect) cleanups.push(reconnect)
  if (canRefresh.value) void loadOverview()
})

onUnmounted(() => {
  disposed = true
  generation++
  stopTimer()
  document.removeEventListener('visibilitychange', onVisibility)
  cleanups.forEach((cleanup) => cleanup())
})
</script>

<style scoped>
.port-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--bg-main);
  color: var(--text-primary);
}

.port-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.port-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 700;
}

.port-header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.port-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.refresh-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.refresh-row select {
  margin-left: 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--text-primary);
  background: var(--bg-secondary);
}

.port-content {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow-y: auto;
}

.port-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.summary-card .label,
.detail-line .label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.summary-card strong {
  font-size: var(--text-lg);
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.port-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.port-row {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  transition: border-color 0.2s;
}

.port-row:hover,
.port-row.is-expanded {
  border-color: var(--border-color);
}

.port-row.is-new {
  border-color: var(--primary-color);
}

.row-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  cursor: pointer;
}

.port-number {
  display: flex;
  flex: 0 0 64px;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.port-number strong {
  font-family: var(--font-mono, monospace);
  font-size: var(--text-base);
}

.proto {
  padding: 0 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
}

.proto.tcp {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.12);
}

.proto.udp {
  color: #9333ea;
  background: rgba(147, 51, 234, 0.12);
}

.row-info {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.row-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.process-name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.exposure,
.badge {
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.exposure.all {
  color: #c2410c;
  background: rgba(234, 88, 12, 0.12);
}

.exposure.local {
  color: #15803d;
  background: rgba(22, 163, 74, 0.12);
}

.exposure.specific,
.badge {
  color: var(--text-secondary);
  background: var(--bg-tertiary, rgba(127, 127, 127, 0.12));
}

.badge.ssh {
  color: #b91c1c;
  background: rgba(220, 38, 38, 0.12);
}

.badge.docker {
  color: #0369a1;
  background: rgba(2, 132, 199, 0.12);
}

.row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.row-actions {
  flex: 0 0 auto;
}

.row-detail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 10px 10px 84px;
  font-size: var(--text-xs);
}

.detail-line {
  display: flex;
  gap: 8px;
}

.muted {
  color: var(--text-tertiary);
}

.mono,
.command {
  font-family: var(--font-mono, monospace);
  word-break: break-all;
}

.process-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border: 1px dashed var(--border-light);
  border-radius: var(--radius-sm);
}

.process-card.is-root {
  border-style: solid;
}

.process-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.process-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px 12px;
  color: var(--text-secondary);
}

.command {
  color: var(--text-secondary);
}

.output-box {
  max-height: 180px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  overflow: auto;
}

.output-head {
  position: sticky;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: var(--bg-secondary);
  font-size: var(--text-xs);
  font-weight: 600;
}

.output-box pre {
  margin: 0;
  padding: 0 12px 10px;
  font-size: var(--text-xs);
  white-space: pre-wrap;
  word-break: break-all;
}

@media (max-width: 520px) {
  .port-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .row-detail {
    padding-left: 10px;
  }
}
</style>

<style>
.port-confirm p {
  margin: 0 0 6px;
}

.port-confirm-process code {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  word-break: break-all;
}

.port-confirm-warning {
  color: var(--el-color-warning);
}
</style>
