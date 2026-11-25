import { sshConnectionManager } from './SSHConnectionManager'
import type { SecurityDetails, SecuritySummary } from '../../src/types/security'
import {
  buildSecurityDetailsScript,
  buildSecuritySummaryScript,
  parseSecurityDetails,
  parseSecuritySummary
} from '../utils/security-scripts'

type Connections = Pick<typeof sshConnectionManager, 'getConnection' | 'executeCommandDetailed'>

/**
 * 服务器安全信息：在线会话、SSH/远程连接、认证日志。只读采集，不修改服务器。
 */
export class ServerSecurityManager {
  private pendingSummary = new Map<string, Promise<SecuritySummary>>()
  private pendingDetails = new Map<string, Promise<SecurityDetails>>()

  constructor(private connections: Connections = sshConnectionManager) {}

  private ensureConnected(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('无效的 SSH 连接')
    const connection = this.connections.getConnection(id)
    if (!connection || connection.status !== 'connected') throw new Error('SSH 未连接')
  }

  getSummary(id: string): Promise<SecuritySummary> {
    this.ensureConnected(id)
    const existing = this.pendingSummary.get(id)
    if (existing) return existing
    const promise = this.connections
      .executeCommandDetailed(id, buildSecuritySummaryScript(), 20000, 2 * 1024 * 1024)
      .then((result) => parseSecuritySummary(result.stdout))
      .finally(() => this.pendingSummary.delete(id))
    this.pendingSummary.set(id, promise)
    return promise
  }

  getDetails(id: string): Promise<SecurityDetails> {
    this.ensureConnected(id)
    const existing = this.pendingDetails.get(id)
    if (existing) return existing
    const promise = this.connections
      .executeCommandDetailed(id, buildSecurityDetailsScript(), 45000, 8 * 1024 * 1024)
      .then((result) => parseSecurityDetails(result.stdout))
      .finally(() => this.pendingDetails.delete(id))
    this.pendingDetails.set(id, promise)
    return promise
  }
}

export const serverSecurityManager = new ServerSecurityManager()
