<template>
  <div class="fail2ban-panel">
    <div class="fail2ban-header">
      <div class="header-title-group">
        <div class="title-line">
          <span class="title-mark"><el-icon><Unlock /></el-icon></span>
          <div>
            <h3>Fail2Ban 管理</h3>
            <p>{{ subtitle }}</p>
          </div>
        </div>
      </div>
      <div class="header-actions">
        <el-button
          size="small"
          :icon="Refresh"
          :loading="loading"
          :disabled="!connected || installing || actionLoading"
          @click="loadOverview"
        >
          刷新
        </el-button>
        <el-button size="small" link :icon="Close" aria-label="关闭 Fail2Ban 面板" @click="emit('close')" />
      </div>
    </div>

    <div class="fail2ban-toolbar">
      <span class="connection-state" :class="{ ready: connected }">
        <span class="state-dot" />{{ connected ? 'SSH 已连接' : 'SSH 未连接' }}
      </span>
      <span class="capture-time" role="status">{{ captureLabel }}</span>
    </div>

    <div v-loading="loading || installing || actionLoading" class="fail2ban-content">
      <el-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        :closable="false"
        show-icon
      />

      <template v-if="overview">
        <div class="summary-grid">
          <button
            type="button"
            class="summary-card"
            :class="overview.running ? 'is-success' : 'is-warning'"
            @click="loadOverview"
          >
            <span class="summary-icon"><el-icon><Connection /></el-icon></span>
            <span class="summary-copy"><small>服务状态</small><strong>{{ serviceLabel }}</strong></span>
            <span class="summary-hint">{{ overview.enabled ? '开机启动' : '未设置自启' }}</span>
          </button>
          <button type="button" class="summary-card is-accent" @click="selectFirstJail">
            <span class="summary-icon"><el-icon><Monitor /></el-icon></span>
            <span class="summary-copy"><small>保护 Jail</small><strong>{{ overview.jails.length }}</strong></span>
            <span class="summary-hint">点击查看规则</span>
          </button>
          <button type="button" class="summary-card is-danger" @click="focusBannedIps">
            <span class="summary-icon"><el-icon><WarningFilled /></el-icon></span>
            <span class="summary-copy"><small>当前封禁</small><strong>{{ overview.totalCurrentlyBanned }}</strong></span>
            <span class="summary-hint">{{ overview.totalBanned }} 次累计封禁</span>
          </button>
          <div class="summary-card is-neutral">
            <span class="summary-icon"><el-icon><Clock /></el-icon></span>
            <span class="summary-copy"><small>累计失败</small><strong>{{ overview.totalFailed }}</strong></span>
            <span class="summary-hint">来自所有 Jail</span>
          </div>
        </div>

        <div class="environment-card">
          <div class="section-heading">
            <div>
              <span class="eyebrow">服务器环境</span>
              <h4>{{ osLabel }}</h4>
            </div>
            <el-tag :type="overview.installed ? 'success' : 'warning'" effect="plain">
              {{ overview.installed ? `已安装 ${overview.version || ''}` : '未安装' }}
            </el-tag>
          </div>
          <div class="environment-grid">
            <div><span>系统</span><strong>{{ osLabel }}</strong></div>
            <div><span>软件包管理器</span><strong>{{ overview.environment.packageManager }}</strong></div>
            <div><span>权限</span><strong>{{ privilegeLabel }}</strong></div>
            <div><span>服务</span><strong>{{ overview.serviceStatus }}</strong></div>
          </div>
          <div v-if="overview.serviceError" class="service-error">
            <span>最近一次启动错误</span>
            <code>{{ overview.serviceError }}</code>
          </div>
        </div>

        <el-alert
          v-for="warning in overview.warnings"
          :key="warning"
          type="warning"
          :title="warning"
          :closable="false"
          show-icon
        />

        <div v-if="!overview.installed || !overview.running" class="install-card">
          <div class="install-illustration"><el-icon><Download /></el-icon></div>
          <div class="install-copy">
            <strong>{{ overview.installed ? 'Fail2Ban 服务未运行' : '当前服务器未安装 Fail2Ban' }}</strong>
            <p>
              {{ overview.installed
                ? '可以尝试启动服务并设置为开机自动启动。'
                : 'MShell 会根据当前系统自动选择 apt、dnf、yum、zypper、pacman 或 apk。' }}
            </p>
          </div>
          <el-button
            type="primary"
            :icon="Download"
            :loading="installing"
            :disabled="!connected || (!overview.environment.canSudo && overview.environment.needsPrivilege)"
            @click="installFail2Ban"
          >
            {{ overview.installed ? '启动并修复' : '一键安装' }}
          </el-button>
        </div>

        <div class="jail-toolbar">
          <div>
            <span class="eyebrow">防护规则</span>
            <h4>Jail 列表</h4>
          </div>
          <el-input
            ref="searchInput"
            v-model="query"
            class="jail-search"
            size="small"
            clearable
            :prefix-icon="Search"
            placeholder="搜索 Jail 或封禁 IP"
            aria-label="搜索 Jail 或封禁 IP"
          />
        </div>

        <div v-if="filteredJails.length" class="jail-layout">
          <div class="jail-list" role="listbox" aria-label="Fail2Ban Jail 列表">
            <button
              v-for="jail in filteredJails"
              :key="jail.name"
              type="button"
              class="jail-item"
              :class="{ selected: selectedJail?.name === jail.name }"
              @click="selectedJailName = jail.name"
            >
              <span class="jail-item-main"><strong>{{ jail.name }}</strong><small>{{ jail.bannedIps.length }} 个封禁 IP</small></span>
              <span class="jail-item-count" :class="{ danger: jail.currentlyBanned > 0 }">{{ jail.currentlyBanned }}</span>
            </button>
          </div>

          <div v-if="selectedJail" class="jail-detail">
            <div class="detail-header">
              <div><span class="eyebrow">当前 Jail</span><h4>{{ selectedJail.name }}</h4></div>
              <el-tag :type="selectedJail.currentlyBanned ? 'danger' : 'success'" effect="plain">
                {{ selectedJail.currentlyBanned ? `${selectedJail.currentlyBanned} 个封禁` : '当前无封禁' }}
              </el-tag>
            </div>
            <div class="detail-stats">
              <div><span>当前失败</span><strong>{{ selectedJail.currentlyFailed }}</strong></div>
              <div><span>累计失败</span><strong>{{ selectedJail.totalFailed }}</strong></div>
              <div><span>累计封禁</span><strong>{{ selectedJail.totalBanned }}</strong></div>
            </div>
            <div class="banned-heading"><strong>封禁 IP</strong><span>{{ selectedJail.bannedIps.length }} 个</span></div>
            <div v-if="selectedJail.bannedIps.length" class="banned-list">
              <div v-for="ip in selectedJail.bannedIps" :key="ip" class="banned-row">
                <code>{{ ip }}</code>
                <el-button
                  size="small"
                  type="warning"
                  plain
                  :loading="unbanning === `${selectedJail.name}:${ip}`"
                  :disabled="!overview?.running || actionLoading"
                  @click="unbanIp(selectedJail.name, ip)"
                >
                  解封
                </el-button>
              </div>
            </div>
            <el-empty v-else :image-size="48" description="当前 Jail 没有封禁 IP" />
          </div>
        </div>
        <el-empty v-else :image-size="64" :description="overview.installed ? '没有匹配的 Jail 或封禁 IP' : '安装 Fail2Ban 后，这里会显示防护规则'" />

        <div class="beginner-note">
          <el-icon><CircleCheckFilled /></el-icon>
          <span>Fail2Ban 只负责根据日志自动封禁异常来源，不会替代防火墙、SSH 密钥或云安全组。</span>
        </div>
      </template>

      <el-empty v-else-if="!loading" :image-size="72" description="等待读取服务器环境" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheckFilled,
  Clock,
  Close,
  Connection,
  Download,
  Monitor,
  Refresh,
  Search,
  Unlock,
  WarningFilled
} from '@element-plus/icons-vue'
import type { Fail2BanJail, Fail2BanOverview } from '@/types/fail2ban'

