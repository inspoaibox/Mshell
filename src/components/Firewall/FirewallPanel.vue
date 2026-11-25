<template>
  <div class="firewall-panel">
    <header class="firewall-header">
      <div class="header-copy">
        <h3>防火墙</h3>
        <p>{{ systemLabel }}</p>
      </div>
      <div class="header-actions">
        <el-tooltip content="重新检测" placement="bottom">
          <el-button
            :icon="Refresh"
            circle
            :loading="loading"
            :disabled="actionLoading"
            aria-label="重新检测防火墙"
            @click="loadOverview"
          />
        </el-tooltip>
        <el-tooltip content="关闭" placement="bottom">
          <el-button :icon="Close" circle aria-label="关闭防火墙面板" @click="$emit('close')" />
        </el-tooltip>
      </div>
    </header>

    <div v-loading="loading || actionLoading" class="firewall-content">
      <el-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        show-icon
        :closable="false"
      />

      <template v-if="overview">
        <div class="firewall-freshness">{{ updatedLabel }} · 页面可见时约每 15 秒更新</div>
        <el-alert
          v-for="message in overview.errors"
          :key="message"
          :title="message"
          type="warning"
          :closable="false"
        />
        <el-alert v-if="pending" type="warning" :closable="false" title="启用等待确认">
          请另开 SSH 会话测试登录。{{ remaining }} 秒内未确认会自动停用。
          <el-button :disabled="!remaining || actionLoading" @click="confirmEnable"
            >已验证连接，保留启用</el-button
          >
        </el-alert>
        <section class="status-band" :class="`is-${protectionState.tone}`">
          <div class="status-icon">
            <el-icon><component :is="protectionState.icon" /></el-icon>
          </div>
          <div class="status-copy">
            <span>服务器入站防护</span>
            <strong>{{ protectionState.title }}</strong>
            <p>{{ protectionState.description }}</p>
          </div>
          <div class="status-facts">
            <span
              ><b>{{ primaryToolLabel }}</b
              >管理方式</span
            >
            <span
              ><b>{{ primaryRules.length }}</b
              >可识别规则</span
            >
          </div>
        </section>

        <el-alert
          v-if="overview.needsPrivilege && !overview.canSudo"
          type="warning"
          title="当前 SSH 用户没有免密 sudo 权限，只能查看状态，无法安全修改防火墙。"
          show-icon
          :closable="false"
        />

        <el-alert
          v-if="usesNftBackend"
          type="info"
          title="当前 iptables 使用 nftables 后端。两者属于同一套底层规则，MShell 将统一通过 iptables 管理。"
          show-icon
          :closable="false"
        />

        <el-tabs v-model="activeSection" class="firewall-tabs">
          <el-tab-pane label="入站规则" name="rules">
            <section class="rules-view">
              <div v-if="primaryTool?.id === 'firewalld'" class="zone-picker">
                <label>规则所属 zone</label>
                <el-select
                  v-model="selectedZone"
                  :disabled="actionLoading"
                  aria-label="规则所属 zone"
                >
                  <el-option
                    v-for="zone in overview.zones"
                    :key="zone.name"
                    :value="zone.name"
                    :label="zone.name + (zone.name === overview.sshZone ? ' · 当前 SSH' : '')"
                  />
                </el-select>
                <small v-if="overview.zoneError">{{ overview.zoneError }}</small>
              </div>
              <div class="section-header">
                <div>
                  <strong>允许访问的服务</strong>
                  <span>仅显示当前管理方式中可安全识别的入站规则</span>
                </div>
                <el-button
                  type="primary"
                  :icon="Plus"
                  :disabled="!canAddRule"
                  @click="openRuleDialog"
                >
                  添加规则
                </el-button>
              </div>

              <el-alert
                v-if="primaryTool?.id === 'nftables'"
                type="warning"
                title="检测到原生 nftables 入站规则。为避免跨管理器改写，当前提供只读查看。"
                :closable="false"
                show-icon
              />

              <div v-if="primaryRules.length" class="rule-list">
                <article v-for="rule in primaryRules" :key="rule.key" class="rule-row">
                  <span class="rule-indicator" :class="`is-${rule.action}`" />
                  <div class="rule-main">
                    <div class="rule-heading">
                      <strong>{{ rule.service || formatRulePort(rule) }}</strong>
                      <span>{{
                        rule.protocol?.toUpperCase() || (rule.service ? '按服务定义' : '详见规则')
                      }}</span>
                      <el-tag v-if="rule.family" size="small" type="info">{{ rule.family }}</el-tag>
                      <el-tag
                        v-if="rule.persistent && (rule.managed || rule.tool === 'firewalld')"
                        size="small"
                        type="success"
                        >永久配置</el-tag
                      >
                      <el-tag
                        v-if="rule.persistent === false && rule.managed"
                        size="small"
                        type="warning"
                        >临时</el-tag
                      >
                      <el-tag v-if="rule.runtime === false" size="small" type="warning"
                        >仅保存，未生效</el-tag
                      >
                      <el-tag
                        v-else-if="rule.tool === 'firewalld' && !rule.persistent"
                        size="small"
                        type="info"
                        >仅运行时</el-tag
                      >
                    </div>
                    <div class="rule-source">
                      <span>{{ rule.actionLabel }}</span>
                      <span>来源：{{ rule.source || '所有来源' }}</span>
                    </div>
                    <details>
                      <summary>查看原始规则</summary>
                      <code>{{ rule.raw }}</code>
                    </details>
                    <small v-if="rule.protectionReason" class="rule-protection">{{
                      rule.protectionReason
                    }}</small>
                  </div>
                  <el-tooltip v-if="rule.deletable" content="删除规则" placement="left">
                    <el-button
                      :icon="Delete"
                      circle
                      type="danger"
                      plain
                      :aria-label="`删除 ${formatRulePort(rule)} 规则`"
                      :disabled="!canManage || conflict"
                      @click="deleteRule(rule)"
                    />
                  </el-tooltip>
                </article>
              </div>

              <div v-else class="empty-rules">
                <el-icon><Lock /></el-icon>
                <strong>暂无可识别的开放规则</strong>
                <p v-if="canAddRule">添加规则时，建议只允许当前 SSH 来源 IP。</p>
                <p v-else>请在“系统详情”中检查已安装的防火墙工具。</p>
              </div>

              <section v-if="overview.containerPorts.length" class="container-ports">
                <div class="section-header compact">
                  <div>
                    <strong>容器发布端口</strong>
                    <span>由 Docker 管理，不计入上方主机入站规则</span>
                  </div>
                </div>
                <div
                  v-for="item in overview.containerPorts"
                  :key="`${item.container}:${item.published}`"
                  class="container-port-row"
                >
                  <el-icon><Box /></el-icon>
                  <div>
                    <strong>{{ item.container }}</strong>
                    <span>{{ item.published }}</span>
                  </div>
                </div>
              </section>
            </section>
          </el-tab-pane>

          <el-tab-pane label="系统详情" name="details">
            <section class="details-view">
              <div class="detail-summary">
                <div>
                  <span>操作系统</span><strong :title="systemLabel">{{ systemLabel }}</strong>
                </div>
                <div>
                  <span>当前 SSH 来源</span><strong>{{ overview.sshClientIp || '未识别' }}</strong>
                </div>
                <div>
                  <span>SSH 服务端口</span><strong>{{ overview.sshServerPort || '未识别' }}</strong>
                </div>
              </div>

              <div class="detail-section">
                <div class="section-header compact">
                  <div><strong>防火墙工具</strong><span>安装和服务状态仅供高级管理使用</span></div>
                </div>
                <div class="tool-list">
                  <div v-for="tool in overview.tools" :key="tool.id" class="tool-row">
                    <span
                      class="tool-dot"
                      :class="{ installed: tool.installed, active: tool.active }"
                    />
                    <div class="tool-copy">
                      <strong>{{ toolDisplayName(tool) }}</strong>
                      <span>{{ describeTool(tool) }}</span>
                    </div>
                    <div class="tool-actions">
                      <el-tag v-if="isRecommendedInstall(tool)" size="small" type="success">
                        推荐
                      </el-tag>
                      <el-tag
                        size="small"
                        :type="
                          tool.status === 'unknown'
                            ? 'warning'
                            : tool.active
                              ? 'success'
                              : tool.installed
                                ? 'info'
                                : undefined
                        "
                      >
                        {{
                          tool.status === 'unknown'
                            ? '状态未知'
                            : tool.active
                              ? '运行中'
                              : tool.installed
                                ? '已安装'
                                : '未安装'
                        }}
                      </el-tag>
                      <el-button
                        v-if="canInstallTool(tool)"
                        size="small"
                        :icon="Download"
                        :disabled="!canManage"
                        @click="installFirewall(tool.id)"
                        >安装</el-button
                      >
                      <el-button
                        v-if="canEnableTool(tool)"
                        size="small"
                        :disabled="
                          !canSafelyEnable || (tool.id === 'firewalld' && !overview.sshZone)
                        "
                        @click="enableFirewall(tool.id)"
                        >启用</el-button
                      >
                      <el-button
                        v-if="canDisableTool(tool)"
                        size="small"
                        type="danger"
                        plain
                        :disabled="!canManage"
                        @click="disableFirewall(tool.id)"
                        >停用</el-button
                      >
                    </div>
                  </div>
                </div>
              </div>

              <div v-if="primaryTool?.id === 'iptables'" class="persistence-status">
                <el-icon><RefreshRight /></el-icon>
                <div>
                  <strong>MShell 规则开机恢复</strong>
                  <span>{{
                    overview.persistenceEnabled
                      ? '已启用，只恢复 MSHELL-INPUT，不保存 Docker 规则'
                      : '尚未创建，将在首次添加永久规则时自动启用'
                  }}</span>
                </div>
                <el-tag size="small" :type="overview.persistenceEnabled ? 'success' : 'info'">
                  {{ overview.persistenceEnabled ? '已启用' : '未配置' }}
                </el-tag>
              </div>

              <el-alert
                v-if="overview.tools.some(canEnableTool) && !canSafelyEnable"
                type="warning"
                title="启用需要完整的 SSH 来源、端口和自动回滚能力；信息不完整时已禁用。"
                :closable="false"
                show-icon
              />

              <el-collapse class="advanced-collapse">
                <el-collapse-item name="raw">
                  <template #title
                    ><span class="collapse-title"
                      ><el-icon><Document /></el-icon>原始规则</span
                    ></template
                  >
                  <div v-for="tool in installedTools" :key="tool.id" class="raw-group">
                    <strong>{{ toolDisplayName(tool) }}</strong>
                    <pre>{{ rawRulesFor(tool.id) }}</pre>
                  </div>
                </el-collapse-item>
                <el-collapse-item v-if="lastOutput" name="output">
                  <template #title
                    ><span class="collapse-title"
                      ><el-icon><Monitor /></el-icon>最近操作输出</span
                    ></template
                  >
                  <pre class="command-output">{{ lastOutput }}</pre>
                </el-collapse-item>
              </el-collapse>
            </section>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <el-dialog
      v-model="ruleDialogVisible"
      class="firewall-rule-dialog"
      width="min(520px, calc(100vw - 32px))"
      :title="ruleStep === 'edit' ? '添加开放规则' : '确认规则'"
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="!actionLoading"
      :show-close="!actionLoading"
      @closed="resetRuleDialog"
    >
      <template v-if="ruleStep === 'edit'">
        <div class="dialog-intro">选择要开放的服务，并明确谁可以访问。</div>
        <div class="rule-form">
          <div class="form-field">
            <label for="firewall-preset">服务</label>
            <el-select id="firewall-preset" v-model="selectedPreset" @change="applyPortPreset">
              <el-option
                v-for="preset in FIREWALL_PORT_PRESETS"
                :key="preset.value"
                :label="preset.label"
                :value="preset.value"
              />
            </el-select>
          </div>
          <div class="form-field">
            <label for="firewall-ports">端口</label>
            <el-input
              id="firewall-ports"
              v-model="ruleForm.ports"
              placeholder="例如 443、80,443 或 1000-2000"
              @input="selectedPreset = 'custom'"
            />
            <span>支持单个端口、多个端口和端口范围</span>
          </div>
          <div class="form-field">
            <label>协议</label>
            <el-radio-group v-model="ruleForm.protocol">
              <el-radio-button value="tcp">TCP</el-radio-button>
              <el-radio-button value="udp">UDP</el-radio-button>
              <el-radio-button value="both">TCP + UDP</el-radio-button>
            </el-radio-group>
          </div>
          <fieldset class="source-options">
            <legend>允许来源</legend>
            <label
              :class="{
                selected: ruleForm.sourceMode === 'current',
                disabled: !overview?.sshClientIp
              }"
            >
              <input
                v-model="ruleForm.sourceMode"
                type="radio"
                value="current"
                :disabled="!overview?.sshClientIp"
              />
              <span
                ><strong>当前 SSH 来源 IP</strong
                ><small>{{ overview?.sshClientIp || '未识别到当前来源' }} · 推荐</small></span
              >
            </label>
            <label :class="{ selected: ruleForm.sourceMode === 'custom' }">
              <input v-model="ruleForm.sourceMode" type="radio" value="custom" />
              <span><strong>指定 IP 或网段</strong><small>仅允许可信设备或网络访问</small></span>
            </label>
            <label
              :class="{
                selected: ruleForm.sourceMode === 'any',
                danger: ruleForm.sourceMode === 'any'
              }"
            >
              <input v-model="ruleForm.sourceMode" type="radio" value="any" />
              <span><strong>所有来源</strong><small>服务将可以从公网访问</small></span>
            </label>
          </fieldset>
          <div v-if="ruleForm.sourceMode === 'custom'" class="form-field">
            <label for="firewall-sources">IP 或 CIDR</label>
            <el-input
              id="firewall-sources"
              v-model="ruleForm.customSources"
              placeholder="例如 203.0.113.8 或 10.0.0.0/24"
            />
            <span>多个地址可使用逗号或空格分隔</span>
          </div>
          <label v-if="primaryTool?.id === 'iptables'" class="persistence-option">
            <el-switch
              v-model="ruleForm.persist"
              :disabled="!overview?.canPersist"
              aria-label="重启后保留规则"
            />
            <span>
              <strong>重启后继续生效</strong>
              <small>{{
                overview?.canPersist
                  ? '使用 MShell 专用规则链，不保存 Docker 动态规则'
                  : '当前未运行 systemd，仅支持临时规则'
              }}</small>
            </span>
          </label>
        </div>
      </template>

      <template v-else-if="rulePlan">
        <div class="review-list">
          <div>
            <span>端口</span><strong>{{ rulePlan.ports.join(', ') }}</strong>
          </div>
          <div>
            <span>协议</span
            ><strong>{{ rulePlan.protocols.map((item) => item.toUpperCase()).join(' + ') }}</strong>
          </div>
          <div>
            <span>来源</span
            ><strong>{{
              rulePlan.sources.length ? rulePlan.sources.join(', ') : '所有来源'
            }}</strong>
          </div>
          <div>
            <span>管理方式</span><strong>{{ primaryToolLabel }}</strong>
          </div>
          <div v-if="rulePlan.zone">
            <span>目标 zone</span><strong>{{ rulePlan.zone }}</strong>
          </div>
          <div>
            <span>生效方式</span
            ><strong>{{ rulePlan.persistent ? '永久规则' : '可能需要另行持久化' }}</strong>
          </div>
        </div>
        <el-alert
          v-for="warning in rulePlan.warnings"
          :key="warning"
          :type="rulePlan.risk === 'danger' ? 'error' : 'warning'"
          :title="warning"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="iptablesOpenByDefault"
          type="warning"
          title="当前 INPUT 默认策略为 ACCEPT。该规则会永久保留，但不会阻止其他未列出的端口。"
          :closable="false"
          show-icon
        />
      </template>

      <el-alert v-if="formError" type="error" :title="formError" :closable="false" show-icon />
      <template #footer>
        <el-button :disabled="actionLoading" @click="ruleDialogVisible = false">取消</el-button>
        <el-button
          v-if="ruleStep === 'review'"
          :icon="ArrowLeft"
          :disabled="actionLoading"
          @click="ruleStep = 'edit'"
          >返回修改</el-button
        >
        <el-button v-if="ruleStep === 'edit'" type="primary" @click="prepareRuleReview"
          >检查并继续</el-button
        >
        <el-button v-else type="primary" :loading="actionLoading" @click="allowRule"
          >确认添加</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  Box,
  CircleCheckFilled,
  Close,
  Delete,
  Document,
  Download,
  InfoFilled,
  Lock,
  Monitor,
  Plus,
  Refresh,
  RefreshRight,
  WarningFilled
} from '@element-plus/icons-vue'
import {
  FIREWALL_PORT_PRESETS,
  FIREWALL_TOOL_LABELS,
  createFirewallRulePlan,
  displayFirewallLabel,
  firewallConflict,
  normalizeFirewallRules,
  recommendedFirewall,
  selectPrimaryFirewall,
  shouldOfferFirewallInstall,
  type FirewallAction,
  type FirewallOverview,
  type FirewallRule,
  type FirewallRulePlan,
  type FirewallTool,
  type RuleProtocol,
  type RuleSourceMode
} from '../../utils/firewall-model'
const props = withDefaults(defineProps<{ connectionId: string; active?: boolean }>(), {
  active: true
})
defineEmits<{ close: [] }>()
const overview = ref<FirewallOverview | null>(null),
  loading = ref(false),
  actionLoading = ref(false),
  errorMessage = ref(''),
  lastOutput = ref('')
