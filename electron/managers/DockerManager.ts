import { z } from 'zod'
import { sshConnectionManager } from './SSHConnectionManager'
import type {
  DockerContainerAction,
  DockerContainerActionOptions,
  DockerOperationItem,
  DockerOperationResult,
  DockerOverview
} from '../../src/types/docker'
import {
  buildDockerActionScript,
  buildDockerCleanupScript,
  buildDockerInstallScript,
  buildDockerOverviewScript,
  OPERATION_DONE,
  OVERVIEW_END,
  OVERVIEW_START,
  RESULT_PREFIX
} from '../utils/docker-scripts'

export type { DockerContainerAction, DockerContainerActionOptions } from '../../src/types/docker'
const text = z.string()
const overviewSchema = z.object({
  environment: z.object({
    installed: z.boolean(),
    dockerVersion: text,
    composeInstalled: z.boolean(),
    composeVersion: text,
    serviceStatus: text,
    socketAccessible: z.boolean(),
    needsSudo: z.boolean(),
    accessError: text,
    accessStatus: z.enum(['ready', 'not-installed', 'permission-denied', 'unavailable']),
    os: z.object({ id: text, versionId: text, prettyName: text, packageManager: text })
  }),
  containers: z.array(
    z.object({
      id: text.regex(/^[a-f0-9]{64}$/i),
      name: text,
      image: text,
      state: text,
      status: text,
      ports: text,
      createdAt: text,
      composeProject: text,
      composeService: text,
      composeWorkingDir: text,
      composeConfigFiles: text
    })
  ),
  stats: z.array(z.object({ ID: text, CPUPerc: text, MemUsage: text, NetIO: text })),
  warnings: z.array(text)
})
const itemSchema = z.object({
  kind: z.enum(['container', 'image', 'network', 'cleanup', 'installation', 'operation']),
  target: text,
  status: z.enum(['success', 'failed', 'skipped']),
  message: text
})
const actions = new Set(['start', 'pause', 'unpause', 'restart', 'stop', 'remove'])
type CommandClient = Pick<typeof sshConnectionManager, 'executeCommandDetailed'>

export class DockerManager {
  private busy = new Set<string>()
  constructor(private ssh: CommandClient = sshConnectionManager) {}

  private validateConnection(id: string) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('无效的 SSH 连接')
  }

  async getOverview(connectionId: string): Promise<DockerOverview> {
    this.validateConnection(connectionId)
    const result = await this.ssh.executeCommandDetailed(
      connectionId,
      buildDockerOverviewScript(),
      30000,
      8 * 1024 * 1024
    )
    if (result.exitCode !== 0)
      throw new Error(
        [result.stderr, result.stdout].filter(Boolean).join('\n') || 'Docker 检测失败'
      )
    const start = result.stdout.indexOf(OVERVIEW_START)
    const end = result.stdout.indexOf(OVERVIEW_END, start + OVERVIEW_START.length)
    if (start < 0 || end < 0) throw new Error('Docker 检测输出不完整，请重新刷新')
    let parsed: z.infer<typeof overviewSchema>
    try {
      parsed = overviewSchema.parse(
        JSON.parse(result.stdout.slice(start + OVERVIEW_START.length, end))
      )
    } catch {
      throw new Error('Docker 检测数据格式异常，未更新容器列表')
    }
    const stats = new Map(parsed.stats.map((row) => [row.ID, row]))
    return {
      environment: parsed.environment,
      warnings: parsed.warnings,
      containers: parsed.containers.map((row) => {
        const sample = stats.get(row.id) || stats.get(row.id.slice(0, 12))
        return {
          ...row,
          cpu: sample?.CPUPerc || '-',
          memory: sample?.MemUsage || '-',
          netIO: sample?.NetIO || '-'
        }
      })
    }
  }

  private async operate(
    connectionId: string,
    script: string,
    timeout: number,
    installation = false
  ): Promise<DockerOperationResult> {
    this.validateConnection(connectionId)
    if (this.busy.has(connectionId))
      throw new Error('当前服务器已有 Docker 操作正在进行，请稍后刷新')
    this.busy.add(connectionId)
    try {
      const result = await this.ssh.executeCommandDetailed(
        connectionId,
        script,
        timeout,
        8 * 1024 * 1024
      )
      const items: DockerOperationItem[] = []
      const logs: string[] = []
      let complete = false
      let malformed = false
      for (const line of result.stdout.split(/\r?\n/)) {
        if (line === OPERATION_DONE) complete = true
        else if (line.startsWith(RESULT_PREFIX)) {
          try {
            items.push(itemSchema.parse(JSON.parse(line.slice(RESULT_PREFIX.length))))
          } catch {
            logs.push(line)
            malformed = true
          }
        } else if (line) logs.push(line)
      }
      if (result.stderr) logs.push(result.stderr)
      if (
        installation ||
        !complete ||
        malformed ||
        (result.exitCode !== 0 && !items.some((item) => item.status === 'failed'))
      ) {
        items.push({
          kind: installation ? 'installation' : 'operation',
          target: installation ? 'Docker + Compose' : 'Docker',
          status: complete && !malformed && result.exitCode === 0 ? 'success' : 'failed',
          message: logs.join('\n') || '操作未完整结束，可能已有部分操作生效，请检查刷新后的状态'
        })
      }
      if (!items.length)
        items.push({
          kind: 'operation',
          target: 'Docker',
          status: 'failed',
          message: '未收到操作结果，请刷新确认'
        })
      const failures = items.filter((item) => item.status === 'failed').length
      const status = failures
        ? items.some((item) => item.status === 'success')
          ? 'partial'
          : 'failed'
        : 'success'
      const labels = { success: '成功', failed: '失败', skipped: '跳过' }
      return {
        status,
        items,
        output: [
          ...logs,
          ...items.map((item) => `[${labels[item.status]}] ${item.target}\n${item.message}`)
        ].join('\n')
      }
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}；操作结果未确认，可能已有部分操作生效，请刷新检查`
      )
    } finally {
      this.busy.delete(connectionId)
    }
  }

  install(connectionId: string) {
    return this.operate(connectionId, buildDockerInstallScript(), 600000, true)
  }

  cleanupUnused(connectionId: string) {
    return this.operate(connectionId, buildDockerCleanupScript(), 180000)
  }

  executeContainerAction(
    connectionId: string,
    action: DockerContainerAction,
    id: string,
    options: DockerContainerActionOptions = {}
  ) {
    return this.executeContainerBatchAction(connectionId, action, [id], options)
  }

  async executeContainerBatchAction(
    connectionId: string,
    action: DockerContainerAction,
    ids: string[],
    options: DockerContainerActionOptions = {}
  ) {
    if (!actions.has(action)) throw new Error('不支持的 Docker 操作')
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{12,64}$/i.test(id))
    ) {
      throw new Error('容器 ID 无效或单次选择超过 100 个容器')
    }
    const targets = [...new Set(ids)]
    const safeOptions = {
      removeImage: options?.removeImage === true,
      removeNetworks: options?.removeNetworks === true
    }
    return this.operate(
      connectionId,
      buildDockerActionScript(action, targets, safeOptions),
      Math.min(1800000, Math.max(60000, targets.length * 60000))
    )
  }
}

export const dockerManager = new DockerManager()