const props = withDefaults(defineProps<{ connectionId: string; active?: boolean }>(), { active: true })
const emit = defineEmits<{ close: [] }>()

const overview = ref<Fail2BanOverview | null>(null)
const loading = ref(false)
const installing = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const query = ref('')
const selectedJailName = ref('')
const unbanning = ref('')
const now = ref(Date.now())
const searchInput = ref()
let disposed = false
let timer: ReturnType<typeof setInterval> | undefined

const connected = computed(() => Boolean(props.connectionId))
const filteredJails = computed(() => {
  const value = query.value.trim().toLowerCase()
  if (!overview.value) return []
  if (!value) return overview.value.jails
  return overview.value.jails.filter(
    (jail) => jail.name.toLowerCase().includes(value) || jail.bannedIps.some((ip) => ip.includes(value))
  )
})
const selectedJail = computed<Fail2BanJail | undefined>(() =>
  filteredJails.value.find((jail) => jail.name === selectedJailName.value) || filteredJails.value[0]
)
const osLabel = computed(() => {
  const env = overview.value?.environment
  return env ? [env.osName, env.versionId && `(${env.versionId})`].filter(Boolean).join(' ') : '正在检测'
})
const serviceLabel = computed(() => (overview.value?.running ? '运行中' : overview.value?.installed ? '未运行' : '未安装'))
const privilegeLabel = computed(() => {
  if (!overview.value?.environment.needsPrivilege) return 'root'
  return overview.value.environment.canSudo ? '可用 sudo' : '权限不足'
})
const subtitle = computed(() => (overview.value ? `${osLabel.value} · ${serviceLabel.value}` : '检测服务器环境与封禁状态'))
const captureLabel = computed(() => {
  if (!overview.value) return '尚未检测'
  const seconds = Math.max(0, Math.floor((now.value - overview.value.capturedAt) / 1000))
  return seconds < 2 ? '刚刚更新' : `${seconds} 秒前更新`
})

