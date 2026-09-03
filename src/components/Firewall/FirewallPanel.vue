<template>
  <div class="firewall-panel">
    <div class="firewall-header">
      <div>
        <h3>防火墙管理</h3>
        <p>{{ subtitle }}</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" :loading="loading" @click="loadOverview">刷新</el-button>
        <el-button :icon="Close" link @click="$emit('close')" />
      </div>
    </div>

    <div v-loading="loading || actionLoading" class="firewall-content">
      <el-alert
        v-if="errorMessage"
        type="error"
        :title="errorMessage"
        show-icon
        :closable="false"
      />

      <template v-if="overview">
        <div class="summary-grid">
          <div class="summary-card">
            <span class="label">服务器系统</span>
            <strong :title="systemLabel">{{ systemLabel }}</strong>
          </div>
          <div class="summary-card" :class="{ 'is-ready': installedTools.length > 0 }">
            <span class="label">已安装</span>
            <strong>{{ installedTools.length ? installedTools.map((tool) => tool.label).join(' / ') : '未检测到' }}</strong>
          </div>
          <div class="summary-card" :class="{ 'is-ready': activeTools.length > 0 }">
            <span class="label">运行状态</span>
            <strong>{{ activeTools.length ? activeTools.map((tool) => tool.label).join(' / ') : '未启用' }}</strong>
          </div>
          <div class="summary-card">
            <span class="label">规则数量</span>
            <strong>{{ normalizedRules.length }} 条</strong>
          </div>
        </div>

        <el-alert
          v-if="overview.needsPrivilege"
          type="warning"
          title="当前用户不是 root，操作防火墙需要 sudo 权限。若服务器未配置 sudo，安装、启用和修改规则会失败。"
          show-icon
          :closable="false"
        />

        <div class="tool-section">
          <div class="section-head">
            <div>
              <strong>防火墙工具</strong>
              <span>自动检测当前服务器安装和启用情况</span>
            </div>
          </div>
          <div class="tool-list">
            <div
              v-for="tool in overview.tools"
              :key="tool.id"
              class="tool-card"
              :class="{ installed: tool.installed, active: tool.active }"
            >
              <div class="tool-main">
                <span class="tool-dot" />
                <div>
                  <strong>{{ tool.label }}</strong>
                  <span>{{ tool.version || tool.status || '未安装' }}</span>
                </div>
              </div>
              <div class="tool-actions">
                <el-tag size="small" :type="tool.installed ? 'success' : 'info'">
                  {{ tool.installed ? '已安装' : '未安装' }}
                </el-tag>
                <el-tag v-if="tool.installed" size="small" :type="tool.active ? 'success' : 'warning'">
                  {{ tool.active ? '已启用' : '未启用' }}
                </el-tag>
                <el-button
                  v-if="tool.installed && canEnable(tool.id)"
                  size="small"
                  :disabled="tool.active"
                  @click="enableFirewall(tool.id)"
                >
                  启用
                </el-button>
                <el-button
                  v-if="tool.installed && tool.active && canDisable(tool.id)"
                  size="small"
                  type="warning"
                  plain
                  @click="disableFirewall(tool.id)"
                >
                  停用
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="installedTools.length === 0" class="install-box">
          <div>
            <h4>未检测到已安装的防火墙</h4>
            <p>可以按当前系统推荐安装，也可以手动选择 UFW 或 Firewalld。</p>
          </div>
          <div class="install-actions">
            <el-select v-model="installTarget" size="small">
              <el-option
                v-for="option in installOptions"
                :key="option.value"
                :label="option.label"
                :value="option.value"
              />
            </el-select>
            <el-button type="primary" :icon="Download" @click="installFirewall">
              安装
            </el-button>
          </div>
        </div>

        <el-alert
          v-else-if="manageableTools.length === 0"
          type="info"
          title="当前仅检测到 nftables 或其他底层规则工具，暂未提供自动改写规则，避免误改系统级规则。你仍可以在下方查看原始规则。"
          show-icon
          :closable="false"
        />

        <div v-else class="rule-editor">
          <div class="section-head">
            <div>
              <strong>新增放行规则</strong>
              <span>支持单个或多个端口，来源可填写 IP 或 CIDR 段</span>
            </div>
          </div>

          <div class="editor-grid">
            <div class="editor-field">
              <label>防火墙</label>
              <el-select v-model="ruleForm.tool" size="small">
                <el-option
                  v-for="tool in manageableTools"
                  :key="tool.id"
                  :label="tool.label"
                  :value="tool.id"
                />
              </el-select>
            </div>
            <div class="editor-field">
              <label>端口</label>
              <el-input v-model="ruleForm.ports" size="small" placeholder="22,80,443 或 1000-2000" />
            </div>
            <div class="editor-field">
              <label>协议</label>
              <el-radio-group v-model="ruleForm.protocol" size="small">
                <el-radio-button value="tcp">TCP</el-radio-button>
                <el-radio-button value="udp">UDP</el-radio-button>
                <el-radio-button value="both">TCP+UDP</el-radio-button>
              </el-radio-group>
            </div>
            <div class="editor-field">
              <label>来源</label>
              <el-input v-model="ruleForm.sources" size="small" placeholder="留空为所有来源，支持多个 IP/CIDR" />
            </div>
          </div>

          <div class="common-ports">
            <span>常用端口</span>
            <button
              v-for="preset in portPresets"
              :key="preset.value"
              type="button"
              @click="appendPresetPorts(preset.value)"
            >
              {{ preset.label }}
            </button>
          </div>

          <div class="editor-actions">
            <el-button type="primary" :icon="Plus" @click="allowRule">放行端口</el-button>
          </div>
        </div>

        <div class="rules-section">
          <div class="section-head">
            <div>
              <strong>当前规则</strong>
              <span>优先展示可解析规则，复杂规则保留原始内容</span>
            </div>
          </div>

          <el-tabs v-model="activeRuleTool" class="rule-tabs">
            <el-tab-pane
              v-for="tool in ruleTools"
              :key="tool.id"
              :label="`${tool.label} (${rulesByTool(tool.id).length})`"
              :name="tool.id"
            >
              <el-scrollbar class="rule-list">
                <el-empty
                  v-if="rulesByTool(tool.id).length === 0"
                  description="暂无规则"
                />
                <div
                  v-for="rule in rulesByTool(tool.id)"
                  :key="rule.key"
                  class="rule-row"
                >
                  <div class="rule-info">
                    <div class="rule-title">
                      <el-tag size="small" :type="rule.action === 'allow' ? 'success' : 'warning'">
                        {{ rule.actionLabel }}
                      </el-tag>
                      <strong>{{ rule.port || rule.service || rule.summary }}</strong>
                      <span v-if="rule.protocol">{{ rule.protocol.toUpperCase() }}</span>
                    </div>
                    <div class="rule-meta">
                      <span v-if="rule.source">来源 {{ rule.source }}</span>
                      <span v-if="rule.target">目标 {{ rule.target }}</span>
                      <span v-if="rule.persistent === false">可能为临时规则</span>
                    </div>
                    <code :title="rule.raw">{{ rule.raw }}</code>
                  </div>
                  <el-button
                    v-if="rule.deletable"
                    size="small"
                    type="danger"
                    plain
                    :icon="Delete"
                    @click="deleteRule(rule)"
                  >
                    删除
                  </el-button>
                </div>
              </el-scrollbar>
            </el-tab-pane>
          </el-tabs>
        </div>

        <div v-if="lastOutput" class="output-box">
          <div class="output-head">
            <strong>最近输出</strong>
            <el-button size="small" link @click="lastOutput = ''">清空</el-button>
          </div>
          <pre>{{ lastOutput }}</pre>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Close, Delete, Download, Plus, Refresh } from '@element-plus/icons-vue'

