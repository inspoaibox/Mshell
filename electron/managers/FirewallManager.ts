import { randomUUID } from 'node:crypto'
import { sshConnectionManager } from './SSHConnectionManager'
import {
  createFirewallRulePlan,
  firewallConflict,
  normalizeSource,
  type FirewallAction,
  type FirewallActionResult,
  type FirewallOverview,
  type FirewallRulePlan
} from '../../src/utils/firewall-model'
import {
  buildAllowFirewallCommand,
  buildConfirmFirewallCommand,
  buildDeleteFirewallCommand,
  buildDisableFirewallCommand,
  buildEnableFirewallCommand,
  buildFirewallDetectCommand,
  buildInstallFirewallCommand
} from '../../src/utils/firewall-commands'

type Connections = Pick<typeof sshConnectionManager, 'getConnection' | 'executeCommandDetailed'>
export type FirewallContext = Pick<FirewallOverview, 'sshClientIp' | 'sshServerPort' | 'sshZone'>
export class FirewallManager {
  private running = new Set<string>()
  private pending = new Map<
    string,
    { token: string; expiresAt: number; tool: 'ufw' | 'firewalld' }
  >()
  constructor(private connections: Connections = sshConnectionManager) {}
  private connected(id: string) {
    const connection = this.connections.getConnection(id)
    if (!connection || connection.status !== 'connected')
      throw new Error('SSH 未连接，请重连后重新检测')
    return connection.client
  }
  async inspect(id: string): Promise<FirewallOverview> {
    const client = this.connected(id)
    const result = await this.connections.executeCommandDetailed(
      id,
      buildFirewallDetectCommand(),
      45000,
      2 * 1024 * 1024
    )
    if (this.connected(id) !== client) throw new Error('检测期间连接已变化，请重新检测')
    if (result.exitCode !== 0) throw new Error(result.stderr || '防火墙检测失败')
    return parseOverview(result.stdout)
  }
  async apply(
    id: string,
    action: FirewallAction,
    expected: FirewallContext,
    signal?: AbortSignal
  ): Promise<FirewallActionResult> {
    if (this.running.has(id)) throw new Error('该连接的防火墙操作正在进行')
    const pending = this.pending.get(id)
    if (pending && pending.expiresAt > Date.now())
      throw new Error('请先确认上一次启用，或等待自动回滚')
    this.pending.delete(id)
    this.running.add(id)
    try {
      const client = this.connected(id),
        overview = await this.inspect(id)
      if (signal?.aborted) throw new Error('操作已取消')
      if (overview.errors.length)
        throw new Error('检测不完整，已禁止修改：' + overview.errors.join('；'))
      if (
        !expected ||
        expected.sshClientIp !== overview.sshClientIp ||
        expected.sshServerPort !== overview.sshServerPort ||
        expected.sshZone !== overview.sshZone
      )
        throw new Error('SSH 来源、端口或 zone 已变化，请刷新后重新确认')
      if (firewallConflict(overview) && action.type !== 'disable')
        throw new Error('存在多个防火墙管理器，请先解决冲突')
      let command: string,
        plan: FirewallRulePlan | undefined,
        timeout = 60000
      let enabling: { token: string; expiresAt: number; tool: 'ufw' | 'firewalld' } | undefined
      switch (action.type) {
        case 'allow': {
          const draft = action.draft
          const tool = overview.tools.find((item) => item.id === draft.tool)
          if (!tool?.installed || (tool.id !== 'iptables' && !tool.active))
            throw new Error('请先启用所选防火墙')
          if (overview.nativeNftInput)
            throw new Error('存在原生 nftables 入站规则，请在原生管理器中修改')
          if (draft.tool === 'firewalld' && !overview.zones.some((z) => z.name === draft.zone))
            throw new Error('请选择实际存在的 zone')
          plan = createFirewallRulePlan({
            ...draft,
            sshClientIp: overview.sshClientIp,
            sshServerPort: overview.sshServerPort
          })
          command = buildAllowFirewallCommand(plan, overview)
          break
        }
        case 'delete': {
          const rule = overview.rules.find((item) => item.key === action.key)
          if (!rule) throw new Error('规则已变化或不存在，请刷新后重试')
          if (!rule.deletable) throw new Error(rule.protectionReason || '该规则仅供查看')
          if (overview.nativeNftInput)
            throw new Error('存在原生 nftables 入站规则，已禁止跨管理器删除')
          command = buildDeleteFirewallCommand(rule, overview)
          break
        }
        case 'enable': {
          const tool = overview.tools.find((t) => t.id === action.tool)
          if (!tool?.installed || tool.active) throw new Error('该防火墙不存在或已经启用，请刷新')
          if (
            overview.nativeNftInput ||
            overview.tools.some((t) => t.active && t.id !== action.tool) ||
            overview.rawRules.iptables.some((line) => line.includes('|-A INPUT '))
          )
            throw new Error('已有其他入站防护规则，不能直接切换管理器')
          enabling = { token: randomUUID(), expiresAt: Date.now() + 85000, tool: action.tool }
          command = buildEnableFirewallCommand(action.tool, overview, enabling.token)
          break
        }
        case 'disable':
          if (!['ufw', 'firewalld'].includes(action.tool)) throw new Error('不支持该管理器')
          command = buildDisableFirewallCommand(action.tool)
          break
        case 'install':
          if (
            !['ufw', 'firewalld'].includes(action.tool) ||
            overview.tools.find((t) => t.id === action.tool)?.installed
          )
            throw new Error('安装目标无效或已安装')
          command = buildInstallFirewallCommand(action.tool)
          timeout = 180000
          break
        default:
          throw new Error('无效的防火墙操作')
      }
      if (this.connected(id) !== client || signal?.aborted)
        throw new Error('连接已变化或操作已取消')
      const result = await this.connections.executeCommandDetailed(
        id,
        command,
        timeout,
        2 * 1024 * 1024,
        undefined,
        signal
      )
      if (result.exitCode !== 0 || !result.stdout.includes('__MSHELL_FIREWALL_COMMITTED__'))
        throw new Error(result.stderr || result.stdout || '修改未完成，已尝试回滚，请重新检测')
      if (enabling) this.pending.set(id, enabling)
      let after: FirewallOverview
      try {
        after = await this.inspect(id)
      } catch {
        throw new Error('命令已提交，但重新检测失败。请重新连接并检测；启用操作未确认时会自动回滚')
      }
      if (after.errors.length)
        throw new Error('修改后检测不完整，请重新检测：' + after.errors.join('；'))
      if (plan && !planApplied(plan, after))
        throw new Error('尚未确认规则在内核生效，请检查运行时与永久状态')
      if (action.type === 'delete' && after.rules.some((rule) => rule.key === action.key))
        throw new Error('规则仍然存在，删除未验证通过')
      if (
        action.type === 'install' &&
        !after.tools.find((tool) => tool.id === action.tool)?.installed
      )
        throw new Error('未确认软件包安装完成，请重新检测')
      if (action.type === 'disable' && after.tools.find((tool) => tool.id === action.tool)?.active)
        throw new Error('防火墙仍在运行，停用未验证通过')
      if (
        enabling &&
        (!after.tools.find((tool) => tool.id === enabling!.tool)?.active ||
          Date.now() >= enabling.expiresAt)
      )
        throw new Error('启用确认已超时或自动回滚，请重新检测')
      return {
        output: result.stdout.replace('__MSHELL_FIREWALL_COMMITTED__', '').trim(),
        overview: after,
        ...(enabling ? { pending: { token: enabling.token, expiresAt: enabling.expiresAt } } : {})
      }
    } finally {
      this.running.delete(id)
    }
  }
  async confirm(id: string, token: string): Promise<FirewallOverview> {
    if (this.running.has(id)) throw new Error('防火墙操作正在进行')
    const pending = this.pending.get(id)
    if (!pending || pending.token !== token || pending.expiresAt <= Date.now())
      throw new Error('确认已过期，请重新检测自动回滚结果')
    this.running.add(id)
    try {
      this.connected(id)
      const result = await this.connections.executeCommandDetailed(
        id,
        buildConfirmFirewallCommand(pending.tool, token),
        15000,
        1024 * 1024
      )
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || '确认失败')
      this.pending.delete(id)
      return await this.inspect(id)
    } finally {
      this.running.delete(id)
    }
  }
}
function planApplied(plan: FirewallRulePlan, overview: FirewallOverview) {
  const canonical = (source: string) => {
    if (!source) return ''
    try {
      const normalized = normalizeSource(source)
      return normalized.endsWith('/0') ? '' : normalized
    } catch {
      return null
    }
  }
  return plan.ports.every((port) =>
    plan.protocols.every((protocol) =>
      (plan.sources.length ? plan.sources : ['']).every((source) => {
        const families: Array<'IPv4' | 'IPv6' | undefined> =
          plan.tool === 'firewalld'
            ? [undefined]
            : source
              ? [source.includes(':') ? 'IPv6' : 'IPv4']
              : [
                  'IPv4',
                  ...(overview.rawRules.iptables.some((line) => line.startsWith('6|'))
                    ? ['IPv6' as const]
                    : [])
                ]
        return families.every((family) =>
          overview.rules.some((rule) => {
            if (
              rule.tool !== plan.tool ||
              rule.action !== 'allow' ||
              rule.runtime === false ||
              rule.port?.replace(':', '-') !== port ||
              rule.protocol !== protocol
            )
              return false
            if (family && rule.family !== family) return false
            if (plan.tool === 'iptables' && !rule.managed) return false
            if (plan.tool === 'firewalld' && rule.zone !== plan.zone) return false
            return (
              canonical(rule.source || '') === canonical(source) &&
              (!plan.persistent || rule.persistent)
            )
          })
        )
      })
    )
  )
}
import { parseFirewallOverview as parseOverview } from '../../src/utils/firewall-model'
export const firewallManager = new FirewallManager()