function acceptOverview(data: Fail2BanOverview) {
  overview.value = data
  if (!data.jails.some((jail) => jail.name === selectedJailName.value)) selectedJailName.value = data.jails[0]?.name || ''
}

async function loadOverview() {
  if (!connected.value || loading.value || installing.value || actionLoading.value || disposed) return
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.fail2ban.getOverview(props.connectionId)
    if (!result.success || !result.data) throw new Error(result.error || 'Fail2Ban 检测失败')
    acceptOverview(result.data)
  } catch (error) {
    if (!disposed) errorMessage.value = error instanceof Error ? error.message : 'Fail2Ban 检测失败'
  } finally {
    loading.value = false
  }
}

async function installFail2Ban() {
  if (!overview.value || installing.value) return
  try {
    await ElMessageBox.confirm(
      overview.value.installed
        ? '将尝试启动 Fail2Ban 并设置为开机启动。确认继续吗？'
        : `将在 ${osLabel.value} 上使用 ${overview.value.environment.packageManager} 自动安装 Fail2Ban。确认继续吗？`,
      overview.value.installed ? '启动 Fail2Ban' : '一键安装 Fail2Ban',
      { type: 'warning', confirmButtonText: '继续', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  installing.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.fail2ban.install(props.connectionId)
    if (!result.success || !result.data) throw new Error(result.error || 'Fail2Ban 安装失败')
    if (result.data.overview) acceptOverview(result.data.overview)
    if (overview.value?.running) {
      ElMessage.success('Fail2Ban 已就绪')
    } else {
      ElMessage.warning(overview.value?.serviceError || 'Fail2Ban 仍未运行，请查看服务错误并重试')
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Fail2Ban 安装失败'
    ElMessage.error(errorMessage.value)
  } finally {
    installing.value = false
  }
}

async function unbanIp(jail: string, ip: string) {
  try {
    await ElMessageBox.confirm(`确定从 ${jail} 解封 ${ip} 吗？`, '确认解封', {
      type: 'warning',
      confirmButtonText: '解封',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  unbanning.value = `${jail}:${ip}`
  actionLoading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.fail2ban.unban(props.connectionId, jail, ip)
    if (!result.success || !result.data) throw new Error(result.error || '解封失败')
    if (result.data.overview) acceptOverview(result.data.overview)
    ElMessage.success(`${ip} 已解封`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '解封失败'
    ElMessage.error(errorMessage.value)
  } finally {
    unbanning.value = ''
    actionLoading.value = false
  }
}

function selectFirstJail() {
  selectedJailName.value = overview.value?.jails[0]?.name || ''
}

async function focusBannedIps() {
  query.value = ''
  selectFirstJail()
  await nextTick()
  searchInput.value?.focus?.()
}

watch(
  () => [props.connectionId, props.active] as const,
  ([connectionId, active]) => {
    if (connectionId && active) loadOverview()
  },
  { immediate: true }
)

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  disposed = true
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.fail2ban-panel {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  background: var(--bg-main);
}

.fail2ban-header,
.fail2ban-toolbar,
.fail2ban-content {
  padding-left: 16px;
  padding-right: 16px;
}

.fail2ban-header {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(110deg, rgba(var(--primary-color-rgb), .09), transparent 55%), var(--bg-secondary);
}

.title-line,
.header-actions,
.connection-state,
.section-heading,
.jail-toolbar,
.detail-header,
.banned-heading,
.banned-row {
  display: flex;
  align-items: center;
}

.title-line { gap: 10px; }
.title-mark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), .14);
}
.fail2ban-header h3 { margin: 0; font-size: 15px; font-weight: 700; }
.fail2ban-header p { margin: 3px 0 0; color: var(--text-secondary); font-size: 11px; }
.header-actions { gap: 5px; }

.fail2ban-toolbar {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-tertiary);
  font-size: 11px;
  border-bottom: 1px solid var(--border-color);
}
.connection-state { gap: 6px; }
.state-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--danger-color); }
.connection-state.ready .state-dot { background: var(--success-color); box-shadow: 0 0 0 3px color-mix(in srgb, var(--success-color) 14%, transparent); }