type FirewallToolId = 'ufw' | 'firewalld' | 'iptables' | 'nftables'
type RuleProtocol = 'tcp' | 'udp' | 'both'

interface FirewallTool {
  id: FirewallToolId
  label: string
  installed: boolean
  active: boolean
  status: string
  version: string
}

interface FirewallOverview {
  osId: string
  osName: string
  packageManager: string
  needsPrivilege: boolean
  canSudo: boolean
  tools: FirewallTool[]
  rawRules: Record<FirewallToolId, string[]>
}

interface FirewallRule {
  key: string
  tool: FirewallToolId
  raw: string
  action: 'allow' | 'deny' | 'reject' | 'unknown'
  actionLabel: string
  summary: string
  port?: string
  protocol?: string
  source?: string
  target?: string
  service?: string
  index?: number
  chain?: string
  deletable: boolean
  deletePayload?: Record<string, string | number | undefined>
  persistent?: boolean
}

interface Props {
  connectionId: string
}

const props = defineProps<Props>()
defineEmits<{ close: [] }>()

const toolLabels: Record<FirewallToolId, string> = {
  ufw: 'UFW',
  firewalld: 'Firewalld',
  iptables: 'iptables',
  nftables: 'nftables'
}

const overview = ref<FirewallOverview | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const errorMessage = ref('')
const lastOutput = ref('')
const activeRuleTool = ref<FirewallToolId>('ufw')
const installTarget = ref<'auto' | 'ufw' | 'firewalld'>('auto')
const ruleForm = ref({
  tool: 'ufw' as FirewallToolId,
  ports: '22,80,443',
  protocol: 'tcp' as RuleProtocol,
  sources: ''
})