const stale = ref(true),
  now = ref(Date.now()),
  activeSection = ref<'rules' | 'details'>('rules'),
  selectedZone = ref('')
const ruleDialogVisible = ref(false),
  ruleStep = ref<'edit' | 'review'>('edit'),
  rulePlan = ref<FirewallRulePlan | null>(null),
  selectedPreset = ref('custom'),
  formError = ref('')
const ruleForm = ref({
  ports: '',
  protocol: 'tcp' as RuleProtocol,
  sourceMode: 'custom' as RuleSourceMode,
  customSources: '',
  persist: true
})
const pending = ref<{ token: string; expiresAt: number; tool: 'ufw' | 'firewalld' } | null>(null)
let disposed = false,
  generation = 0,
  request: Promise<void> | undefined,
  timer: ReturnType<typeof setInterval> | undefined
let reviewContext: Pick<FirewallOverview, 'sshClientIp' | 'sshServerPort' | 'sshZone'> | undefined,
  reviewConnection = ''
const releases: Array<() => void> = []
const installedTools = computed(() => overview.value?.tools.filter((t) => t.installed) || [])
const primaryTool = computed(() =>
  overview.value ? selectPrimaryFirewall(overview.value) : undefined
)
const allRules = computed(() => normalizeFirewallRules(overview.value))
const primaryRules = computed(() =>
  allRules.value.filter(
    (rule) =>
      rule.tool === primaryTool.value?.id &&
      (rule.tool !== 'firewalld' || rule.zone === selectedZone.value)
  )
)
const primaryToolLabel = computed(() =>
  overview.value ? displayFirewallLabel(primaryTool.value, overview.value) : '检测中'
)
const usesNftBackend = computed(
  () => primaryTool.value?.id === 'iptables' && overview.value?.iptablesBackend === 'nf_tables'
)
const conflict = computed(() => (overview.value ? firewallConflict(overview.value) : false))
const canManage = computed(
  () =>
    !!overview.value &&
    !stale.value &&
    !overview.value.errors.length &&
    !actionLoading.value &&
    !pending.value
)
const iptablesOpenByDefault = computed(
  () =>
    primaryTool.value?.id === 'iptables' &&
    Object.values(overview.value?.iptablesPolicies || {}).some((policy) => policy === 'ACCEPT')
)
const canAddRule = computed(
  () =>
    canManage.value &&
    !conflict.value &&
    !overview.value?.nativeNftInput &&
    !!primaryTool.value &&
    ['ufw', 'firewalld', 'iptables'].includes(primaryTool.value.id) &&
    (primaryTool.value.id === 'iptables' || primaryTool.value.active)
)
const canSafelyEnable = computed(
  () =>
    canManage.value &&
    overview.value?.canWatchdog &&
    !!overview.value.sshClientIp &&
    !!overview.value.sshServerPort &&
    !conflict.value
)
const systemLabel = computed(
  () => overview.value?.osName || overview.value?.osId || '正在检测服务器'
)
const recommendedInstallTool = computed(() =>
  overview.value ? recommendedFirewall(overview.value) : 'ufw'
)
const shouldRecommendInstall = computed(
  () => !!overview.value && shouldOfferFirewallInstall(overview.value)
)
const remaining = computed(() =>
  Math.max(0, Math.ceil(((pending.value?.expiresAt || 0) - now.value) / 1000))
)
const updatedLabel = computed(() =>
  overview.value
    ? Math.max(0, Math.floor((now.value - overview.value.capturedAt) / 1000)) + ' 秒前检测'
    : '尚未检测'
)
const protectionState = computed(() => {
  if (stale.value || overview.value?.errors.length)
    return {
      tone: 'warning',
      icon: markRaw(WarningFilled),
      title: '状态未知，已暂停修改',
      description: '检测失败或连接已变化，请重新检测后操作。'
    }
  if (conflict.value)
    return {
      tone: 'warning',
      icon: markRaw(WarningFilled),
      title: '多个管理器同时控制入站流量',
      description: '已阻止新增与跨管理器删除，请先确认配置归属。'
    }
  if (overview.value?.nativeNftInput)
    return {
      tone: 'info',
      icon: markRaw(InfoFilled),
      title: '检测到原生 nftables 入站规则',
      description: '以内核规则为准；当前提供只读查看。'
    }
  if (iptablesOpenByDefault.value)
    return {
      tone: 'warning',
      icon: markRaw(WarningFilled),
      title: 'INPUT 默认允许，开放规则不代表其他端口被关闭',
      description: '这里只描述主机 INPUT；容器转发与云安全组需分别检查。'
    }
  if (primaryTool.value?.active)
    return {
      tone: 'success',
      icon: markRaw(CircleCheckFilled),
      title: '已读取当前防火墙规则',
      description: '主机规则已检测；不代表云安全组或容器端口的最终可达性。'
    }
  return {
    tone: 'info',
    icon: markRaw(InfoFilled),
    title: '当前管理工具未启用或没有可识别的限制',
    description: '请查看系统详情，不能仅凭服务状态判断公网访问。'
  }
})
const contextOf = (data: FirewallOverview) => ({
  sshClientIp: data.sshClientIp,
  sshServerPort: data.sshServerPort,
  sshZone: data.sshZone
})
function acceptOverview(data: FirewallOverview) {
  overview.value = data
  stale.value = false
  if (!data.zones.some((z) => z.name === selectedZone.value))
    selectedZone.value = data.sshZone || data.defaultZone || data.zones[0]?.name || ''
}
function loadOverview(): Promise<void> {
  if (disposed || actionLoading.value) return Promise.resolve()
  if (request) return request
  const id = props.connectionId,
    version = ++generation
  loading.value = true
  request = (async () => {
    try {
      const result = await window.electronAPI.firewall.inspect(id)
      if (disposed || version !== generation || id !== props.connectionId) return
      if (!result.success || !result.data) throw new Error(result.error || '检测失败')
      acceptOverview(result.data)
      errorMessage.value = ''
      if (pending.value && Date.now() > pending.value.expiresAt + 10000) {
        const active = result.data.tools.find((t) => t.id === pending.value!.tool)?.active
        if (active) {
          stale.value = true
          errorMessage.value = '回滚结果尚未验证，请检查服务器防火墙状态'
        } else errorMessage.value = '启用未确认，防火墙已自动停用'
        pending.value = null
      }
    } catch (error) {
      if (!disposed && version === generation) {
        stale.value = true
        errorMessage.value = error instanceof Error ? error.message : '检测失败'
      }
    } finally {
      if (version === generation) loading.value = false
    }
  })().finally(() => {
    if (version === generation) request = undefined
  })
  return request
}
function resetRuleDialog() {
  ruleStep.value = 'edit'
  rulePlan.value = null
  selectedPreset.value = 'custom'
  formError.value = ''
  ruleForm.value = {
    ports: '',
    protocol: 'tcp',
    sourceMode: overview.value?.sshClientIp ? 'current' : 'custom',
    customSources: '',
    persist: overview.value?.canPersist ?? false
  }
}
function openRuleDialog() {
  if (!canAddRule.value) return
  resetRuleDialog()
  ruleDialogVisible.value = true
}
function applyPortPreset(value: string) {
  const preset = FIREWALL_PORT_PRESETS.find((p) => p.value === value)
  if (!preset || value === 'custom') return
  ruleForm.value.ports =
    value === 'ssh' ? String(overview.value?.sshServerPort || 22) : preset.ports
  ruleForm.value.protocol = preset.protocol
}
function prepareRuleReview() {
  formError.value = ''
  if (!primaryTool.value || !overview.value) return
  try {
    rulePlan.value = createFirewallRulePlan({
      tool: primaryTool.value.id,
      ...ruleForm.value,
      sshClientIp: overview.value.sshClientIp,
      sshServerPort: overview.value.sshServerPort,
      zone: primaryTool.value.id === 'firewalld' ? selectedZone.value : undefined
    })
    reviewContext = contextOf(overview.value)
    reviewConnection = props.connectionId
    ruleStep.value = 'review'
  } catch (error) {
    formError.value = error instanceof Error ? error.message : '规则无效'
  }
}
async function allowRule() {
  const plan = rulePlan.value
  if (!plan || !reviewContext || actionLoading.value) return
  const ok = await perform(
    {
      type: 'allow',
      draft: {
        tool: plan.tool,
        ports: plan.ports.join(','),
        protocol: plan.protocols.length === 2 ? 'both' : plan.protocols[0],
        sourceMode: plan.sourceMode,
        customSources: plan.sources.join(','),
        sshClientIp: reviewContext.sshClientIp,
        sshServerPort: reviewContext.sshServerPort,
        persist: plan.persistent,
        zone: plan.zone
      }
    },
    reviewConnection,
    reviewContext
  )
  if (ok) ruleDialogVisible.value = false
}
async function perform(
  action: FirewallAction,
  id = props.connectionId,
  context:
    | Pick<FirewallOverview, 'sshClientIp' | 'sshServerPort' | 'sshZone'>
    | undefined = overview.value ? contextOf(overview.value) : undefined
) {
  if (actionLoading.value || !context || disposed) return false
  actionLoading.value = true
  errorMessage.value = ''
  formError.value = ''
  generation++
  request = undefined
  loading.value = false
  let ok = false
  try {
    const result = await window.electronAPI.firewall.apply(id, action, context)
    if (disposed || id !== props.connectionId) return false
    if (!result.success || !result.data) throw new Error(result.error || '操作失败')
    acceptOverview(result.data.overview)
    lastOutput.value = result.data.output
    if (result.data.pending && action.type === 'enable')
      pending.value = { ...result.data.pending, tool: action.tool }
    ElMessage.success(
      result.data.pending ? '已临时启用，请测试连接后确认保留' : '操作完成并已重新验证'
    )
    ok = true
  } catch (error) {
    if (!disposed && id === props.connectionId) {
      const message = error instanceof Error ? error.message : '操作失败'
      errorMessage.value = message
      formError.value = message
      lastOutput.value = message
      stale.value = true
      ElMessage.error(message)
    }
  } finally {
    actionLoading.value = false
    // On failure, retain the visible error while reading the actual post-rollback state.
    if (!ok && !disposed && id === props.connectionId) {
      const message = errorMessage.value
      await loadOverview()
      errorMessage.value = message
    }
  }
  return ok
}
function canEnableTool(tool: FirewallTool) {
  return tool.installed && !tool.active && ['ufw', 'firewalld'].includes(tool.id)
}
function canInstallTool(tool: FirewallTool) {
  return !tool.installed && ['ufw', 'firewalld'].includes(tool.id)
}
function isRecommendedInstall(tool: FirewallTool) {
  return shouldRecommendInstall.value && tool.id === recommendedInstallTool.value
}
function canDisableTool(tool: FirewallTool) {
  return tool.active && ['ufw', 'firewalld'].includes(tool.id)
}
async function confirmAction(action: FirewallAction, message: string, title: string) {
  if (!canManage.value || !overview.value) return
  const id = props.connectionId,
    context = contextOf(overview.value)
  try {
    await ElMessageBox.confirm(message, title, {
      type: 'warning',
      confirmButtonText: '确认',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  if (disposed || id !== props.connectionId) return
  await perform(action, id, context)
}
function enableFirewall(tool: FirewallTool['id']) {
  if ((tool !== 'ufw' && tool !== 'firewalld') || !overview.value) return
  return confirmAction(
    { type: 'enable', tool },
    `先保护 SSH ${overview.value.sshClientIp}:${overview.value.sshServerPort}${tool === 'firewalld' ? '，实际 zone：' + (overview.value.sshZone || '未确定') : ''}。启用后需另开 SSH 会话确认可连接，90 秒未确认会自动停用。`,
    '限时启用防火墙'
  )
}
function disableFirewall(tool: FirewallTool['id']) {
  if (tool === 'ufw' || tool === 'firewalld')
    return confirmAction(
      { type: 'disable', tool },
      `停用 ${FIREWALL_TOOL_LABELS[tool]} 后可能失去访问控制。`,
      '确认停用'
    )
}
function installFirewall(tool: FirewallTool['id']) {
  if (tool === 'ufw' || tool === 'firewalld')
    return confirmAction(
      { type: 'install', tool },
      `使用系统软件源安装 ${FIREWALL_TOOL_LABELS[tool]}，不会跳过仓库校验。`,
      '确认安装'
    )
}
function deleteRule(rule: FirewallRule) {
  if (!rule.deletable) {
    ElMessage.warning(rule.protectionReason || '该规则只读')
    return
  }
  return confirmAction(
    { type: 'delete', key: rule.key },
    `删除 ${rule.zone ? 'zone ' + rule.zone + ' 中的 ' : ''}${formatRulePort(rule)}，来源 ${rule.source || '所有来源'}。提交前会重新核对规则与 SSH 保护。`,
    '确认删除规则'
  )
}
async function confirmEnable() {
  if (!pending.value || !remaining.value || actionLoading.value) return
  const id = props.connectionId,
    token = pending.value.token
  actionLoading.value = true
  try {
    const result = await window.electronAPI.firewall.confirm(id, token)
    if (disposed || id !== props.connectionId) return
    if (!result.success || !result.data) throw new Error(result.error || '确认失败')
    acceptOverview(result.data)
    pending.value = null
    ElMessage.success('已保留防火墙启用状态')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '确认失败'
    stale.value = true
  } finally {
    actionLoading.value = false
  }
}
const formatRulePort = (rule: FirewallRule) => (rule.port ? '端口 ' + rule.port : rule.summary)
const toolDisplayName = (tool: FirewallTool) =>
  overview.value ? displayFirewallLabel(tool, overview.value) : tool.label
const describeTool = (tool: FirewallTool) =>
  tool.status === 'unknown'
    ? '读取失败，状态未知'
    : !tool.installed
      ? '未安装'
      : tool.id === 'nftables'
        ? '以当前内核 ruleset 为准'
        : tool.version || '状态已检测'
const rawRulesFor = (tool: FirewallTool['id']) =>
  overview.value?.rawRules[tool].join('\n') || '暂无输出'
function invalidate() {
  generation++
  request = undefined
  loading.value = false
  stale.value = true
  overview.value = null
  pending.value = null
  ruleDialogVisible.value = false
  void loadOverview()
}
function visibilityChanged() {
  if (!document.hidden && props.active) void loadOverview()
}
watch(() => props.connectionId, invalidate)
watch(
  () => props.active,
  (active) => {
    if (active) void loadOverview()
  }
)
onMounted(() => {
  void loadOverview()
  releases.push(
    window.electronAPI.firewall.onChanged((id) => {
      if (id === props.connectionId && !actionLoading.value) void loadOverview()
    })
  )
  releases.push(
    window.electronAPI.ssh.onClose((id) => {
      if (id === props.connectionId) {
        generation++
        request = undefined
        loading.value = false
        stale.value = true
        errorMessage.value = 'SSH 已断开，重连后将重新检测'
      }
    })
  )
  releases.push(
    window.electronAPI.ssh.onReconnected((id) => {
      if (id === props.connectionId) void loadOverview()
    })
  )
  document.addEventListener('visibilitychange', visibilityChanged)
  timer = setInterval(() => {
    now.value = Date.now()
    if (
      !document.hidden &&
      props.active &&
      !ruleDialogVisible.value &&
      !actionLoading.value &&
      (!overview.value || now.value - overview.value.capturedAt >= 15000)
    )
      void loadOverview()
  }, 1000)
})
onUnmounted(() => {
  disposed = true
  generation++
  clearInterval(timer)
  releases.forEach((release) => release())
  document.removeEventListener('visibilitychange', visibilityChanged)
})
</script>

<style scoped>
.firewall-freshness {
  color: var(--text-secondary);
  font-size: 12px;
}
.zone-picker {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}
.zone-picker small,
.rule-protection {
  color: var(--warning-color);
  overflow-wrap: anywhere;
}
.firewall-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--bg-main);
  color: var(--text-primary);
  container-type: inline-size;
}
.firewall-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 58px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}
.header-copy {
  min-width: 0;
}
.header-copy h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 650;
}
.header-copy p {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.firewall-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px;
}
.firewall-content > :deep(.el-alert),
.firewall-content > .status-band {
  margin-bottom: 12px;
}
.status-band {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}
.status-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 20px;
}
.status-band.is-success .status-icon {
  background: rgba(34, 197, 94, 0.12);
  color: var(--success-color);
}
.status-band.is-warning .status-icon {
  background: rgba(245, 158, 11, 0.12);
  color: var(--warning-color);
}
.status-band.is-info .status-icon {
  background: rgba(var(--primary-color-rgb), 0.12);
  color: var(--primary-color);
}
.status-copy {
  min-width: 0;
}
.status-copy > span,
.status-copy p,
.status-facts span,
.section-header span,
.tool-copy span,
.dialog-intro,
.form-field > span {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.status-copy strong {
  display: block;
  margin: 2px 0;
  font-size: var(--text-base);
}
.status-copy p {
  margin: 0;
  line-height: 1.5;
}
.status-facts {
  display: flex;
  grid-column: 2;
  gap: 18px;
  text-align: left;
}
.status-facts span {
  display: flex;
  flex-direction: column;
}
.status-facts b {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: 600;
}
.firewall-tabs {
  min-height: 0;
}
.rules-view,
.details-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.section-header > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.section-header strong {
  font-size: var(--text-sm);
}
.section-header.compact {
  margin-bottom: 8px;
}
.rule-list {
  border-top: 1px solid var(--border-color);
}
.rule-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) 34px;
  gap: 10px;
  align-items: start;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-color);
}
.rule-indicator {
  width: 7px;
  height: 7px;
  margin-top: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
}
.rule-indicator.is-allow {
  background: var(--success-color);
}
.rule-indicator.is-deny,
.rule-indicator.is-reject {
  background: var(--error-color);
}
.rule-main {
  min-width: 0;
}
.rule-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.rule-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rule-heading > span {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.rule-source {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.rule-main details {
  margin-top: 7px;
}
.rule-main summary {
  width: fit-content;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  cursor: pointer;
}
.rule-main code {
  display: block;
  margin-top: 6px;
  padding: 8px;
  overflow-wrap: anywhere;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.empty-rules {
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 48px 20px;
  text-align: center;
}
.empty-rules .el-icon {
  margin-bottom: 12px;
  color: var(--text-tertiary);
  font-size: 30px;
}
.empty-rules p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.container-ports {
  margin-top: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--border-color);
}
.container-port-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}
.container-port-row > .el-icon {
  color: var(--text-secondary);
  font-size: 17px;
}
.container-port-row > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.container-port-row span {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--border-color);
}
.detail-summary div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding: 10px;
  background: var(--bg-secondary);
}
.detail-summary span {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.detail-summary strong {
  overflow: hidden;
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-section {
  padding-top: 4px;
}
.tool-list {
  border-top: 1px solid var(--border-color);
}
.tool-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  min-height: 58px;
  border-bottom: 1px solid var(--border-color);
}
.tool-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-disabled);
}
.tool-dot.installed {
  background: var(--text-tertiary);
}
.tool-dot.active {
  background: var(--success-color);
}
.tool-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.tool-copy strong,
.tool-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.persistence-status {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border-color);
}
.persistence-status > .el-icon {
  color: var(--primary-color);
  font-size: 17px;
}
.persistence-status > div,
.persistence-option > span {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}
.persistence-status span,
.persistence-option small {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.advanced-collapse {
  border-top: 0;
}
.collapse-title {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.raw-group + .raw-group {
  margin-top: 12px;
}
.raw-group strong {
  display: block;
  margin-bottom: 6px;
}
.raw-group pre,
.command-output {
  max-height: 220px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: 4px;
  background: var(--bg-main);
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dialog-intro {
  margin: -4px 0 18px;
}
.rule-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.form-field label,
.source-options legend {
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
}
.source-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}
.source-options legend {
  margin-bottom: 7px;
}
.source-options > label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background-color 150ms ease;
}
.source-options > label.selected {
  border-color: var(--primary-color);
  background: rgba(var(--primary-color-rgb), 0.08);
}
.source-options > label.danger.selected {
  border-color: var(--warning-color);
  background: rgba(245, 158, 11, 0.08);
}
.source-options > label.disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.source-options input {
  margin-top: 4px;
  accent-color: var(--primary-color);
}
.source-options span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.source-options small {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.persistence-option {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 0;
  border-top: 1px solid var(--border-color);
  cursor: pointer;
}
.review-list {
  display: flex;
  flex-direction: column;
  margin-bottom: 14px;
  border-top: 1px solid var(--border-color);
}
.review-list div {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border-color);
}
.review-list span {
  color: var(--text-secondary);
}
.review-list strong {
  max-width: 65%;
  text-align: right;
  overflow-wrap: anywhere;
}
.firewall-rule-dialog :deep(.el-alert + .el-alert) {
  margin-top: 8px;
}
:global(.firewall-rule-dialog) {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
}
:global(.firewall-rule-dialog .el-dialog__header),
:global(.firewall-rule-dialog .el-dialog__body),
:global(.firewall-rule-dialog .el-dialog__footer) {
  background: var(--bg-elevated);
}
@media (hover: hover) and (pointer: fine) {
  .source-options > label:hover:not(.disabled) {
    border-color: var(--border-strong);
  }
  .rule-main summary:hover {
    color: var(--primary-color);
  }
}
@container (max-width: 390px) {
  .status-facts {
    grid-column: 1 / -1;
    padding-left: 50px;
  }
  .detail-summary {
    grid-template-columns: 1fr;
  }
  .tool-row {
    grid-template-columns: 8px minmax(0, 1fr);
    padding: 9px 0;
  }
  .tool-actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}
@media (prefers-reduced-motion: reduce) {
  .source-options > label {
    transition: none;
  }
}
</style>