.fail2ban-content { flex: 1; min-height: 0; overflow: auto; padding-top: 14px; padding-bottom: 18px; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.summary-card {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 2px 8px;
  padding: 11px;
  text-align: left;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: inherit;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: transform 160ms ease-out, border-color 160ms ease-out, background-color 160ms ease-out;
}
.summary-card:hover { border-color: rgba(var(--primary-color-rgb), .45); background: var(--bg-hover); }
.summary-card:active { transform: scale(.98); }
.summary-icon { grid-row: 1 / span 2; width: 27px; height: 27px; display: grid; place-items: center; border-radius: 8px; color: var(--primary-color); background: rgba(var(--primary-color-rgb), .12); }
.summary-card.is-success .summary-icon { color: var(--success-color); background: color-mix(in srgb, var(--success-color) 14%, transparent); }
.summary-card.is-warning .summary-icon { color: var(--warning-color); background: color-mix(in srgb, var(--warning-color) 14%, transparent); }
.summary-card.is-danger .summary-icon { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 14%, transparent); }
.summary-copy { display: flex; flex-direction: column; min-width: 0; }
.summary-copy small, .summary-hint { color: var(--text-tertiary); font-size: 10px; }
.summary-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
.summary-hint { grid-column: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.environment-card,
.install-card,
.jail-detail,
.beginner-note { margin-top: 12px; padding: 13px; border: 1px solid var(--border-color); border-radius: 11px; background: var(--bg-secondary); }
.section-heading, .jail-toolbar, .detail-header, .banned-heading { justify-content: space-between; gap: 10px; }
.eyebrow { display: block; color: var(--text-tertiary); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.section-heading h4, .jail-toolbar h4, .detail-header h4 { margin: 3px 0 0; font-size: 14px; }
.environment-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.environment-grid div, .detail-stats div { min-width: 0; padding: 8px 9px; border-radius: 8px; background: var(--bg-main); }
.environment-grid span, .detail-stats span { display: block; color: var(--text-tertiary); font-size: 10px; }
.environment-grid strong, .detail-stats strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 3px; font-size: 12px; }
.service-error { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; padding: 8px 9px; border-radius: 8px; color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 9%, transparent); }
.service-error span { font-size: 10px; }
.service-error code { overflow-wrap: anywhere; color: inherit; font-family: var(--font-mono); font-size: 10px; line-height: 1.45; }