const portPresets = [
  { label: 'SSH 22', value: '22' },
  { label: 'HTTP 80', value: '80' },
  { label: 'HTTPS 443', value: '443' },
  { label: 'MySQL 3306', value: '3306' },
  { label: 'Redis 6379', value: '6379' },
  { label: 'PostgreSQL 5432', value: '5432' },
  { label: 'Node 3000', value: '3000' },
  { label: '面板 8888', value: '8888' }
]

const installOptions = [
  { label: '自动推荐', value: 'auto' },
  { label: 'UFW', value: 'ufw' },
  { label: 'Firewalld', value: 'firewalld' }
]

const subtitle = computed(() => {
  if (!overview.value) return '检测服务器防火墙状态和规则'
  if (activeTools.value.length) {
    return `已启用 ${activeTools.value.map((tool) => tool.label).join(' / ')}`
  }
  if (installedTools.value.length) {
    return `已安装 ${installedTools.value.map((tool) => tool.label).join(' / ')}，未检测到启用状态`
  }
  return '未检测到已安装防火墙'
})

const systemLabel = computed(() => {
  if (!overview.value) return '未知'
  return overview.value.osName || overview.value.osId || '未知系统'
})

const installedTools = computed(() => overview.value?.tools.filter((tool) => tool.installed) || [])
const activeTools = computed(() => installedTools.value.filter((tool) => tool.active))
const manageableTools = computed(() =>
  installedTools.value.filter((tool) => ['ufw', 'firewalld', 'iptables'].includes(tool.id))
)
const ruleTools = computed(() => overview.value?.tools.filter((tool) => tool.installed) || [])
const normalizedRules = computed(() => normalizeRules(overview.value))

watch(
  manageableTools,
  (tools) => {
    if (!tools.some((tool) => tool.id === ruleForm.value.tool)) {
      ruleForm.value.tool = (tools[0]?.id || 'ufw') as FirewallToolId
    }
  },
  { immediate: true }
)

watch(
  ruleTools,
  (tools) => {
    if (!tools.some((tool) => tool.id === activeRuleTool.value)) {
      activeRuleTool.value = (tools[0]?.id || 'ufw') as FirewallToolId
    }
  },
  { immediate: true }
)

const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`

const runSSHCommand = async (command: string, timeout = 60000) => {
  const result = await window.electronAPI.ssh.executeCommand(props.connectionId, command, timeout)
  if (!result?.success) {
    throw new Error(result?.error || 'SSH 命令执行失败')
  }
  return String(result.data || '')
}

const buildDetectCommand = () => `
sh <<'MSHELL_FIREWALL_DETECT'
set +e
echo "__MSHELL_FIREWALL_V1__"

os_id=""
os_name=""
if [ -r /etc/os-release ]; then
  os_id=$(sed -n 's/^ID=//p' /etc/os-release | head -n1 | tr -d '"')
  os_name=$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | head -n1 | tr -d '"')
fi

pkg="unknown"
for candidate in apt-get dnf yum zypper pacman apk; do
  if command -v "$candidate" >/dev/null 2>&1; then
    pkg="$candidate"
    break
  fi
done

needs_privilege=no
can_sudo=no
SUDO=""
if [ "$(id -u 2>/dev/null)" != "0" ]; then
  needs_privilege=yes
  if command -v sudo >/dev/null 2>&1; then
    can_sudo=yes
    SUDO="sudo -n"
  fi
fi

meta() { printf 'META|%s|%s\\n' "$1" "$2"; }
tool() { printf 'TOOL|%s|%s|%s|%s|%s\\n' "$1" "$2" "$3" "$4" "$5"; }
rule_raw() { printf 'RULE_RAW|%s|%s\\n' "$1" "$2"; }

meta os_id "$os_id"
meta os_name "$os_name"
meta package_manager "$pkg"
meta needs_privilege "$needs_privilege"
meta can_sudo "$can_sudo"

if command -v ufw >/dev/null 2>&1; then
  ufw_status=$($SUDO ufw status 2>/dev/null || ufw status 2>/dev/null || true)
  ufw_version=$(ufw --version 2>/dev/null | head -n1 || true)
  ufw_active=no
  echo "$ufw_status" | grep -qi 'Status:[[:space:]]*active' && ufw_active=yes
  tool ufw yes "$ufw_active" "$(echo "$ufw_status" | head -n1)" "$ufw_version"
  ($SUDO ufw status numbered 2>/dev/null || ufw status numbered 2>/dev/null || true) | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw ufw "$line"
  done
else
  tool ufw no no "" ""
fi

if command -v firewall-cmd >/dev/null 2>&1; then
  fw_state=$($SUDO firewall-cmd --state 2>/dev/null || firewall-cmd --state 2>/dev/null || true)
  fw_version=$(firewall-cmd --version 2>/dev/null | head -n1 || true)
  fw_active=no
  [ "$fw_state" = "running" ] && fw_active=yes
  tool firewalld yes "$fw_active" "$fw_state" "$fw_version"
  ($SUDO firewall-cmd --list-all 2>/dev/null || firewall-cmd --list-all 2>/dev/null || true) | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw firewalld "$line"
  done
