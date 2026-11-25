<template>
  <div class="ipmi-tab">
    <header class="ipmi-header glass-header">
      <div class="ipmi-title-wrap">
        <div class="ipmi-logo"><el-icon><Cpu /></el-icon></div>
        <div class="ipmi-title">
          <strong>{{ displayName }}</strong>
          <span>{{ session.host }}:{{ session.port || defaultPort }}</span>
        </div>
        <el-tag :type="statusTagType" size="small" effect="plain">{{ statusText }}</el-tag>
      </div>
      <div class="ipmi-actions">
        <el-tooltip content="刷新状态" placement="bottom">
          <el-button link :icon="Refresh" :loading="loading" @click="refresh" />
        </el-tooltip>
        <el-tooltip content="断开连接" placement="bottom">
          <el-button link type="danger" :icon="Close" @click="handleDisconnect" />
        </el-tooltip>
      </div>
    </header>

    <main class="ipmi-content">
      <div v-if="connectionStatus === 'connecting'" class="ipmi-state">
        <div class="loader"></div>
        <p>正在连接 BMC 管理接口…</p>
        <span>{{ session.host }}:{{ session.port || defaultPort }}</span>
      </div>

      <div v-else-if="connectionStatus === 'error'" class="ipmi-state error-state">
        <el-icon :size="44"><CircleClose /></el-icon>
        <h3>IPMI 连接失败</h3>
        <p>{{ errorMessage }}</p>
        <el-button type="primary" :icon="Refresh" @click="connect">重新连接</el-button>
      </div>

      <template v-else>
        <el-alert
          v-if="info?.warning"
          :title="info.warning"
          type="warning"
          show-icon
          :closable="false"
          class="ipmi-warning"
        />

        <section class="overview-grid">
          <article class="overview-card power-card">
            <div class="card-label"><el-icon><Lightning /></el-icon> 电源状态</div>
            <div class="power-value" :class="powerClass">{{ info?.powerState || '未知' }}</div>
            <span class="card-help">来自 BMC / Redfish 当前状态</span>
          </article>
          <article class="overview-card">
            <div class="card-label"><el-icon><OfficeBuilding /></el-icon> 制造商</div>
            <div class="info-value">{{ info?.manufacturer || '未提供' }}</div>
          </article>
          <article class="overview-card">
            <div class="card-label"><el-icon><Box /></el-icon> 型号</div>
            <div class="info-value">{{ info?.model || '未提供' }}</div>
          </article>
          <article class="overview-card">
            <div class="card-label"><el-icon><Tickets /></el-icon> 序列号</div>
            <div class="info-value mono">{{ info?.serialNumber || '未提供' }}</div>
          </article>
          <article class="overview-card">
            <div class="card-label"><el-icon><Tools /></el-icon> 固件版本</div>
            <div class="info-value mono">{{ info?.firmwareVersion || '未提供' }}</div>
          </article>
          <article class="overview-card">
            <div class="card-label"><el-icon><Connection /></el-icon> 管理协议</div>
            <div class="info-value">{{ info?.transport === 'lanplus' ? 'IPMI LANPlus' : 'Redfish API' }}</div>
          </article>
        </section>

        <section class="control-panel">
          <div class="section-heading">
            <div>
              <h2>电源控制</h2>
              <p>操作会直接作用于远程服务器，请确认目标主机。</p>
            </div>
            <el-tag size="small" type="info" effect="plain">{{ info?.host }}:{{ info?.port }}</el-tag>
          </div>
          <div class="power-actions">
            <el-button type="success" :icon="VideoPlay" :loading="powerLoading === 'on'" @click="handlePower('on', '开机')">开机</el-button>
            <el-button type="warning" :icon="SwitchButton" :loading="powerLoading === 'off'" @click="handlePower('off', '关机')">关机</el-button>
            <el-button type="primary" :icon="RefreshRight" :loading="powerLoading === 'reset'" @click="handlePower('reset', '重启')">重启</el-button>
            <el-button type="danger" :icon="Refresh" :loading="powerLoading === 'cycle'" @click="handlePower('cycle', '强制重启')">强制重启</el-button>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Box,
  CircleClose,
  Close,
  Connection,
  Cpu,
  Lightning,
  OfficeBuilding,
  Refresh,
  RefreshRight,
  SwitchButton,
  Tickets,
  Tools,
  VideoPlay
} from '@element-plus/icons-vue'
import type { SessionConfig } from '@/types/session'

interface Props {
  connectionId: string
  session: SessionConfig
}

interface IPMIInfo {
  host: string
  port: number
  transport: 'redfish' | 'lanplus'
  status: 'connected' | 'error'
  manufacturer?: string
  model?: string
  serialNumber?: string
  firmwareVersion?: string
  powerState?: string
  warning?: string
}

type PowerAction = 'on' | 'off' | 'cycle' | 'reset'

const props = defineProps<Props>()
const emit = defineEmits<{ close: [connectionId: string] }>()

const connectionStatus = ref<'connecting' | 'connected' | 'error'>('connecting')
const errorMessage = ref('')
const info = ref<IPMIInfo | null>(null)
const loading = ref(false)
const powerLoading = ref<PowerAction | ''>('')

