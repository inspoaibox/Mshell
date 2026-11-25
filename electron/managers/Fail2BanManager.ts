import { sshConnectionManager } from './SSHConnectionManager'
import type {
  Fail2BanJail,
  Fail2BanOperationResult,
  Fail2BanOverview
} from '../../src/types/fail2ban'
import {
  buildFail2BanDetectCommand,
  buildFail2BanInstallCommand,
  buildFail2BanUnbanCommand,
  FAIL2BAN_DETECT_END,
  FAIL2BAN_DETECT_START,
  FAIL2BAN_OPERATION_DONE
} from '../utils/fail2ban-commands'

type CommandClient = Pick<typeof sshConnectionManager, 'executeCommandDetailed'>

const numberValue = (value: string | undefined) => {
  const parsed = Number.parseInt(value || '0', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const splitIps = (value: string | undefined) =>
  (value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)

export class Fail2BanManager {
  private busy = new Set<string>()

  constructor(private ssh: CommandClient = sshConnectionManager) {}

  private validateConnection(connectionId: string) {
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      throw new Error('无效的 SSH 连接')
    }
  }

  async getOverview(connectionId: string): Promise<Fail2BanOverview> {
    this.validateConnection(connectionId)
    const result = await this.ssh.executeCommandDetailed(
      connectionId,
      buildFail2BanDetectCommand(),
      45000,
      4 * 1024 * 1024
    )
    if (result.exitCode !== 0 && result.exitCode !== null) {
      throw new Error([result.stderr, result.stdout].filter(Boolean).join('\n') || 'Fail2Ban 检测失败')
    }

    const start = result.stdout.indexOf(FAIL2BAN_DETECT_START)
    const end = result.stdout.indexOf(FAIL2BAN_DETECT_END, start + FAIL2BAN_DETECT_START.length)
    if (start < 0 || end < 0) throw new Error('Fail2Ban 检测输出不完整，请重新刷新')

    let environment = {
      osId: 'unknown',
      osName: 'unknown',
      versionId: '',
      packageManager: 'unknown',
      needsPrivilege: true,
      canSudo: false
    }
    let meta = {
      installed: false,
      version: '',
      serviceStatus: 'not-installed',
      serviceError: '',
      running: false,
      enabled: false
    }
    const jails: Fail2BanJail[] = []

    for (const line of result.stdout.slice(start + FAIL2BAN_DETECT_START.length, end).split(/\r?\n/)) {
      if (line.startsWith('ENV|')) {
        const [, osId, osName, versionId, packageManager, needsPrivilege, canSudo] = line.split('|')
        environment = {
          osId: osId || 'unknown',
          osName: osName || 'unknown',
          versionId: versionId || '',
          packageManager: packageManager || 'unknown',
          needsPrivilege: needsPrivilege === 'yes',
          canSudo: canSudo === 'yes'
        }
      } else if (line.startsWith('META|')) {
        const [, installed, version, serviceStatus, running, enabled, _uid, serviceError] = line.split('|')
        meta = {
          installed: installed === 'yes',
          version: version || '',
          serviceStatus: serviceStatus || 'unknown',
          serviceError: serviceError || '',
          running: running === 'yes',
          enabled: enabled === 'yes'
        }
      } else if (line.startsWith('JAIL|')) {
        const [, name, currentlyFailed, totalFailed, currentlyBanned, totalBanned, ips] = line.split('|')
        if (name) {
          jails.push({
            name,
            currentlyFailed: numberValue(currentlyFailed),
            totalFailed: numberValue(totalFailed),
            currentlyBanned: numberValue(currentlyBanned),
            totalBanned: numberValue(totalBanned),
            bannedIps: splitIps(ips)
          })
        }
      }
    }

    const warnings: string[] = []
    if (!meta.installed) warnings.push('当前服务器未安装 Fail2Ban')
    else if (!meta.running) {
      warnings.push('Fail2Ban 已安装但服务未运行')
      if (meta.serviceError) warnings.push('服务启动原因：' + meta.serviceError)
    } else if (!jails.length) {
      warnings.push('Fail2Ban 服务已运行，但当前没有启用任何 Jail')
    }
    if (environment.needsPrivilege && !environment.canSudo)
      warnings.push('当前 SSH 用户没有 root 或免密 sudo 权限，无法自动安装和操作')

    return {
      installed: meta.installed,
      version: meta.version,
      serviceStatus: meta.serviceStatus,
      serviceError: meta.serviceError || undefined,
      running: meta.running,
      enabled: meta.enabled,
      environment,
      jails,
      totalCurrentlyBanned: jails.reduce((sum, jail) => sum + jail.currentlyBanned, 0),
      totalBanned: jails.reduce((sum, jail) => sum + jail.totalBanned, 0),
      totalFailed: jails.reduce((sum, jail) => sum + jail.totalFailed, 0),
      warnings,
      capturedAt: Date.now()
    }
  }

  private async operate(
    connectionId: string,
    command: string,
    timeout: number,
    successMessage: string
  ): Promise<Fail2BanOperationResult> {
    this.validateConnection(connectionId)
    if (this.busy.has(connectionId)) throw new Error('当前服务器已有 Fail2Ban 操作正在进行，请稍后刷新')
    this.busy.add(connectionId)
    try {
      const result = await this.ssh.executeCommandDetailed(
        connectionId,
        command,
        timeout,
        8 * 1024 * 1024
      )
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      if (result.exitCode !== 0 || !result.stdout.includes(FAIL2BAN_OPERATION_DONE)) {
        throw new Error(output || `${successMessage}失败`)
      }
      const overview = await this.getOverview(connectionId)
      return { output: output || successMessage, overview }
    } finally {
      this.busy.delete(connectionId)
    }
  }

  install(connectionId: string) {
    return this.operate(connectionId, buildFail2BanInstallCommand(), 600000, 'Fail2Ban 安装')
  }

  async unban(connectionId: string, jail: string, ip: string) {
    return this.operate(connectionId, buildFail2BanUnbanCommand(jail, ip), 60000, '解封 IP')
  }
}

export const fail2banManager = new Fail2BanManager()