else
  tool firewalld no no "" ""
fi

if command -v iptables >/dev/null 2>&1; then
  iptables_rules=$($SUDO iptables -S 2>/dev/null || iptables -S 2>/dev/null || true)
  iptables_active=no
  echo "$iptables_rules" | grep -Eq '^-A ' && iptables_active=yes
  iptables_version=$(iptables --version 2>/dev/null | head -n1 || true)
  tool iptables yes "$iptables_active" "$([ "$iptables_active" = yes ] && echo rules || echo empty)" "$iptables_version"
  ($SUDO iptables -L INPUT -n --line-numbers 2>/dev/null || iptables -L INPUT -n --line-numbers 2>/dev/null || true) | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw iptables "$line"
  done
else
  tool iptables no no "" ""
fi

if command -v nft >/dev/null 2>&1; then
  nft_rules=$($SUDO nft list ruleset 2>/dev/null || nft list ruleset 2>/dev/null || true)
  nft_active=no
  [ -n "$nft_rules" ] && nft_active=yes
  nft_version=$(nft --version 2>/dev/null | head -n1 || true)
  tool nftables yes "$nft_active" "$([ "$nft_active" = yes ] && echo rules || echo empty)" "$nft_version"
  echo "$nft_rules" | sed -n '1,120p' | while IFS= read -r line; do
    [ -n "$line" ] && rule_raw nftables "$line"
  done
else
  tool nftables no no "" ""
fi

