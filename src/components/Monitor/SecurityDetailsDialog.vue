<template>
  <el-dialog
    :model-value="modelValue"
    title="主机安全详情"
    width="860px"
    top="6vh"
    append-to-body
    class="security-details-dialog"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="details-toolbar">
      <span class="muted">
        {{ details ? `${details.hostname || '服务器'} · 采集于 ${formatTime(details.collectedAt)}` : '' }}
        <template v-if="details?.authSource && details.authSource !== 'none'">
          · 日志来源 {{ details.authSource === 'journal' ? 'journald' : details.authSource }}</template
        >
      </span>
      <el-button size="small" :icon="Refresh" :loading="loading" @click="loadDetails">刷新</el-button>
    </div>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" show-icon :closable="false" />
    <el-alert
      v-for="warning in details?.warnings || []"
      :key="warning"
      type="warning"
      :title="warning"
      :closable="false"
      class="details-alert"
    />

    <div v-loading="loading && !details" class="details-body">
      <el-tabs v-model="tab">
        <el-tab-pane :label="`来源 IP（${sources.length}）`" name="sources">
          <el-table :data="sources" size="small" max-height="420" empty-text="当前没有远程连接">
            <el-table-column label="IP" min-width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.ip }}</span>
                <span v-if="isPrivateIp(row.ip)" class="tag">内网</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <span class="trust" :class="row.level">{{ trustLabel[row.level as TrustLevel] }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="connections" label="连接" width="70" />
            <el-table-column prop="sessions" label="会话" width="70" />
            <el-table-column label="登录用户" min-width="120">
              <template #default="{ row }">{{ row.users.join(', ') || '-' }}</template>
            </el-table-column>
            <el-table-column label="操作" width="110">
              <template #default="{ row }">
                <el-button
                  v-if="row.level === 'untrusted'"
                  link
                  type="primary"
                  size="small"
                  @click="addRule(row.ip)"
                  >设为信任</el-button
                >
                <el-button
                  v-else-if="row.level === 'trusted' && rules.includes(row.ip)"
                  link
                  size="small"
                  @click="removeRule(row.ip)"
                  >取消信任</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`在线会话（${details?.sessions.length ?? 0}）`" name="sessions">
          <el-table :data="details?.sessions || []" size="small" max-height="420" empty-text="没有在线会话">
            <el-table-column prop="user" label="用户" width="110" />
            <el-table-column prop="tty" label="终端" width="90" />
            <el-table-column label="来源" min-width="160">
              <template #default="{ row }">
                <span class="mono">{{ row.host || '本地控制台' }}</span>
                <span v-if="row.ip" class="trust" :class="levelOf(row.ip)">{{
                  trustLabel[levelOf(row.ip)]
                }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="loginAt" label="登录时间" width="150" />
            <el-table-column label="空闲" width="70">
              <template #default="{ row }">{{ row.idle === '.' ? '活动' : row.idle || '-' }}</template>
            </el-table-column>
            <el-table-column label="PID" width="80">
              <template #default="{ row }">{{ row.pid || '-' }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`当前连接（${details?.connections.length ?? 0}）`" name="connections">
          <el-table
            :data="details?.connections || []"
            size="small"
            max-height="420"
            empty-text="没有 SSH / 远程访问连接"
          >
            <el-table-column label="来源" min-width="190">
              <template #default="{ row }">
                <span class="mono">{{ row.ip }}:{{ row.port }}</span>
                <span class="trust" :class="levelOf(row.ip)">{{ trustLabel[levelOf(row.ip)] }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="localPort" label="本机端口" width="90" />
            <el-table-column label="进程" min-width="140">
              <template #default="{ row }">{{ row.process || '-' }}{{ row.pid ? ` (${row.pid})` : '' }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`登录历史（${details?.logins.length ?? 0}）`" name="logins">
          <el-table :data="details?.logins || []" size="small" max-height="420" empty-text="没有登录记录（last）">
            <el-table-column prop="user" label="用户" width="100" />
            <el-table-column prop="tty" label="终端" width="80" />
            <el-table-column label="来源 IP" min-width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.ip }}</span>
                <span v-if="looksLikeIp(row.ip)" class="trust" :class="levelOf(row.ip)">{{
                  trustLabel[levelOf(row.ip)]
                }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="start" label="登录时间" width="190" />
            <el-table-column label="结束 / 状态" min-width="170">
              <template #default="{ row }">
                <span :class="{ active: row.active }">{{ row.active ? '仍在线' : row.end }}</span>
                <span v-if="row.duration" class="muted"> （{{ row.duration }}）</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`认证日志（${details?.authEvents.length ?? 0}）`" name="auth">
          <div class="log-filter">
            <el-radio-group v-model="authFilter" size="small">
              <el-radio-button value="all">全部</el-radio-button>
              <el-radio-button value="accepted">登录成功</el-radio-button>
              <el-radio-button value="failed">失败 / 非法用户</el-radio-button>
            </el-radio-group>
            <el-input v-model="authKeyword" size="small" clearable placeholder="按 IP / 用户筛选" />
          </div>
          <el-table :data="filteredEvents" size="small" max-height="380" empty-text="最近 24 小时没有匹配的认证日志">
            <el-table-column prop="time" label="时间" width="190" />
            <el-table-column label="类型" width="96">
              <template #default="{ row }">
                <span class="event" :class="row.type">{{ eventLabel[row.type as AuthEventType] }}</span>
              </template>
            </el-table-column>
            <el-table-column label="用户" width="100">
              <template #default="{ row }">{{ row.user || '-' }}</template>
            </el-table-column>
            <el-table-column label="来源" min-width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.ip || '-' }}</span>
                <span v-if="row.ip" class="trust" :class="levelOf(row.ip)">{{ trustLabel[levelOf(row.ip)] }}</span>
              </template>
            </el-table-column>
            <el-table-column label="日志" min-width="220">
              <template #default="{ row }">
                <span class="log-message" :title="row.message">{{ row.message }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane :label="`失败来源（${details?.failedSources.length ?? 0}）`" name="failed">
          <el-table
            :data="details?.failedSources || []"
            size="small"
            max-height="420"
            empty-text="最近 24 小时没有认证失败"
          >
            <el-table-column label="IP" min-width="150">
              <template #default="{ row }">
                <span class="mono">{{ row.ip }}</span>
                <span class="trust" :class="levelOf(row.ip)">{{ trustLabel[levelOf(row.ip)] }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="count" label="失败次数" width="90" />
            <el-table-column label="尝试的用户" min-width="180">
              <template #default="{ row }">{{ row.users.join(', ') || '-' }}</template>
            </el-table-column>
            <el-table-column prop="lastTime" label="最近一次" width="190" />
          </el-table>
          <p class="muted hint">如需封禁来源 IP，可在“防火墙管理”中添加规则。</p>
        </el-tab-pane>

        <el-tab-pane :label="`信任规则（${rules.length}）`" name="rules">
          <p class="muted">
            当前连接所用的 IP 自动视为可信；其它 IP 只有加入下列规则后才视为信任。规则只保存在本机，按主机区分。
          </p>
          <div class="rule-editor">
            <el-input
              v-model="ruleInput"
              size="small"
              placeholder="IP（如 203.0.113.9）或 IPv4 网段（如 10.0.0.0/8）"
              @keyup.enter="addRule(ruleInput)"
            />
            <el-button size="small" type="primary" @click="addRule(ruleInput)">添加</el-button>
          </div>
          <div class="rule-list">
            <span v-for="rule in rules" :key="rule" class="rule">
              <span class="mono">{{ rule }}</span>
              <el-button link size="small" :icon="Close" @click="removeRule(rule)" />
            </span>
            <span v-if="!rules.length" class="muted">还没有信任规则</span>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Close, Refresh } from '@element-plus/icons-vue'
import type { AuthEventType, SecurityDetails, SecuritySummary } from '@/types/security'
import {
  collectSourceIps,
  isPrivateIp,
  isValidTrustRule,
  trustLabel,
  trustLevelOf,
  type TrustLevel
} from '@/utils/security-trust'

const props = defineProps<{
  modelValue: boolean
  sessionId: string
  rules: string[]
  /** 卡片上最新的实时数据，详情未加载时用于展示来源 IP */
  summary: SecuritySummary | null
  initialTab?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:rules': [rules: string[]]
}>()

const details = ref<SecurityDetails | null>(null)
const loading = ref(false)
const errorMessage = ref('')
const tab = ref('sources')
const authFilter = ref<'all' | 'accepted' | 'failed'>('all')
const authKeyword = ref('')
const ruleInput = ref('')
let requestId = 0

const eventLabel: Record<AuthEventType, string> = {
  accepted: '登录成功',
  failed: '认证失败',
  invalid: '非法用户',
  disconnected: '断开',
  other: '其它'
}

const looksLikeIp = (value: string) => /^[\d.]+$|:/.test(value)
const levelOf = (ip: string): TrustLevel =>
  trustLevelOf(ip, props.rules, details.value?.selfIp || props.summary?.selfIp)

const sources = computed(() => {
  const base = details.value || props.summary
  return base ? collectSourceIps(base, props.rules) : []
})

const filteredEvents = computed(() => {
  const keyword = authKeyword.value.trim().toLowerCase()
  return (details.value?.authEvents || []).filter((event) => {
    if (authFilter.value === 'accepted' && event.type !== 'accepted') return false
    if (authFilter.value === 'failed' && event.type !== 'failed' && event.type !== 'invalid') return false
    if (!keyword) return true
    return `${event.ip || ''} ${event.user || ''}`.toLowerCase().includes(keyword)
  })
})

const formatTime = (value: string) => new Date(value).toLocaleTimeString()

const loadDetails = async () => {
  if (initialTabPending) {
    tab.value = props.initialTab || 'sources'
    initialTabPending = false
  }
  const id = props.sessionId
  const current = ++requestId
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await window.electronAPI.serverMonitor?.getSecurityDetails(id)
    if (current !== requestId || id !== props.sessionId) return
    if (!result?.success || !result.data) throw new Error(result?.error || '安全详情读取失败')
    details.value = result.data
  } catch (error) {
    if (current !== requestId) return
    errorMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (current === requestId) loading.value = false
  }
}

