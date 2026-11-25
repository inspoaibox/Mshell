import { sshConnectionManager } from './SSHConnectionManager'
import type {
  PortCloseRequest,
  PortCloseResult,
  PortEntry,
  PortOverview
} from '../../src/types/ports'
import {
  buildPortCloseScript,
  buildPortOverviewScript,
  parseCloseResult,
  parsePortOverview
} from '../utils/port-scripts'
import { closeBlockReason, stoppableUnitOf } from '../../src/utils/port-utils'

type Connections = Pick<typeof sshConnectionManager, 'getConnection' | 'executeCommandDetailed'>

const MODES = new Set(['term', 'kill', 'service'])

export class PortManager {
  private busy = new Set<string>()

  constructor(private connections: Connections = sshConnectionManager) {}

  private ensureConnected(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('无效的 SSH 连接')
    const connection = this.connections.getConnection(id)
    if (!connection || connection.status !== 'connected') {
      throw new Error('SSH 未连接，请重连后刷新')
    }
    return connection.client
  }

  async inspect(id: string): Promise<PortOverview> {
    const client = this.ensureConnected(id)
    const result = await this.connections.executeCommandDetailed(
      id,
      buildPortOverviewScript(),
      30000,
      8 * 1024 * 1024
    )
    if (this.ensureConnected(id) !== client) throw new Error('检测期间连接已变化，请重新刷新')
    return parsePortOverview(result.stdout)
  }

  async close(id: string, request: PortCloseRequest): Promise<PortCloseResult> {
    validateRequest(request)
    if (this.busy.has(id)) throw new Error('该服务器已有端口操作正在进行，请稍后')
    this.busy.add(id)
    try {
      const before = await this.inspect(id)
      const entry = before.ports.find(
        (item) => item.protocol === request.protocol && item.port === request.port
      )
      if (!entry) {
        return { closed: true, message: `端口 ${request.port} 已不在监听`, output: '' }
      }

      const plan = planClose(entry, request)
      const result = await this.connections.executeCommandDetailed(
        id,
        buildPortCloseScript(request.mode, plan.pids, plan.unit),
        30000,
        1024 * 1024
      )
      const parsed = parseCloseResult(result.stdout)
      const output = [parsed.log, result.stderr].filter(Boolean).join('\n')

      const after = await this.inspect(id).catch(() => undefined)
      const current = after?.ports.find(
        (item) => item.protocol === request.protocol && item.port === request.port
      )
      const label = `${request.protocol.toUpperCase()} ${request.port}`

      if (!after) {
        return {
          closed: false,
          message: `${label}：操作已执行，但重新检测失败，请刷新确认`,
          output
        }
      }
      if (!current) {
        return { closed: true, message: `${label} 已关闭`, output }
      }
      if (parsed.status !== 0) {
        return { closed: false, message: `${label} 关闭失败`, output, current }
      }
      const restarted = current.rootPids.some((pid) => !plan.pids.includes(pid))
      return {
        closed: false,
        message: restarted
          ? `${label} 仍在监听：进程已被重新拉起（PID ${current.rootPids.join(', ')}）。如由 systemd 管理，请使用“停止服务”`
          : parsed.alive.length
            ? `${label} 仍在监听：进程 ${parsed.alive.join(', ')} 未在 5 秒内退出，可尝试“强制结束”`
            : `${label} 仍在监听，请刷新查看最新占用`,
        output,
        current
      }
    } finally {
      this.busy.delete(id)
    }
  }
}

const validateRequest = (request: PortCloseRequest) => {
  if (!request || typeof request !== 'object') throw new Error('请求无效')
  if (request.protocol !== 'tcp' && request.protocol !== 'udp') throw new Error('协议无效')
  if (!Number.isInteger(request.port) || request.port < 0 || request.port > 65535) {
    throw new Error('端口无效')
  }
  if (!MODES.has(request.mode)) throw new Error('不支持的关闭方式')
  if (
    !Array.isArray(request.expectedPids) ||
    request.expectedPids.some((pid) => !Number.isInteger(pid))
  ) {
    throw new Error('进程信息无效')
  }
}

/**
 * 根据最新检测结果确定要结束的进程，并拒绝危险或不确定的操作。
 */
export function planClose(
  entry: PortEntry,
  request: PortCloseRequest
): { pids: number[]; unit?: string } {
  const label = `${entry.protocol.toUpperCase()} ${entry.port}`
  const blocked = closeBlockReason(entry)
  if (blocked) {
    const containers = entry.containers.length ? `（容器：${entry.containers.join('、')}）` : ''
    throw new Error(`${label}：${blocked}${containers}`)
  }
  const pids = entry.rootPids
  const expected = [...new Set(request.expectedPids)].sort((a, b) => a - b)
  if (pids.length !== expected.length || pids.some((pid, index) => pid !== expected[index])) {
    throw new Error(`${label} 的占用进程已变化，请刷新后重新确认`)
  }

  if (request.mode === 'service') {
    const unit = stoppableUnitOf(entry)
    if (!unit) {
      throw new Error(`${label} 不属于单个可停止的 systemd 服务（系统关键服务除外），请改用结束进程`)
    }
    return { pids, unit }
  }
  return { pids }
}

export const portManager = new PortManager()