echo "__MSHELL_FIREWALL_END__"
MSHELL_FIREWALL_DETECT
`

const parseOverview = (output: string): FirewallOverview => {
  const meta: Record<string, string> = {}
  const tools = new Map<FirewallToolId, FirewallTool>()
  const rawRules: Record<FirewallToolId, string[]> = {
    ufw: [],
    firewalld: [],
    iptables: [],
    nftables: []
  }

  output.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('META|')) {
      const [, key, ...rest] = line.split('|')
      meta[key] = rest.join('|')
      return
    }

    if (line.startsWith('TOOL|')) {
      const [, id, installed, active, status, ...versionParts] = line.split('|')
      if (!isFirewallToolId(id)) return
      tools.set(id, {
        id,
        label: toolLabels[id],
        installed: installed === 'yes',
        active: active === 'yes',
        status: status || '',
        version: versionParts.join('|') || ''
      })
      return
    }

    if (line.startsWith('RULE_RAW|')) {
      const [, id, ...rest] = line.split('|')
      if (!isFirewallToolId(id)) return
      rawRules[id].push(rest.join('|'))
    }
  })

  const normalizedTools: FirewallTool[] = (['ufw', 'firewalld', 'iptables', 'nftables'] as FirewallToolId[]).map(
    (id) =>
      tools.get(id) || {
        id,
        label: toolLabels[id],
        installed: false,
        active: false,
        status: '',
        version: ''
      }
  )

  return {
    osId: meta.os_id || '',
    osName: meta.os_name || '',
    packageManager: meta.package_manager || 'unknown',
    needsPrivilege: meta.needs_privilege === 'yes',
    canSudo: meta.can_sudo === 'yes',
    tools: normalizedTools,
    rawRules
  }
}

const isFirewallToolId = (value: string): value is FirewallToolId =>
  ['ufw', 'firewalld', 'iptables', 'nftables'].includes(value)

const loadOverview = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const output = await runSSHCommand(buildDetectCommand(), 45000)
    overview.value = parseOverview(output)
    const firstActive = activeTools.value[0] || installedTools.value[0]
    if (firstActive) {
      activeRuleTool.value = firstActive.id
      if (manageableTools.value.some((tool) => tool.id === firstActive.id)) {
        ruleForm.value.tool = firstActive.id
      }
    }
  } catch (error: any) {
    errorMessage.value = error?.message || '防火墙检测失败'
  } finally {
    loading.value = false
  }
}

const normalizeRules = (data: FirewallOverview | null): FirewallRule[] => {
  if (!data) return []
  return (Object.entries(data.rawRules) as [FirewallToolId, string[]][]).flatMap(([tool, lines]) =>
    lines
      .map((line, index) => normalizeRule(tool, line, index))
      .filter((rule): rule is FirewallRule => Boolean(rule))
  )
}

const normalizeRule = (tool: FirewallToolId, raw: string, index: number): FirewallRule | null => {
  const line = raw.trim()
  if (!line || /^Status:/i.test(line) || /^To\s+Action\s+From/i.test(line) || /^--/.test(line)) {
    return null
  }

  if (tool === 'ufw') return normalizeUfwRule(line, index)
  if (tool === 'firewalld') return normalizeFirewalldRule(line)
  if (tool === 'iptables') return normalizeIptablesRule(line, index)
  return {
    key: `${tool}:${index}:${line}`,
    tool,
    raw: line,
    action: 'unknown',
    actionLabel: '规则',
    summary: line,
    deletable: false
  }
}

const normalizeUfwRule = (line: string, index: number): FirewallRule | null => {
  const numbered = line.match(/^\[\s*(\d+)\]\s+(.+)$/)
  const ruleBody = numbered ? numbered[2].trim() : line
  if (!ruleBody || /^Status:/i.test(ruleBody)) return null

  const actionMatch = ruleBody.match(/\s+(ALLOW|DENY|REJECT)\s+(IN|OUT)?\s*(.*)$/i)
  const target = actionMatch ? ruleBody.slice(0, actionMatch.index).trim() : ruleBody
  const actionText = actionMatch?.[1]?.toUpperCase() || 'RULE'
  const source = actionMatch?.[3]?.trim()
  const [portPart, protocolPart] = target.split('/')

  return {
    key: `ufw:${numbered?.[1] || index}:${line}`,
    tool: 'ufw',
    raw: line,
    action: actionText === 'ALLOW' ? 'allow' : actionText === 'DENY' ? 'deny' : actionText === 'REJECT' ? 'reject' : 'unknown',
    actionLabel: actionText,
    summary: target,
    port: portPart || target,
    protocol: protocolPart,
    source: source || '',
    index: numbered ? Number(numbered[1]) : undefined,
    deletable: Boolean(numbered),
    deletePayload: numbered ? { index: Number(numbered[1]) } : undefined,
    persistent: true
  }
}

const normalizeFirewalldRule = (line: string): FirewallRule | null => {
  const trimmed = line.trim()
  const portLine = trimmed.match(/^ports:\s*(.*)$/i)
  if (portLine) {
    const ports = portLine[1].trim()
    if (!ports) return null
    return {
      key: `firewalld:ports:${ports}`,
      tool: 'firewalld',
      raw: trimmed,
      action: 'allow',
      actionLabel: 'ALLOW',
      summary: ports,
      port: ports,
      deletable: ports.split(/\s+/).length === 1,
      deletePayload: ports.split(/\s+/).length === 1 ? parseFirewalldPort(ports) : undefined,
      persistent: true
    }
  }

  const servicesLine = trimmed.match(/^services:\s*(.*)$/i)
  if (servicesLine) {
    const services = servicesLine[1].trim()
    if (!services) return null
    return {
      key: `firewalld:services:${services}`,
      tool: 'firewalld',
      raw: trimmed,
      action: 'allow',
      actionLabel: 'SERVICE',
      summary: services,
      service: services,
      deletable: services.split(/\s+/).length === 1,
      deletePayload: services.split(/\s+/).length === 1 ? { service: services } : undefined,
      persistent: true
    }
  }

  const sourcesLine = trimmed.match(/^sources:\s*(.*)$/i)
  if (sourcesLine) {
    const source = sourcesLine[1].trim()
    if (!source) return null
    return {
      key: `firewalld:sources:${source}`,
      tool: 'firewalld',
      raw: trimmed,
      action: 'unknown',
      actionLabel: 'SOURCE',
      summary: source,
      source,
      deletable: false,
      persistent: true
    }
  }

  return null
}

const parseFirewalldPort = (value: string) => {
  const [port, protocol] = value.split('/')
  return { port, protocol }
}

const normalizeIptablesRule = (line: string, index: number): FirewallRule | null => {
  if (/^Chain\s+/i.test(line) || /^num\s+/i.test(line)) return null
  const parts = line.split(/\s+/)
  const number = Number(parts[0])
  if (!Number.isFinite(number)) return null

  const target = parts[1] || ''
  const protocol = parts[2] && parts[2] !== 'all' ? parts[2] : ''
  const source = parts[4] && parts[4] !== '0.0.0.0/0' ? parts[4] : ''
  const destination = parts[5] && parts[5] !== '0.0.0.0/0' ? parts[5] : ''
  const dptMatch = line.match(/\bdpt:(\S+)/)

  return {
    key: `iptables:${number}:${index}:${line}`,
    tool: 'iptables',
    raw: line,
    action: target === 'ACCEPT' ? 'allow' : target === 'DROP' ? 'deny' : 'unknown',
    actionLabel: target || 'RULE',
    summary: dptMatch?.[1] || line,
    port: dptMatch?.[1],
    protocol,
    source,
    target: destination,
    chain: 'INPUT',
    index: number,
    deletable: true,
    deletePayload: { chain: 'INPUT', index: number },
    persistent: false
  }
}

const rulesByTool = (tool: FirewallToolId) =>
  normalizedRules.value.filter((rule) => rule.tool === tool)

const canEnable = (tool: FirewallToolId) => tool === 'ufw' || tool === 'firewalld' || tool === 'nftables'
const canDisable = (tool: FirewallToolId) =>
  tool === 'ufw' || tool === 'firewalld' || tool === 'nftables'

const recommendedInstallTool = computed<'ufw' | 'firewalld'>(() => {
  const os = overview.value?.osId.toLowerCase() || ''
  const pkg = overview.value?.packageManager || ''
  if (/centos|rhel|rocky|almalinux|fedora|opensuse|sles/.test(os) || ['dnf', 'yum', 'zypper'].includes(pkg)) {
    return 'firewalld'
  }
  return 'ufw'
})

const buildInstallCommand = (target: 'auto' | 'ufw' | 'firewalld') => {
  const actualTarget = target === 'auto' ? recommendedInstallTool.value : target
  return `