.install-card { display: flex; align-items: center; gap: 11px; border-color: rgba(var(--primary-color-rgb), .26); background: linear-gradient(110deg, rgba(var(--primary-color-rgb), .08), var(--bg-secondary)); }
.install-illustration { flex: 0 0 auto; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 10px; color: var(--primary-color); background: rgba(var(--primary-color-rgb), .15); }
.install-copy { min-width: 0; flex: 1; }
.install-copy strong { display: block; font-size: 13px; }
.install-copy p { margin: 3px 0 0; color: var(--text-secondary); font-size: 11px; line-height: 1.45; }

.jail-toolbar { margin-top: 18px; }
.jail-search { width: min(230px, 50%); }
.jail-layout { display: grid; grid-template-columns: minmax(130px, .36fr) minmax(0, 1fr); gap: 9px; margin-top: 9px; }
.jail-list { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.jail-item { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; border: 1px solid var(--border-color); border-radius: 9px; color: inherit; background: var(--bg-secondary); text-align: left; cursor: pointer; transition: border-color 160ms ease-out, background-color 160ms ease-out, transform 160ms ease-out; }
.jail-item:hover { border-color: rgba(var(--primary-color-rgb), .4); background: var(--bg-hover); }
.jail-item:active { transform: scale(.99); }
.jail-item.selected { border-color: var(--primary-color); background: rgba(var(--primary-color-rgb), .1); }
.jail-item-main { min-width: 0; display: flex; flex-direction: column; }
.jail-item-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.jail-item-main small { margin-top: 2px; color: var(--text-tertiary); font-size: 10px; }
.jail-item-count { min-width: 22px; padding: 3px 6px; border-radius: 999px; color: var(--text-secondary); background: var(--bg-main); text-align: center; font-size: 11px; }
.jail-item-count.danger { color: var(--danger-color); background: color-mix(in srgb, var(--danger-color) 14%, transparent); }
.jail-detail { min-width: 0; margin-top: 0; }
.detail-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 12px; }
.banned-heading { margin-top: 14px; color: var(--text-secondary); font-size: 11px; }
.banned-heading span { color: var(--text-tertiary); }
.banned-list { display: flex; flex-direction: column; gap: 5px; margin-top: 7px; }
.banned-row { justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 7px; background: var(--bg-main); }
.banned-row code { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); font-family: var(--font-mono); font-size: 11px; }
.beginner-note { display: flex; align-items: flex-start; gap: 7px; color: var(--text-secondary); font-size: 11px; line-height: 1.5; }
.beginner-note .el-icon { flex: 0 0 auto; margin-top: 1px; color: var(--success-color); }

@media (max-width: 640px) {
  .summary-grid, .environment-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .jail-layout { grid-template-columns: 1fr; }
  .jail-detail { margin-top: 0; }
  .jail-search { width: 52%; }
  .install-card { align-items: flex-start; flex-wrap: wrap; }
  .install-card .el-button { margin-left: 45px; }
}

@media (prefers-reduced-motion: reduce) {
  .summary-card, .jail-item { transition: none; }
}
</style>
