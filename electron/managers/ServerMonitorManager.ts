import { EventEmitter } from 'node:events'
import type { Client, ClientChannel } from 'ssh2'
import type {
  ServerMetrics,
  MonitorConfig,
  MonitorConfigUpdate,
  MetricSource,
  DiskMetrics,
  DockerContainerInfo
} from '../../src/types/monitor'
import { MONITOR_INTERVALS } from '../../src/types/monitor'
import {
  buildCoreMonitorCommand,
  calculateCoreMetrics,
  parseCoreSample,
  parseDiskMetrics,
  parseDockerMetrics,
  DISK_MONITOR_COMMAND,
  DOCKER_MONITOR_COMMAND,
  type CoreSample
} from '../utils/monitor-sampling'

export type {
  ServerMetrics,
  MonitorConfig,
  ProcessInfo,
  DockerContainerInfo
} from '../../src/types/monitor'

type Task = 'core' | 'disk' | 'docker'
interface MonitorState {
  id: string
  client?: Client
  config: MonitorConfig
  controller: AbortController
  timers: Partial<Record<Task, NodeJS.Timeout>>
  pending: Map<Task, Promise<ServerMetrics | undefined>>
  sources: Record<Task, MetricSource>
  previous?: CoreSample
  identity?: Omit<ServerMetrics['system'], 'uptime'>
  latest?: ServerMetrics
  disk: DiskMetrics | null
  docker: DockerContainerInfo[]
  closeListener?: () => void
}

export class ServerMonitorManager extends EventEmitter {
  private states = new Map<string, MonitorState>()

  private configure(config: MonitorConfigUpdate = {}, previous?: MonitorConfig): MonitorConfig {
    const interval = config.interval ?? previous?.interval ?? 1000
    if (!(MONITOR_INTERVALS as readonly number[]).includes(interval))
      throw new Error('刷新间隔必须是 1、2、3 或 5 秒')
    return {
      interval,
      enabled: config.enabled ?? previous?.enabled ?? true,
      metrics: {
        cpu: true,
        memory: true,
        disk: true,
        network: true,
        processes: true,
        topProcesses: true,
        docker: true,
        ...previous?.metrics,
        ...config.metrics
      }
    }
  }

  startMonitoring(id: string, client: Client, config: MonitorConfigUpdate = {}): void {
    const fullConfig = this.configure(config)
    this.stopMonitoring(id)
    if (!fullConfig.enabled) return
    const state: MonitorState = {
      id,
      client,
      config: fullConfig,
      controller: new AbortController(),
      timers: {},
      pending: new Map(),
      sources: { core: {}, disk: {}, docker: {} },
      disk: null,
      docker: []
    }
    this.states.set(id, state)
    state.closeListener = () => {
      if (this.states.get(id) === state) this.suspendMonitoring(id)
    }
    client.once('close', state.closeListener)
    for (const task of ['core', 'disk', 'docker'] as const) void this.collect(state, task)
  }

  private dispose(state: MonitorState): void {
    for (const timer of Object.values(state.timers)) clearTimeout(timer)
    state.timers = {}
    if (state.closeListener) state.client?.removeListener('close', state.closeListener)
    state.controller.abort()
  }

  stopMonitoring(id: string): void {
    const state = this.states.get(id)
    if (!state) return
    this.states.delete(id)
    this.dispose(state)
  }

  /** Retain the user's monitoring intent, but never poll an obsolete SSH client. */
  suspendMonitoring(id: string): void {
    const state = this.states.get(id)
    if (!state || !state.client) return
    this.dispose(state)
    state.client = undefined
    state.previous = undefined
    state.sources.core.error = 'SSH 已断开，重连后自动恢复监控'
    if (state.latest) {
      state.latest = { ...state.latest, connection: 'waiting' }
      this.publish(state)
    } else {
      this.reportError(id, state.sources.core.error)
    }
  }

  resumeMonitoring(id: string, client: Client): void {
    const state = this.states.get(id)
    if (!state || state.client === client) return
    this.startMonitoring(id, client, state.config)
  }

  getLatestMetrics(id: string): ServerMetrics | undefined {
    return this.states.get(id)?.latest
  }
  getMonitoredSessions(): string[] {
    return [...this.states.keys()]
  }

  updateConfig(id: string, config: MonitorConfigUpdate): void {
    const state = this.states.get(id)
    if (!state) throw new Error('监控尚未启动')
    state.config = this.configure(config, state.config)
    if (!state.config.enabled) {
      this.stopMonitoring(id)
      return
    }
    for (const task of ['core', 'disk', 'docker'] as const) {
      clearTimeout(state.timers[task])
      delete state.timers[task]
      if (!state.pending.has(task)) void this.collect(state, task)
    }
  }

  async refreshMetrics(id: string): Promise<ServerMetrics | undefined> {
    const state = this.states.get(id)
    if (!state?.client) throw new Error('SSH 未连接，无法刷新监控')
    void this.collect(state, 'disk')
    void this.collect(state, 'docker')
    return this.collect(state, 'core')
  }

  private current(state: MonitorState): boolean {
    return this.states.get(state.id) === state && !state.controller.signal.aborted && !!state.client
  }
  private enabled(state: MonitorState, task: Task): boolean {
    return task === 'core' || state.config.metrics[task]
  }
  private period(state: MonitorState, task: Task): number {
    return task === 'core' ? state.config.interval : task === 'disk' ? 10_000 : 5_000
  }
  private reportError(id: string, message: string): void {
    if (this.listenerCount('error')) this.emit('error', id, message)
  }