sh <<'MSHELL_FIREWALL_INSTALL'
set -e
TARGET=${shellQuote(actualTarget)}
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "当前用户不是 root，且未检测到 sudo，无法安装防火墙。"
  exit 1
fi

install_pkg() {
  pkg="$1"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y "$pkg"
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y "$pkg"
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y "$pkg"
  elif command -v zypper >/dev/null 2>&1; then
    $SUDO zypper --non-interactive install "$pkg"
  elif command -v pacman >/dev/null 2>&1; then
    $SUDO pacman -Sy --noconfirm "$pkg"
  elif command -v apk >/dev/null 2>&1; then
    $SUDO apk add "$pkg"
  else
    echo "未识别到受支持的包管理器。"
    exit 1
  fi
}

case "$TARGET" in
  ufw) install_pkg ufw ;;
  firewalld) install_pkg firewalld ;;
  *) echo "不支持的防火墙: $TARGET"; exit 1 ;;
esac

echo "安装完成: $TARGET"
MSHELL_FIREWALL_INSTALL
`
}

const installFirewall = async () => {
  actionLoading.value = true
  errorMessage.value = ''
  try {
    lastOutput.value = await runSSHCommand(buildInstallCommand(installTarget.value), 180000)
    ElMessage.success('防火墙安装命令已完成')
    await loadOverview()
  } catch (error: any) {
    errorMessage.value = error?.message || '安装防火墙失败'
  } finally {
    actionLoading.value = false
  }
}

const buildEnableCommand = (tool: FirewallToolId) => `
sh <<'MSHELL_FIREWALL_ENABLE'
set -e
TOOL=${shellQuote(tool)}
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "当前用户不是 root，且未检测到 sudo，无法启用防火墙。"
  exit 1
fi

case "$TOOL" in
  ufw)
    $SUDO ufw --force enable
    ;;
  firewalld)
    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl enable --now firewalld
    fi
    $SUDO firewall-cmd --state
    ;;
  nftables)
    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl enable --now nftables
    else
      echo "当前系统未检测到 systemctl，请手动确认 nftables 启动方式。"
    fi
    ;;
  *)
    echo "该防火墙暂不支持一键启用。"
    exit 1
    ;;
esac

echo "已执行启用操作: $TOOL"
MSHELL_FIREWALL_ENABLE
`

const enableFirewall = async (tool: FirewallToolId) => {
  actionLoading.value = true
  errorMessage.value = ''
  try {
    lastOutput.value = await runSSHCommand(buildEnableCommand(tool), 60000)
    ElMessage.success('启用命令已完成')
    await loadOverview()
  } catch (error: any) {
    errorMessage.value = error?.message || '启用防火墙失败'
  } finally {
    actionLoading.value = false
  }
}

const buildDisableCommand = (tool: FirewallToolId) => `
sh <<'MSHELL_FIREWALL_DISABLE'
set -e
TOOL=${shellQuote(tool)}
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "当前用户不是 root，且未检测到 sudo，无法停用防火墙。"
  exit 1
fi

case "$TOOL" in
  ufw)
    $SUDO ufw disable
    ;;
  firewalld)
    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl disable --now firewalld
    else
      echo "当前系统未检测到 systemctl，无法安全停用 firewalld。"
      exit 1
    fi
    ;;
  nftables)
    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl disable --now nftables
    else
      echo "当前系统未检测到 systemctl，无法安全停用 nftables。"
      exit 1
    fi
    ;;
  *)
    echo "该防火墙暂不支持一键停用。"
    exit 1
    ;;
esac