let initialTabPending = true
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    initialTabPending = true
    void loadDetails()
  },
  { immediate: true }
)
watch(
  () => props.sessionId,
  () => {
    requestId++
    details.value = null
    errorMessage.value = ''
    loading.value = false
  }
)

const addRule = (value: string) => {
  const rule = value.trim()
  if (!isValidTrustRule(rule)) {
    ElMessage.warning('请输入有效的 IP 或 IPv4 网段（如 10.0.0.0/8）')
    return
  }
  if (props.rules.includes(rule)) {
    ElMessage.info('该规则已存在')
    return
  }
  emit('update:rules', [...props.rules, rule])
  ruleInput.value = ''
  ElMessage.success(`已信任 ${rule}`)
}

const removeRule = (rule: string) => {
  emit(
    'update:rules',
    props.rules.filter((item) => item !== rule)
  )
}
</script>

<style scoped>
.details-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.details-alert {
  margin-top: 6px;
}

.details-body {
  min-height: 240px;
}

.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.hint {
  margin: 8px 0 0;
}

.mono {
  font-family: var(--font-mono, monospace);
}

.tag,
.trust,
.event {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 3px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}

.tag {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.trust.self,
.trust.local {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.trust.trusted,
.event.accepted {
  color: var(--el-color-success);
  background: var(--el-color-success-light-9);
}

.trust.untrusted,
.event.failed,
.event.invalid {
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
}

.event {
  margin-left: 0;
}

.event.disconnected,
.event.other {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color);
}

.active {
  color: var(--el-color-success);
}

.log-filter,
.rule-editor {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.log-filter .el-input {
  max-width: 220px;
}

.log-message {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rule-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rule {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px 0 8px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
}
</style>