const defaultPort = computed(() =>
  props.session.ipmiOptions?.transport === 'lanplus'
    ? 623
    : props.session.ipmiOptions?.redfishHttps === false
      ? 80
      : 443
)
const displayName = computed(() => props.session.name || `IPMI ${props.session.host}`)
const statusText = computed(() => {
  if (connectionStatus.value === 'connecting') return '连接中'
  if (connectionStatus.value === 'error') return '连接失败'
  return '已连接'
})
const statusTagType = computed(() => {
  if (connectionStatus.value === 'connected') return 'success'
  if (connectionStatus.value === 'error') return 'danger'
  return 'warning'
})
const powerClass = computed(() => {
  const state = (info.value?.powerState || '').toLowerCase()
  return state.includes('on') || state.includes('运行') ? 'is-on' : state.includes('off') || state.includes('关闭') ? 'is-off' : ''
})

const connect = async () => {
  connectionStatus.value = 'connecting'
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.ipmi.connect({
      id: props.connectionId,
      host: props.session.host,
      port: props.session.port || defaultPort.value,
      username: props.session.username,
      password: props.session.password,
      ipmiOptions: props.session.ipmiOptions
    })
    if (!result.success || !result.data) throw new Error(result.error || 'IPMI 连接失败')
    info.value = result.data as IPMIInfo
    connectionStatus.value = 'connected'
  } catch (error: any) {
    connectionStatus.value = 'error'
    errorMessage.value = error?.message || 'IPMI 连接失败'
    ElMessage.error(`IPMI 连接失败：${errorMessage.value}`)
  }
}

const refresh = async () => {
  if (connectionStatus.value !== 'connected') return connect()
  loading.value = true
  try {
    const result = await window.electronAPI.ipmi.getInfo(props.connectionId)
    if (!result.success || !result.data) throw new Error(result.error || '读取 IPMI 状态失败')
    info.value = result.data as IPMIInfo
    ElMessage.success('IPMI 状态已刷新')
  } catch (error: any) {
    errorMessage.value = error?.message || '读取 IPMI 状态失败'
    connectionStatus.value = 'error'
    ElMessage.error(errorMessage.value)
  } finally {
    loading.value = false
  }
}

const handlePower = async (action: PowerAction, label: string) => {
  if (action !== 'on') {
    try {
      await ElMessageBox.confirm(`确定要对 ${displayName.value} 执行“${label}”吗？`, '确认电源操作', {
        type: 'warning',
        confirmButtonText: label,
        cancelButtonText: '取消'
      })
    } catch {
      return
    }
  }
  powerLoading.value = action
  try {
    const result = await window.electronAPI.ipmi.power(props.connectionId, action)
    if (!result.success || !result.data) throw new Error(result.error || `${label}失败`)
    info.value = result.data as IPMIInfo
    ElMessage.success(`${label}指令已发送`)
  } catch (error: any) {
    ElMessage.error(error?.message || `${label}失败`)
  } finally {
    powerLoading.value = ''
  }
}

const handleDisconnect = async () => {
  await window.electronAPI.ipmi.disconnect(props.connectionId).catch(() => {})
  emit('close', props.connectionId)
}

onMounted(connect)
onUnmounted(() => {
  window.electronAPI.ipmi.disconnect(props.connectionId).catch(() => {})
})
</script>

<style scoped>
.ipmi-tab { height: 100%; display: flex; flex-direction: column; background: var(--bg-primary); color: var(--text-primary); }
.ipmi-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--border-color); }
.ipmi-title-wrap, .ipmi-actions, .section-heading, .card-label, .power-actions { display: flex; align-items: center; }
.ipmi-title-wrap { gap: 12px; min-width: 0; }
.ipmi-logo { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; color: #fff; background: linear-gradient(135deg, #7c3aed, #2563eb); box-shadow: 0 8px 20px rgba(37, 99, 235, .22); }
.ipmi-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ipmi-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.ipmi-title span, .card-help, .section-heading p { color: var(--text-tertiary); font-size: 12px; }
.ipmi-actions { gap: 6px; }
.ipmi-content { flex: 1; min-height: 0; overflow: auto; padding: 22px; }
.ipmi-state { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--text-secondary); }
.ipmi-state p, .ipmi-state h3 { margin: 0; }
.ipmi-state span { color: var(--text-tertiary); font: 12px var(--font-mono); }
.error-state { color: var(--danger-color); }
.error-state p { color: var(--text-secondary); max-width: 520px; text-align: center; }
.loader { width: 40px; height: 40px; border: 3px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.ipmi-warning { margin-bottom: 18px; }
.overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.overview-card { min-height: 100px; padding: 16px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-secondary); box-shadow: var(--shadow-sm); }
.power-card { background: linear-gradient(135deg, rgba(124, 58, 237, .12), var(--bg-secondary) 65%); }
.card-label { gap: 6px; color: var(--text-secondary); font-size: 12px; }
.power-value, .info-value { margin-top: 14px; font-size: 20px; font-weight: 650; }
.power-value.is-on { color: var(--success-color); }
.power-value.is-off { color: var(--danger-color); }
.info-value { font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: var(--font-mono); font-size: 13px; }
.control-panel { margin-top: 18px; padding: 18px; border: 1px solid var(--border-color); border-radius: 14px; background: var(--bg-secondary); }
.section-heading { justify-content: space-between; gap: 12px; }
.section-heading h2 { margin: 0; font-size: 16px; }
.section-heading p { margin: 5px 0 0; }
.power-actions { gap: 10px; flex-wrap: wrap; margin-top: 20px; }
.power-actions .el-button { min-width: 108px; }
@media (max-width: 820px) { .overview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .ipmi-content { padding: 14px; } .overview-grid { grid-template-columns: 1fr; } }
</style>