echo "已执行停用操作: $TOOL"
MSHELL_FIREWALL_DISABLE
`

const disableFirewall = async (tool: FirewallToolId) => {
  try {
    await ElMessageBox.confirm(
      `停用 ${toolLabels[tool]} 可能导致 SSH 或其他服务暴露/失去访问控制，确定继续吗？`,
      '停用防火墙',
      {
        type: 'warning',
        confirmButtonText: '确认停用',
        cancelButtonText: '取消'
      }
    )
  } catch {
    return
  }

  actionLoading.value = true
  errorMessage.value = ''
  try {
    lastOutput.value = await runSSHCommand(buildDisableCommand(tool), 60000)
    ElMessage.success('停用命令已完成')
    await loadOverview()
  } catch (error: any) {
    errorMessage.value = error?.message || '停用防火墙失败'
  } finally {
    actionLoading.value = false
  }
}

const parseListInput = (value: string) =>
  value
    .split(/[,\s，]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const normalizePorts = (value: string) => {
  const ports = parseListInput(value)
  if (ports.length === 0) {
    throw new Error('请输入至少一个端口')
  }
  const invalid = ports.find((port) => !/^(\d{1,5})([-:]\d{1,5})?$/.test(port))
  if (invalid) throw new Error(`端口格式不正确: ${invalid}`)
  ports.forEach((port) => {
    const [start, end] = port.split(/[-:]/).map(Number)
    if (start < 1 || start > 65535 || (end && (end < 1 || end > 65535 || end < start))) {
      throw new Error(`端口范围不正确: ${port}`)
    }
  })
  return ports
}

const normalizeSources = (value: string) => {
  return parseListInput(value)
}

const buildAllowCommand = () => {
  const ports = normalizePorts(ruleForm.value.ports)
  const sources = normalizeSources(ruleForm.value.sources)
  const protocols = ruleForm.value.protocol === 'both' ? ['tcp', 'udp'] : [ruleForm.value.protocol]
  const sourceList = sources.length ? sources.join(' ') : '__MSHELL_ALL__'
  const tool = ruleForm.value.tool

  return `
sh <<'MSHELL_FIREWALL_ALLOW'
set -e
TOOL=${shellQuote(tool)}
PORTS=${shellQuote(ports.join(' '))}
SOURCES=${shellQuote(sourceList)}
PROTOCOLS=${shellQuote(protocols.join(' '))}
if [ "$(id -u)" = "0" ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "当前用户不是 root，且未检测到 sudo，无法修改防火墙规则。"
  exit 1
fi

for port in $PORTS; do
  for proto in $PROTOCOLS; do
    for source in $SOURCES; do
      if [ "$source" = "__MSHELL_ALL__" ]; then
        source=""
      fi
      case "$TOOL" in
        ufw)
          ufw_port=$(echo "$port" | tr '-' ':')
          if [ -n "$source" ]; then
            $SUDO ufw allow from "$source" to any port "$ufw_port" proto "$proto"
          else
            $SUDO ufw allow "$ufw_port/$proto"
          fi
          ;;
        firewalld)
          fw_port=$(echo "$port" | tr ':' '-')
          if [ -n "$source" ]; then
            family=ipv4
            echo "$source" | grep -q ':' && family=ipv6
            $SUDO firewall-cmd --permanent --add-rich-rule="rule family=\\"$family\\" source address=\\"$source\\" port port=\\"$fw_port\\" protocol=\\"$proto\\" accept"
          else
            $SUDO firewall-cmd --permanent --add-port="$fw_port/$proto"
          fi
          ;;
        iptables)
          ipt_port=$(echo "$port" | tr '-' ':')
          port_match="--dport $ipt_port"
          if [ -n "$source" ]; then
            $SUDO iptables -C INPUT -p "$proto" -s "$source" $port_match -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT -p "$proto" -s "$source" $port_match -j ACCEPT
          else
            $SUDO iptables -C INPUT -p "$proto" $port_match -j ACCEPT 2>/dev/null || $SUDO iptables -I INPUT -p "$proto" $port_match -j ACCEPT
          fi
          echo "提示: iptables 规则是否永久保存取决于服务器是否安装 iptables-persistent 或系统级保存机制。"
          ;;
        *)
          echo "该工具暂不支持可视化新增规则: $TOOL"
          exit 1
          ;;
      esac
    done
  done
done

if [ "$TOOL" = "firewalld" ]; then
  $SUDO firewall-cmd --reload
fi