  private publish(state: MonitorState): ServerMetrics | undefined {
    if (this.states.get(state.id) !== state || !state.latest) return undefined
    const metrics: ServerMetrics = {
      ...state.latest,
      interval: state.config.interval,
      disk: state.disk,
      dockerContainers: state.docker,
      sources: {
        core: { ...state.sources.core },
        disk: { ...state.sources.disk },
        docker: { ...state.sources.docker }
      }
    }
    state.latest = metrics
    this.emit('metrics', state.id, metrics)
    return metrics
  }

  private collect(state: MonitorState, task: Task): Promise<ServerMetrics | undefined> {
    if (!this.current(state) || !this.enabled(state, task)) return Promise.resolve(undefined)
    const existing = state.pending.get(task)
    if (existing) return existing
    clearTimeout(state.timers[task])
    delete state.timers[task]
    const started = Date.now()
    const promise = this.collectOnce(state, task)
      .catch((error) => {
        if (this.current(state) && this.enabled(state, task)) {
          state.sources[task] = {
            ...state.sources[task],
            error: error instanceof Error ? error.message : String(error)
          }
          this.publish(state)
          if (task === 'core') this.reportError(state.id, state.sources.core.error!)
        }
        return undefined
      })
      .finally(() => {
        state.pending.delete(task)
        if (this.current(state) && this.enabled(state, task)) {
          state.timers[task] = setTimeout(
            () => {
              void this.collect(state, task)
            },
            Math.max(100, this.period(state, task) - (Date.now() - started))
          )
        }
      })
    state.pending.set(task, promise)
    return promise
  }

  private async collectOnce(state: MonitorState, task: Task): Promise<ServerMetrics | undefined> {
    const started = Date.now()
    const command =
      task === 'core'
        ? buildCoreMonitorCommand(
            !state.identity,
            state.config.metrics.processes || state.config.metrics.topProcesses
          )
        : task === 'disk'
          ? DISK_MONITOR_COMMAND
          : DOCKER_MONITOR_COMMAND
    const output = await this.executeCommand(
      state.client!,
      command,
      state.controller.signal,
      task === 'disk' ? 5000 : 8000
    )
    if (!this.current(state) || !this.enabled(state, task)) return undefined
    const timestamp = new Date().toISOString()
    if (task === 'core') {
      const sample = parseCoreSample(output)
      const values = calculateCoreMetrics(sample, state.previous)
      state.identity = {
        hostname: sample.identity.hostname ?? state.identity?.hostname ?? '未知主机',
        platform: sample.identity.platform ?? state.identity?.platform ?? 'Linux',
        kernel: sample.identity.kernel ?? state.identity?.kernel ?? ''
      }
      state.latest = {
        sessionId: state.id,
        timestamp,
        interval: state.config.interval,
        connection: 'connected',
        collectionDurationMs: Date.now() - started,
        ...values,
        disk: state.disk,
        dockerContainers: state.docker,
        sources: state.sources,
        system: { ...state.identity, uptime: sample.uptime }
      }
      state.previous = sample
    } else if (task === 'disk') {
      state.disk = parseDiskMetrics(output)
    } else {
      const docker = parseDockerMetrics(output)
      state.docker = docker.containers
      state.sources.docker.available = docker.available
    }
    state.sources[task] = { ...state.sources[task], timestamp, error: undefined }
    return this.publish(state)
  }

  private executeCommand(
    client: Client,
    command: string,
    signal: AbortSignal,
    timeout: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false
      let channel: ClientChannel | undefined
      const chunks: Buffer[] = []
      let size = 0
      let stderr = ''
      const terminate = () => {
        try {
          channel?.signal('TERM')
        } catch {}
        try {
          channel?.close()
        } catch {}
      }
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        if (error) {
          reject(error)
          terminate()
        } else resolve(Buffer.concat(chunks).toString('utf8'))
      }
      const onAbort = () => finish(new Error('监控采集已取消'))
      const timer = setTimeout(
        () => finish(new Error(`监控采集超时（${timeout / 1000} 秒），将自动重试`)),
        timeout
      )
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        onAbort()
        return
      }
      try {
        client.exec(command, (error, stream) => {
          if (settled) {
            if (stream) {
              channel = stream
              stream.on('error', () => {})
              terminate()
            }
            return
          }
          if (error) {
            finish(error)
            return
          }
          channel = stream
          stream.on('error', finish)
          stream.on('data', (data: Buffer | string) => {
            if (settled) return
            const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
            size += bytes.length
            if (size > 2 * 1024 * 1024) {
              finish(new Error('监控输出超过 2 MiB 上限'))
              return
            }
            chunks.push(bytes)
          })
          stream.stderr.on('data', (data: Buffer) => {
            if (!settled && stderr.length < 2048)
              stderr += data.toString().slice(0, 2048 - stderr.length)
          })
          stream.on('close', (code: number) => {
            finish(
              code === 0
                ? undefined
                : new Error(stderr.trim() || `监控命令退出（${code ?? '连接关闭'}）`)
            )
          })
        })
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }
}

export const serverMonitorManager = new ServerMonitorManager()