echo "规则已写入: $TOOL"
MSHELL_FIREWALL_ALLOW
`
}

const allowRule = async () => {
  actionLoading.value = true
  errorMessage.value = ''
  try {
    lastOutput.value = await runSSHCommand(buildAllowCommand(), 60000)
    ElMessage.success('防火墙规则已更新')
    await loadOverview()
  } catch (error: any) {
    errorMessage.value = error?.message || '新增规则失败'
  } finally {
    actionLoading.value = false
  }
}

const buildDeleteCommand = (rule: FirewallRule) => {
  if (rule.tool === 'ufw' && rule.index) {
    return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
if [ "$(id -u)" = "0" ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else echo "缺少 sudo 权限"; exit 1; fi
$SUDO ufw --force delete ${Number(rule.index)}
MSHELL_FIREWALL_DELETE
`
  }

  if (rule.tool === 'firewalld') {
    const payload = rule.deletePayload || {}
    if (payload.port && payload.protocol) {
      return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
if [ "$(id -u)" = "0" ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else echo "缺少 sudo 权限"; exit 1; fi
$SUDO firewall-cmd --permanent --remove-port=${shellQuote(`${payload.port}/${payload.protocol}`)}
$SUDO firewall-cmd --reload
MSHELL_FIREWALL_DELETE
`
    }
    if (payload.service) {
      return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
if [ "$(id -u)" = "0" ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else echo "缺少 sudo 权限"; exit 1; fi
$SUDO firewall-cmd --permanent --remove-service=${shellQuote(String(payload.service))}
$SUDO firewall-cmd --reload
MSHELL_FIREWALL_DELETE
`
    }
  }

  if (rule.tool === 'iptables' && rule.index && rule.chain) {
    return `
sh <<'MSHELL_FIREWALL_DELETE'
set -e
if [ "$(id -u)" = "0" ]; then SUDO=""; elif command -v sudo >/dev/null 2>&1; then SUDO="sudo"; else echo "缺少 sudo 权限"; exit 1; fi
$SUDO iptables -D ${shellQuote(rule.chain)} ${Number(rule.index)}
echo "提示: iptables 删除是否永久保存取决于服务器是否安装持久化规则保存机制。"
MSHELL_FIREWALL_DELETE
`
  }

  throw new Error('该规则暂不支持可视化删除')
}

const deleteRule = async (rule: FirewallRule) => {
  try {
    await ElMessageBox.confirm(`确定删除这条规则吗？\n${rule.raw}`, '删除防火墙规则', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }

  actionLoading.value = true
  errorMessage.value = ''
  try {
    lastOutput.value = await runSSHCommand(buildDeleteCommand(rule), 60000)
    ElMessage.success('规则已删除')
    await loadOverview()
  } catch (error: any) {
    errorMessage.value = error?.message || '删除规则失败'
  } finally {
    actionLoading.value = false
  }
}

const appendPresetPorts = (value: string) => {
  const current = new Set(
    parseListInput(ruleForm.value.ports)
      .filter((port) => /^(\d{1,5})([-:]\d{1,5})?$/.test(port))
      .map((port) => port.replace(':', '-'))
  )
  current.add(value)
  ruleForm.value.ports = Array.from(current).join(',')
}

onMounted(loadOverview)
</script>

<style scoped>
.firewall-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--bg-main);
  color: var(--text-primary);
}

.firewall-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 56px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-sizing: border-box;
}

.firewall-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 650;
  color: var(--text-primary);
}

.firewall-header p {
  margin: 3px 0 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.firewall-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.summary-card,
.tool-card,
.install-box,
.rule-editor,
.rules-section,
.output-box {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.summary-card {
  min-width: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.summary-card .label,
.section-head span,
.tool-main span,
.rule-meta,
.output-head {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.summary-card strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.summary-card.is-ready {
  border-color: rgba(34, 197, 94, 0.35);
  background: rgba(34, 197, 94, 0.08);
}

.tool-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.section-head > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.section-head strong {
  color: var(--text-primary);
}

.tool-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.tool-card {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tool-card.active {
  border-color: rgba(34, 197, 94, 0.35);
}

.tool-main {
  display: flex;
  gap: 8px;
  min-width: 0;
}

.tool-main > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tool-main strong,
.tool-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-dot {
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
  background: var(--text-placeholder, #9ca3af);
  flex-shrink: 0;
}

.tool-card.installed .tool-dot {
  background: #f59e0b;
}

.tool-card.active .tool-dot {
  background: #22c55e;
}

.tool-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.install-box {
  padding: 12px;
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.install-box h4 {
  margin: 0 0 4px;
  color: var(--text-primary);
}

.install-box p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.install-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.rule-editor,
.rules-section,
.output-box {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.editor-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
}

.editor-field {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.editor-field label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.common-ports {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.common-ports span {
  margin-right: 2px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.common-ports button {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-main);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  padding: 4px 7px;
  cursor: pointer;
}

.common-ports button:hover {
  color: var(--primary-color);
  border-color: rgba(var(--primary-color-rgb), 0.45);
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
}

.rule-tabs {
  min-height: 0;
}

.rule-list {
  height: 320px;
}

.rule-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-color);
}

.rule-row:last-child {
  border-bottom: 0;
}

.rule-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.rule-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.rule-title strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.rule-title span {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.rule-meta {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.rule-info code {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-family: var(--font-mono, Consolas, monospace);
  font-size: var(--text-xs);
}

.output-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.output-box pre {
  max-height: 160px;
  margin: 0;
  padding: 10px;
  overflow: auto;
  border-radius: var(--radius-sm);
  background: var(--bg-main);
  color: var(--text-primary);
  font-size: var(--text-xs);
  line-height: 1.5;
}

@media (max-width: 520px) {
  .summary-grid,
  .tool-list,
  .editor-grid {
    grid-template-columns: 1fr;
  }

  .install-box {
    flex-direction: column;
  }

  .install-actions {
    align-items: stretch;
  }
}
</style>
