import { EventEmitter } from 'node:events'
import { Client } from 'ssh2'
import * as fs from 'fs'
import { transferRecordManager, type TransferRecord } from './TransferRecordManager'
import { ErrorHandler } from '../utils/error-handler'
import { appSettingsManager } from '../utils/app-settings'

export interface SFTPFileInfo {
  name: string
  type: 'file' | 'directory' | 'symlink'
  /** 仅 type 为 'symlink' 时存在：链接目标的类型（目标不存在或为其它类型时缺省） */
  targetType?: 'file' | 'directory'
  size: number
  modifyTime: Date
  accessTime: Date
  /** 0o777 权限位 */
  permissions: number
  /** setuid / setgid / sticky 位（mode & 0o7000） */
  specialBits: number
  owner: number
  group: number
}

export interface TransferProgress {
  transferred: number
  total: number
  percentage: number
  speed: number
  eta: number
}

export interface TransferTask {
  id: string
  type: 'upload' | 'download'
  localPath: string
  remotePath: string
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled'
  progress: TransferProgress
  error?: string
}

interface RealtimeSpeedSample {
  transferred: number
  time: number
  speed: number
}

type UploadFileRequest = {
  localPath: string
  remotePath: string
  taskId?: string
  resumeFromExisting?: boolean
}

type DownloadFileRequest = {
  remotePath: string
  localPath: string
  taskId?: string
  resumeFromExisting?: boolean
}

export type TransferBatchResults = {
  success: string[]
  failed: Array<{ path: string; error: string }>
  paused: string[]
  cancelled: string[]
}

/** 内部选项：拖曳下载等一次性任务使用 */
export type TransferRunOptions = {
  /** 不经过全局并发队列（例如拖曳到桌面的临时下载） */
  skipQueue?: boolean
  /** 不向渲染进程广播事件，结束后删除传输记录 */
  ephemeral?: boolean
}

export class TransferPausedError extends Error {
  constructor(public readonly taskId: string) {
    super(`Transfer paused: ${taskId}`)
    this.name = 'TransferPausedError'
  }
}

export class TransferCancelledError extends Error {
  constructor(public readonly taskId: string) {
    super(`Transfer cancelled: ${taskId}`)
    this.name = 'TransferCancelledError'
  }
}

/** 暂停或取消（不是失败） */
export function isTransferInterruption(
  error: unknown
): error is TransferPausedError | TransferCancelledError {
  return error instanceof TransferPausedError || error instanceof TransferCancelledError
}

export const SFTP_CONNECTION_LOST_MESSAGE = '连接已断开'

/** 已经通过 'error' 事件通知过渲染进程的错误，调用方无需再次广播 */
const reportedTransferErrors = new WeakSet<object>()

export function isReportedTransferError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && reportedTransferErrors.has(error)
}

/** 等待队列中的任务被移出（暂停/取消/连接断开） */
class SlotEvictedError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly reason: 'interrupt' | 'connection-lost'
  ) {
    super(`Transfer slot evicted: ${taskId}`)
    this.name = 'SlotEvictedError'
  }
}

const RESUMABLE_TRANSFER_STATUSES = new Set<TransferRecord['status']>([
  'pending',
  'active',
  'paused',
  'failed'
])

const FINISHED_RECORD_STATUSES = new Set<TransferRecord['status']>([
  'completed',
  'failed',
  'cancelled'
])

const PREVIEW_MAX_BYTES = 10 * 1024 * 1024
const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000
const FINISHED_TASK_RETENTION_MS = 60 * 1000
const STREAM_CHUNK_SIZE = 256 * 1024

type TransferParams = {
  kind: 'upload' | 'download'
  connectionId: string
  localPath: string
  remotePath: string
  taskId: string
  onProgress?: (progress: TransferProgress) => void
  resumable: boolean
  resumeFromExisting: boolean
  options: TransferRunOptions
}

type TransferOutcome =
  | { kind: 'success' }
  | { kind: 'failed'; message: string }
  | { kind: 'paused' }
  | { kind: 'cancelled' }

type ActiveTransfer = {
  taskId: string
  connectionId: string
  settle: (outcome: TransferOutcome) => Promise<void>
}

type SlotWaiter = {
  taskId: string
  connectionId: string
  resolve: () => void
  reject: (error: Error) => void
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function joinRemotePath(dirPath: string, name: string): string {
  return dirPath.endsWith('/') ? `${dirPath}${name}` : `${dirPath}/${name}`
}

/** 截断后去掉末尾不完整的 UTF-8 多字节序列，避免出现替换字符 */
function trimIncompleteUtf8(buffer: Buffer): Buffer {
  const length = buffer.length
  for (let back = 1; back <= Math.min(4, length); back++) {
    const byte = buffer[length - back]
    if ((byte & 0xc0) === 0x80) continue // 续字节，继续向前找首字节
    let expected = 1
    if ((byte & 0xe0) === 0xc0) expected = 2
    else if ((byte & 0xf0) === 0xe0) expected = 3
    else if ((byte & 0xf8) === 0xf0) expected = 4
    return expected > back ? buffer.subarray(0, length - back) : buffer
  }
  return buffer
}

/**
 * SFTPManager - 管理 SFTP 文件操作
 *
 * 传输状态机说明：
 * - 所有传输（单文件、批量、恢复）都经过同一个全局并发限制器（maxConcurrentTransfers）。
 * - 尚未开始的任务（排队中 / 正在 stat 与写记录）收到暂停或取消时，记录到 pendingPauses /
 *   pendingCancels，在任务即将开始时生效。
 * - 流式传输的结束是单次结算的：成功前会校验目标文件大小，失败/暂停/取消都会销毁两端流。
 */
export class SFTPManager extends EventEmitter {
  private sftpClients: Map<string, any>
  private sshClients: Map<string, Client>
  private sftpInitGenerations: Map<string, number>
  private pendingSftpInitializations: Map<string, { client: Client; promise: Promise<void> }>
  private transferTasks: Map<string, TransferTask>
  /** 正在流式传输的任务 */
  private activeTransfers = new Map<string, ActiveTransfer>()
  /** 已登记但尚未开始流式传输的任务（taskId → connectionId） */
  private preparingTasks = new Map<string, string>()
  /** 在任务开始前到达的取消/暂停请求（taskId → 请求时间） */
  private pendingCancels = new Map<string, number>()
  private pendingPauses = new Map<string, number>()
  /** 通道关闭时需要通知的进行中请求/流 */
  private channelWatchers = new Map<string, Set<(error: Error) => void>>()
  private ephemeralTasks = new Set<string>()
  private finishedTaskTimers = new Map<string, NodeJS.Timeout>()
  private runningSlots = 0
  private slotQueue: SlotWaiter[] = []
  /** 活动传输在这么长时间内没有任何数据时判定为超时 */
  stallTimeoutMs = 60_000

  constructor() {
    super()
    this.sftpClients = new Map()
    this.sshClients = new Map()
    this.sftpInitGenerations = new Map()
    this.pendingSftpInitializations = new Map()
    this.transferTasks = new Map()

    // 初始化传输记录管理器（幂等；各方法内部也会等待加载完成）
    transferRecordManager.initialize().catch(console.error)
  }

  private createProgress(
    transferred: number,
    total: number,
    speed: number,
    eta: number
  ): TransferProgress {
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0
    const safeTransferred = Math.max(0, Math.min(transferred || 0, safeTotal || transferred || 0))
    const rawPercentage = safeTotal > 0 ? (safeTransferred / safeTotal) * 100 : 0
    const clampedPercentage = Math.min(100, Math.max(0, rawPercentage))
    return {
      transferred: safeTransferred,
      total: safeTotal,
      percentage: Number(clampedPercentage.toFixed(2)),
      speed: Number.isFinite(speed) && speed > 0 ? speed : 0,
      eta: Number.isFinite(eta) && eta > 0 ? eta : 0
    }
  }

  private updateRealtimeSpeedSample(
    sample: RealtimeSpeedSample,
    transferred: number,
    now: number,
    force = false
  ): number {
    if (transferred < sample.transferred) {
      sample.transferred = transferred
      sample.time = now
      sample.speed = 0
      return sample.speed
    }

    const elapsed = (now - sample.time) / 1000
    const bytesDiff = transferred - sample.transferred

    if (elapsed > 0 && bytesDiff > 0 && (force || elapsed >= 0.25)) {
      sample.speed = bytesDiff / elapsed
      sample.transferred = transferred
      sample.time = now
    } else if (bytesDiff === 0 && elapsed >= 1.5) {
      // 停滞时速度衰减为 0，而不是一直显示最后一次的速度
      sample.speed = 0
      sample.time = now
    }

    return sample.speed
  }

  // ---------------------------------------------------------------------------
  // 通道管理
  // ---------------------------------------------------------------------------

  /**
   * 初始化 SFTP 会话
   */
  async initSFTP(connectionId: string, sshClient: Client): Promise<void> {
    if (this.hasSFTP(connectionId, sshClient)) {
      return
    }

    const pending = this.pendingSftpInitializations.get(connectionId)
    if (pending?.client === sshClient) {
      return pending.promise
    }

    // SSH automatic reconnect replaces its Client instance. A channel attached to
    // the previous client cannot service the new connection and must be recreated.
    if (this.hasSFTP(connectionId)) {
      this.closeSFTP(connectionId)
    }

    const generation = (this.sftpInitGenerations.get(connectionId) || 0) + 1
    this.sftpInitGenerations.set(connectionId, generation)

    const promise = new Promise<void>((resolve, reject) => {
      sshClient.sftp((err, sftp) => {
        if (err) {
          const appError = ErrorHandler.createSFTPError(`Failed to initialize SFTP: ${err.message}`)
          reject(appError)
          return
        }

        if (this.sftpInitGenerations.get(connectionId) !== generation) {
          try {
            sftp.end()
          } catch {}
          resolve()
          return
        }

        this.sftpClients.set(connectionId, sftp)
        this.sshClients.set(connectionId, sshClient)
        this.attachChannelListeners(connectionId, sftp)
        resolve()
      })
    })

    this.pendingSftpInitializations.set(connectionId, { client: sshClient, promise })
    try {
      await promise
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Init ${connectionId}`)
    } finally {
      const current = this.pendingSftpInitializations.get(connectionId)
      if (current?.client === sshClient) {
        this.pendingSftpInitializations.delete(connectionId)
      }
    }
  }

  /** 通道自身关闭或出错时，移除它并让其上的传输失败（未监听的 'error' 会使主进程崩溃） */
  private attachChannelListeners(connectionId: string, sftp: any): void {
    if (typeof sftp?.on !== 'function') return
    const onGone = () => {
      if (this.sftpClients.get(connectionId) === sftp) {
        this.closeSFTP(connectionId)
      }
    }
    sftp.on('close', onGone)
    sftp.on('end', onGone)
    sftp.on('error', (error: Error) => {
      console.error(`[SFTPManager] SFTP channel error on ${connectionId}:`, error?.message)
      onGone()
    })
  }

  hasSFTP(connectionId: string, sshClient?: Client): boolean {
    if (!this.sftpClients.has(connectionId)) {
      return false
    }

    return !sshClient || this.sshClients.get(connectionId) === sshClient
  }

  private requireSFTP(connectionId: string): any {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
    }
    return sftp
  }

  /** 注册通道关闭回调，返回注销函数 */
  private watchChannel(connectionId: string, onClosed: (error: Error) => void): () => void {
    let watchers = this.channelWatchers.get(connectionId)
    if (!watchers) {
      watchers = new Set()
      this.channelWatchers.set(connectionId, watchers)
    }
    watchers.add(onClosed)
    return () => {
      const current = this.channelWatchers.get(connectionId)
      current?.delete(onClosed)
      if (current && current.size === 0) {
        this.channelWatchers.delete(connectionId)
      }
    }
  }

  /**
   * 发起一个 SFTP 请求。通道关闭时立即失败（ssh2 在失效通道上的请求可能永不回调）。
   */
  private sftpRequest<T>(
    connectionId: string,
    label: string,
    run: (sftp: any, callback: (error: any, result?: T) => void) => void,
    timeoutMs = 0
  ): Promise<T> {
    const sftp = this.requireSFTP(connectionId)
    return new Promise<T>((resolve, reject) => {
      let done = false
      let timer: NodeJS.Timeout | undefined
      let unwatch: () => void = () => {}
      const finish = (error: any, result?: T) => {
        if (done) return
        done = true
        unwatch()
        if (timer) clearTimeout(timer)
        if (error) reject(error)
        else resolve(result as T)
      }
      unwatch = this.watchChannel(connectionId, (error) => finish(error))
      if (timeoutMs > 0) {
        timer = setTimeout(() => finish(new Error(`${label} 超时`)), timeoutMs)
      }
      try {
        run(sftp, (error, result) => finish(error, result))
      } catch (error) {
        finish(error)
      }
    })
  }

  private statRemote(connectionId: string, remotePath: string, timeoutMs = 0): Promise<any> {
    return this.sftpRequest(
      connectionId,
      `stat ${remotePath}`,
      (sftp, cb) => sftp.stat(remotePath, cb),
      timeoutMs
    )
  }

  /**
   * 关闭 SFTP 连接：当前通道上的请求、进行中与排队中的传输全部失败（记录保留为 failed，可续传）。
   */
  closeSFTP(connectionId: string, reason: string = SFTP_CONNECTION_LOST_MESSAGE): void {
    this.sftpInitGenerations.set(
      connectionId,
      (this.sftpInitGenerations.get(connectionId) || 0) + 1
    )
    const sftp = this.sftpClients.get(connectionId)
    this.sftpClients.delete(connectionId)
    this.sshClients.delete(connectionId)
    if (sftp) {
      try {
        sftp.end()
      } catch {}
    }

    const watchers = this.channelWatchers.get(connectionId)
    this.channelWatchers.delete(connectionId)
    if (watchers) {
      const error = new Error(reason)
      for (const watcher of watchers) {
        try {
          watcher(error)
        } catch (watcherError) {
          console.error('[SFTPManager] channel watcher failed:', watcherError)
        }
      }
    }

    for (const active of Array.from(this.activeTransfers.values())) {
      if (active.connectionId === connectionId) {
        active.settle({ kind: 'failed', message: reason }).catch(console.error)
      }
    }

    for (const waiter of this.slotQueue.filter((item) => item.connectionId === connectionId)) {
      this.evictWaiter(waiter.taskId, 'connection-lost')
    }
  }

  // ---------------------------------------------------------------------------
  // 全局并发限制
  // ---------------------------------------------------------------------------

  private getMaxConcurrentTransfers(): number {
    const configured = appSettingsManager.getSettings().sftp.maxConcurrentTransfers
    return Math.max(1, Math.min(configured || 3, 10))
  }

  private acquireSlot(taskId: string, connectionId: string): Promise<void> {
    if (this.slotQueue.length === 0 && this.runningSlots < this.getMaxConcurrentTransfers()) {
      this.runningSlots++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      this.slotQueue.push({ taskId, connectionId, resolve, reject })
    })
  }

  private releaseSlot(): void {
    this.runningSlots = Math.max(0, this.runningSlots - 1)
    this.pumpSlots()
  }

  private pumpSlots(): void {
    while (this.slotQueue.length > 0 && this.runningSlots < this.getMaxConcurrentTransfers()) {
      const waiter = this.slotQueue.shift()!
      this.runningSlots++
      waiter.resolve()
    }
  }

  private evictWaiter(taskId: string, reason: SlotEvictedError['reason']): boolean {
    const index = this.slotQueue.findIndex((waiter) => waiter.taskId === taskId)
    if (index < 0) return false
    const [waiter] = this.slotQueue.splice(index, 1)
    waiter.reject(new SlotEvictedError(taskId, reason))
    return true
  }

  /** 正在排队等待并发名额的任务 ID */
  getQueuedTaskIds(): string[] {
    return this.slotQueue.map((waiter) => waiter.taskId)
  }

  // ---------------------------------------------------------------------------
  // 待生效的暂停/取消
  // ---------------------------------------------------------------------------

  private prunePendingRequests(): void {
    const expiry = Date.now() - PENDING_REQUEST_TTL_MS
    for (const map of [this.pendingCancels, this.pendingPauses]) {
      for (const [taskId, time] of map) {
        if (time < expiry) map.delete(taskId)
      }
    }
  }

  private markPending(map: Map<string, number>, taskId: string): void {
    this.prunePendingRequests()
    map.set(taskId, Date.now())
  }

  /** 任务开始前检查是否已被取消或暂停；是则抛出对应错误 */
  private async consumePendingBeforeStart(p: TransferParams): Promise<void> {
    const { taskId } = p
    if (this.pendingCancels.delete(taskId)) {
      this.pendingPauses.delete(taskId)
      const record = transferRecordManager.getRecord(taskId)
      if (record && record.status !== 'completed' && record.status !== 'cancelled') {
        await transferRecordManager.updateRecord(taskId, { status: 'cancelled' }).catch(console.error)
      }
      const task = this.transferTasks.get(taskId)
      if (task) task.status = 'cancelled'
      this.emitTransfer('cancelled', taskId)
      throw new TransferCancelledError(taskId)
    }

    if (this.pendingPauses.delete(taskId)) {
      await this.ensureRecordWithStatus(p, 'paused')
      const task = this.transferTasks.get(taskId)
      if (task) task.status = 'paused'
      this.emitTransfer('paused', taskId)
      throw new TransferPausedError(taskId)
    }
  }

  /** 为尚未开始的任务写入指定状态的记录（以便之后 resumeTask 能找到它） */
  private async ensureRecordWithStatus(
    p: TransferParams,
    status: TransferRecord['status']
  ): Promise<void> {
    const record = transferRecordManager.getRecord(p.taskId)
    if (record) {
      await transferRecordManager.updateRecord(p.taskId, { status }).catch(console.error)
      return
    }

    let totalSize = 0
    if (p.kind === 'upload') {
      totalSize = await fs.promises
        .stat(p.localPath)
        .then((stats) => stats.size)
        .catch(() => 0)
    }
    await transferRecordManager
      .createRecord({
        id: p.taskId,
        type: p.kind,
        localPath: p.localPath,
        remotePath: p.remotePath,
        totalSize,
        transferred: 0,
        status,
        connectionId: p.connectionId
      })
      .catch(console.error)
  }

  private emitTransfer(event: string, taskId: string, ...args: any[]): void {
    if (this.ephemeralTasks.has(taskId)) return
    this.emit(event, taskId, ...args)
  }

  private reportError(taskId: string, error: Error): Error {
    if (!reportedTransferErrors.has(error)) {
      reportedTransferErrors.add(error)
      this.emitTransfer('error', taskId, error.message)
    }
    return error
  }

  private scheduleTaskCleanup(taskId: string): void {
    const previous = this.finishedTaskTimers.get(taskId)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.finishedTaskTimers.delete(taskId)
      const task = this.transferTasks.get(taskId)
      if (task && task.status !== 'active' && !this.activeTransfers.has(taskId)) {
        this.transferTasks.delete(taskId)
      }
    }, FINISHED_TASK_RETENTION_MS)
    timer.unref?.()
    this.finishedTaskTimers.set(taskId, timer)
  }

  // ---------------------------------------------------------------------------
  // 目录与文件信息
  // ---------------------------------------------------------------------------

  async getFileSize(connectionId: string, filePath: string): Promise<number> {
    try {
      const stats = await this.statRemote(connectionId, filePath)
      return Number(stats.size) || 0
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Stat ${filePath}`)
    }
  }

  /**
   * 解析远程路径为绝对路径（支持 '.'、'~'、'~/xxx'）
   */
  async realpath(connectionId: string, remotePath: string): Promise<string> {
    const input = remotePath || '.'
    try {
      if (input === '~' || input.startsWith('~/')) {
        const home = await this.sftpRequest<string>(connectionId, 'realpath', (sftp, cb) =>
          sftp.realpath('.', cb)
        )
        return input === '~' ? home : joinRemotePath(home, input.slice(2))
      }
      return await this.sftpRequest<string>(connectionId, 'realpath', (sftp, cb) =>
        sftp.realpath(input, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Realpath ${remotePath}`)
    }
  }

  /**
   * 列出目录内容
   */
  async listDirectory(connectionId: string, dirPath: string): Promise<SFTPFileInfo[]> {
    let list: any[]
    try {
      list = await this.sftpRequest<any[]>(connectionId, `readdir ${dirPath}`, (sftp, cb) =>
        sftp.readdir(dirPath, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `List Directory ${dirPath}`)
    }

    const files: SFTPFileInfo[] = (list || []).map((item) => ({
      name: item.filename,
      type: this.getFileType(item.attrs.mode),
      size: item.attrs.size,
      modifyTime: new Date(item.attrs.mtime * 1000),
      accessTime: new Date(item.attrs.atime * 1000),
      permissions: item.attrs.mode & 0o777,
      specialBits: item.attrs.mode & 0o7000,
      owner: item.attrs.uid,
      group: item.attrs.gid
    }))

    // 解析符号链接目标类型（stat 会跟随链接）；断链或其它类型时不设置 targetType
    const symlinks = files.filter((file) => file.type === 'symlink')
    await this.mapLimit(symlinks, 8, async (file) => {
      try {
        const stats = await this.statRemote(
          connectionId,
          joinRemotePath(dirPath, file.name),
          10_000
        )
        const kind = this.getModeKind(stats?.mode)
        if (kind === 'directory' || kind === 'file') {
          file.targetType = kind
        }
      } catch {
        // 断链 / 无权限：忽略
      }
    })

    return files
  }

  private async mapLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let nextIndex = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        await worker(items[currentIndex])
      }
    })
    await Promise.all(runners)
  }

  // ---------------------------------------------------------------------------
  // 传输
  // ---------------------------------------------------------------------------

  /**
   * 上传文件（支持断点续传）
   */
  async uploadFile(
    connectionId: string,
    localPath: string,
    remotePath: string,
    taskId: string,
    onProgress?: (progress: TransferProgress) => void,
    resumable: boolean = true,
    resumeFromExisting: boolean = false,
    options: TransferRunOptions = {}
  ): Promise<void> {
    return this.runTransfer({
      kind: 'upload',
      connectionId,
      localPath,
      remotePath,
      taskId,
      onProgress,
      resumable,
      resumeFromExisting,
      options
    })
  }

  /**
   * 下载文件（支持断点续传）
   */
  async downloadFile(
    connectionId: string,
    remotePath: string,
    localPath: string,
    taskId: string,
    onProgress?: (progress: TransferProgress) => void,
    resumable: boolean = true,
    resumeFromExisting: boolean = false,
    options: TransferRunOptions = {}
  ): Promise<void> {
    return this.runTransfer({
      kind: 'download',
      connectionId,
      localPath,
      remotePath,
      taskId,
      onProgress,
      resumable,
      resumeFromExisting,
      options
    })
  }

  /**
   * 所有传输的统一入口：登记 → 等待并发名额 → 准备（stat / 记录）→ 流式传输。
   * 任一阶段都会响应暂停/取消/连接断开。
   */
  private async runTransfer(p: TransferParams): Promise<void> {
    const { taskId } = p
    if (this.activeTransfers.has(taskId) || this.preparingTasks.has(taskId)) {
      throw new Error(`传输任务正在进行中：${taskId}`)
    }

    this.preparingTasks.set(taskId, p.connectionId)
    if (p.options.ephemeral) this.ephemeralTasks.add(taskId)
    let holdsSlot = false
    try {
      await transferRecordManager.initialize()
      await this.consumePendingBeforeStart(p)

      if (!p.options.skipQueue) {
        try {
          await this.acquireSlot(taskId, p.connectionId)
          holdsSlot = true
        } catch (error) {
          if (error instanceof SlotEvictedError) {
            await this.consumePendingBeforeStart(p)
            if (error.reason === 'connection-lost') {
              await this.ensureRecordWithStatus(p, 'failed')
              throw new Error(SFTP_CONNECTION_LOST_MESSAGE)
            }
          }
          throw error
        }
      }

      await this.consumePendingBeforeStart(p)
      if (p.kind === 'upload') {
        await this.executeUpload(p)
      } else {
        await this.executeDownload(p)
      }
    } catch (error: any) {
      if (isTransferInterruption(error)) throw error
      const normalized: Error = error instanceof Error ? error : new Error(String(error))
      if (!isReportedTransferError(normalized)) {
        // 准备阶段失败（stat 失败、连接断开等）：记录可续传状态并通知渲染进程
        const record = transferRecordManager.getRecord(taskId)
        if (record && !FINISHED_RECORD_STATUSES.has(record.status)) {
          await transferRecordManager.updateRecord(taskId, { status: 'failed' }).catch(console.error)
        }
        const task = this.transferTasks.get(taskId)
        if (task && task.status !== 'completed') {
          task.status = 'failed'
          task.error = normalized.message
        }
        this.reportError(taskId, normalized)
      }
      throw normalized
    } finally {
      if (this.preparingTasks.get(taskId) === p.connectionId) {
        this.preparingTasks.delete(taskId)
      }
      if (holdsSlot) this.releaseSlot()
      if (p.options.ephemeral) {
        this.ephemeralTasks.delete(taskId)
        await transferRecordManager.deleteRecord(taskId).catch(() => {})
      }
    }
  }

  /**
   * 计算续传起点。
   * - 只有显式 resumeFromExisting，或该任务已有可恢复记录且记录显示曾写入过数据时才续传；
   * - 目标比源大 → 从 0 开始；
   * - 源文件的修改时间晚于任务创建时间（源在传输开始后被修改过）→ 从 0 开始。
   *   注意下载时比较的是服务器 mtime 与本机时间，时钟偏差只会导致多传而不会导致错误拼接
   *   （服务器时钟偏快时会重新传输）。
   */
  private computeStartPosition(
    p: TransferParams,
    totalSize: number,
    sourceMtimeMs: number,
    destinationSize: number | null
  ): number {
    if (!p.resumable || destinationSize === null) return 0

    const record = transferRecordManager.getRecord(p.taskId)
    const resumingRecord = !!record && RESUMABLE_TRANSFER_STATUSES.has(record.status)
    if (!p.resumeFromExisting && !resumingRecord) return 0
    if (!p.resumeFromExisting && !((record?.transferred || 0) > 0)) return 0

    if (resumingRecord && record) {
      const createdAt = Date.parse(record.createdAt)
      if (Number.isFinite(createdAt) && Number.isFinite(sourceMtimeMs) && sourceMtimeMs > createdAt) {
        return 0
      }
    }

    if (destinationSize > totalSize) return 0
    return destinationSize
  }

  /** 创建或更新为 active 的记录 */
  private async activateRecord(
    p: TransferParams,
    totalSize: number,
    startPosition: number
  ): Promise<TransferRecord> {
    const existing = transferRecordManager.getRecord(p.taskId)
    if (!existing) {
      return transferRecordManager.createRecord({
        id: p.taskId,
        type: p.kind,
        localPath: p.localPath,
        remotePath: p.remotePath,
        totalSize,
        transferred: startPosition,
        status: 'active',
        connectionId: p.connectionId
      })
    }
    await transferRecordManager.updateRecord(p.taskId, {
      status: 'active',
      totalSize,
      transferred: startPosition
    })
    return transferRecordManager.getRecord(p.taskId) || existing
  }

  private async executeUpload(p: TransferParams): Promise<void> {
    const { connectionId, localPath, remotePath, taskId } = p
    const sftp = this.requireSFTP(connectionId)

    // 先确认源文件可用，再碰远端目标
    const localStats = await fs.promises.stat(localPath)
    if (localStats.isDirectory()) {
      const error: NodeJS.ErrnoException = new Error(`不支持上传文件夹：${localPath}`)
      error.code = 'EISDIR'
      throw error
    }
    const totalSize = localStats.size

    let remoteSize: number | null = null
    if (p.resumable && (p.resumeFromExisting || transferRecordManager.getRecord(taskId))) {
      remoteSize = await this.statRemote(connectionId, remotePath, 30_000)
        .then((stats) => Number(stats.size) || 0)
        .catch(() => null)
    }
    const startPosition = this.computeStartPosition(p, totalSize, localStats.mtimeMs, remoteSize)

    await this.consumePendingBeforeStart(p)
    const record = await this.activateRecord(p, totalSize, startPosition)
    await this.consumePendingBeforeStart(p)

    if (p.resumable && startPosition >= totalSize && totalSize > 0) {
      this.emitTransfer('started', taskId, record)
      await this.completeWithoutTransfer(p, totalSize)
      return
    }

    const task = this.registerTask(p, totalSize, startPosition)
    this.emitTransfer('started', taskId, record)

    if (!p.resumable) {
      return this._uploadWithFastPut(sftp, localPath, remotePath, taskId, task, totalSize, p)
    }

    return this.streamTransfer({
      p,
      task,
      totalSize,
      startPosition,
      createSource: () =>
        fs.createReadStream(localPath, { start: startPosition, highWaterMark: STREAM_CHUNK_SIZE }),
      createDestination: () =>
        sftp.createWriteStream(remotePath, {
          flags: startPosition > 0 ? 'a' : 'w',
          highWaterMark: STREAM_CHUNK_SIZE
        }),
      measureDestination: async () =>
        Number((await this.statRemote(connectionId, remotePath, 30_000)).size) || 0,
      deletePartial: () =>
        this.sftpRequest<void>(
          connectionId,
          `unlink ${remotePath}`,
          (channel, cb) => channel.unlink(remotePath, cb),
          10_000
        )
    })
  }

  private async executeDownload(p: TransferParams): Promise<void> {
    const { connectionId, localPath, remotePath, taskId } = p
    const sftp = this.requireSFTP(connectionId)

    const remoteStats = await this.statRemote(connectionId, remotePath, 30_000)
    if (this.getModeKind(remoteStats?.mode) === 'directory') {
      const error: NodeJS.ErrnoException = new Error(`不支持直接下载文件夹：${remotePath}`)
      error.code = 'EISDIR'
      throw error
    }
    const totalSize = Number(remoteStats.size) || 0

    let localSize: number | null = null
    if (p.resumable && (p.resumeFromExisting || transferRecordManager.getRecord(taskId))) {
      localSize = await fs.promises
        .stat(localPath)
        .then((stats) => (stats.isFile() ? stats.size : null))
        .catch(() => null)
    }
    const startPosition = this.computeStartPosition(
      p,
      totalSize,
      (Number(remoteStats.mtime) || 0) * 1000,
      localSize
    )

    await this.consumePendingBeforeStart(p)
    const record = await this.activateRecord(p, totalSize, startPosition)
    await this.consumePendingBeforeStart(p)

    if (p.resumable && startPosition >= totalSize && totalSize > 0) {
      this.emitTransfer('started', taskId, record)
      await this.completeWithoutTransfer(p, totalSize)
      return
    }

    const task = this.registerTask(p, totalSize, startPosition)
    this.emitTransfer('started', taskId, record)

    if (!p.resumable) {
      return this._downloadWithFastGet(sftp, remotePath, localPath, taskId, task, totalSize, p)
    }

    return this.streamTransfer({
      p,
      task,
      totalSize,
      startPosition,
      // 先打开远端源（等待 open），确认可读后才创建/截断本地文件
      createSource: () =>
        sftp.createReadStream(remotePath, {
          start: startPosition,
          highWaterMark: STREAM_CHUNK_SIZE
        }),
      createDestination: () =>
        fs.createWriteStream(localPath, {
          flags: startPosition > 0 ? 'a' : 'w',
          highWaterMark: STREAM_CHUNK_SIZE
        }),
      measureDestination: async () => (await fs.promises.stat(localPath)).size,
      deletePartial: () => fs.promises.unlink(localPath)
    })
  }

  private registerTask(p: TransferParams, totalSize: number, startPosition: number): TransferTask {
    const timer = this.finishedTaskTimers.get(p.taskId)
    if (timer) {
      clearTimeout(timer)
      this.finishedTaskTimers.delete(p.taskId)
    }
    const task: TransferTask = {
      id: p.taskId,
      type: p.kind,
      localPath: p.localPath,
      remotePath: p.remotePath,
      status: 'active',
      progress: this.createProgress(startPosition, totalSize, 0, 0)
    }
    this.transferTasks.set(p.taskId, task)
    this.preparingTasks.delete(p.taskId)
    return task
  }

  private async completeWithoutTransfer(p: TransferParams, totalSize: number): Promise<void> {
    await transferRecordManager
      .updateRecord(p.taskId, { status: 'completed', transferred: totalSize })
      .catch(console.error)
    this.emitTransfer('complete', p.taskId)
  }

  /**
   * 流式传输（断点续传、可暂停/取消）。
   * - 先等待源流 open，再创建目标流（避免源不可读时截断目标）；
   * - 任一端出错都销毁两端；
   * - 结算只发生一次；成功前校验目标大小必须等于源大小；
   * - 60 秒无数据视为超时。
   */
  private streamTransfer(ctx: {
    p: TransferParams
    task: TransferTask
    totalSize: number
    startPosition: number
    createSource: () => any
    createDestination: () => any
    measureDestination: () => Promise<number>
    deletePartial: () => Promise<void>
  }): Promise<void> {
    const { p, task, totalSize, startPosition } = ctx
    const { taskId, connectionId, onProgress } = p

    return new Promise<void>((resolve, reject) => {
      let settledPromise: Promise<void> | null = null
      let source: any = null
      let destination: any = null
      let transferred = startPosition
      let lastDataAt = Date.now()
      let lastRecordUpdate = Date.now()
      let finishFallback: NodeJS.Timeout | undefined
      const speedSample: RealtimeSpeedSample = {
        transferred: startPosition,
        time: Date.now(),
        speed: 0
      }

      const emitProgress = (force = false) => {
        const now = Date.now()
        const speed = this.updateRealtimeSpeedSample(
          speedSample,
          transferred,
          now,
          force || transferred >= totalSize
        )
        const remaining = totalSize - transferred
        const eta = speed > 0 ? remaining / speed : 0
        task.progress = this.createProgress(transferred, totalSize, speed, eta)
        if (onProgress) onProgress(task.progress)
        this.emitTransfer('progress', taskId, task.progress)
      }

      const progressInterval = setInterval(() => {
        if (settledPromise || task.status !== 'active') return
        const now = Date.now()
        if (now - lastDataAt >= this.stallTimeoutMs) {
          const seconds = Math.round(this.stallTimeoutMs / 1000)
          settle({ kind: 'failed', message: `传输超时（${seconds} 秒无数据）` }).catch(
            console.error
          )
          return
        }
        emitProgress()
        if (now - lastRecordUpdate >= 5000) {
          transferRecordManager
            .updateRecord(taskId, { transferred, status: 'active' })
            .catch(console.error)
          lastRecordUpdate = now
        }
      }, 500)

      const destroyStreams = () => {
        try {
          source?.unpipe?.(destination)
        } catch {}
        try {
          source?.destroy?.()
        } catch {}
        try {
          destination?.destroy?.()
        } catch {}
      }

      const waitClosed = (stream: any, timeoutMs: number): Promise<void> =>
        new Promise<void>((done) => {
          if (!stream || stream.closed || stream.isClosed) {
            done()
            return
          }
          const timer = setTimeout(done, timeoutMs)
          stream.once?.('close', () => {
            clearTimeout(timer)
            done()
          })
        })

      const active: ActiveTransfer = {
        taskId,
        connectionId,
        settle: (outcome) => settle(outcome)
      }
      this.activeTransfers.set(taskId, active)
      const unwatch = this.watchChannel(connectionId, (error) => {
        settle({ kind: 'failed', message: error.message }).catch(console.error)
      })

      const failWith = async (message: string) => {
        destroyStreams()
        task.status = 'failed'
        task.error = message
        await transferRecordManager
          .updateRecord(taskId, { status: 'failed', transferred })
          .catch(console.error)
        reject(this.reportError(taskId, new Error(message)))
      }

      const settle = (outcome: TransferOutcome): Promise<void> => {
        if (settledPromise) return settledPromise
        settledPromise = (async () => {
          clearInterval(progressInterval)
          if (finishFallback) clearTimeout(finishFallback)
          unwatch()
          if (this.activeTransfers.get(taskId) === active) {
            this.activeTransfers.delete(taskId)
          }

          try {
            if (outcome.kind === 'paused') {
              destroyStreams()
              task.status = 'paused'
              await transferRecordManager
                .updateRecord(taskId, { status: 'paused', transferred })
                .catch(console.error)
              this.emitTransfer('paused', taskId)
              reject(new TransferPausedError(taskId))
              return
            }

            if (outcome.kind === 'cancelled') {
              destroyStreams()
              task.status = 'cancelled'
              // 等两端流关闭后再删除不完整的目标文件
              await Promise.all([waitClosed(source, 3000), waitClosed(destination, 3000)])
              if (destination) {
                await withTimeout(ctx.deletePartial(), 10_000, '删除不完整文件超时').catch(
                  (error) => console.warn(`[SFTPManager] 删除不完整文件失败 ${taskId}:`, error?.message)
                )
              }
              await transferRecordManager
                .updateRecord(taskId, { status: 'cancelled', transferred })
                .catch(console.error)
              this.emitTransfer('cancelled', taskId)
              reject(new TransferCancelledError(taskId))
              return
            }

            if (outcome.kind === 'failed') {
              await failWith(outcome.message)
              return
            }

            // 成功候选：目标流提前关闭（例如 ssh2 吞掉了远端写入错误）时不会有 finish
            if (!destination?.writableFinished) {
              destroyStreams()
            }
            let written: number
            try {
              written = await withTimeout(ctx.measureDestination(), 30_000, '校验传输结果超时')
            } catch (error: any) {
              await failWith(`传输校验失败：${error?.message || error}`)
              return
            }
            if (written !== totalSize) {
              await failWith(`传输不完整：已写入 ${written} / ${totalSize} 字节`)
              return
            }

            transferred = totalSize
            emitProgress(true)
            task.status = 'completed'
            task.progress.percentage = 100
            task.progress.transferred = totalSize
            await transferRecordManager
              .updateRecord(taskId, { status: 'completed', transferred: totalSize })
              .catch(console.error)
            this.emitTransfer('complete', taskId)
            resolve()
          } finally {
            this.scheduleTaskCleanup(taskId)
          }
        })()
        return settledPromise
      }

      const onDestinationFinish = () => {
        // ssh2 写流在 finish 后还要异步关闭句柄；通道失效时 close 可能永不触发
        finishFallback = setTimeout(() => {
          settle({ kind: 'success' }).catch(console.error)
        }, 15_000)
      }

      try {
        source = ctx.createSource()
      } catch (error: any) {
        settle({ kind: 'failed', message: error?.message || String(error) }).catch(console.error)
        return
      }

      source.on('error', (error: Error) => {
        settle({ kind: 'failed', message: error?.message || '读取失败' }).catch(console.error)
      })

      source.once('open', () => {
        if (settledPromise) return
        lastDataAt = Date.now()
        try {
          destination = ctx.createDestination()
        } catch (error: any) {
          settle({ kind: 'failed', message: error?.message || String(error) }).catch(console.error)
          return
        }
        destination.on('error', (error: Error) => {
          settle({ kind: 'failed', message: error?.message || '写入失败' }).catch(console.error)
        })
        destination.on('finish', onDestinationFinish)
        destination.on('close', () => {
          settle({ kind: 'success' }).catch(console.error)
        })
        source.pipe(destination)
        source.on('data', (chunk: Buffer | string) => {
          transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
          lastDataAt = Date.now()
        })
      })
    })
  }

  /**
   * 并发上传（非续传模式）。吞吐优先，进度由服务端写入确认驱动；暂停/取消在回调时生效。
   */
  private _uploadWithFastPut(
    sftp: any,
    localPath: string,
    remotePath: string,
    taskId: string,
    task: TransferTask,
    totalSize: number,
    p: TransferParams
  ): Promise<void> {
    return this.fastTransfer(task, totalSize, p, (step, done) =>
      sftp.fastPut(
        localPath,
        remotePath,
        { concurrency: 64, chunkSize: 254 * 1024, step },
        done
      )
    , () => this.statRemote(p.connectionId, remotePath, 30_000).then((s) => Number(s.size) || 0), taskId)
  }

  private _downloadWithFastGet(
    sftp: any,
    remotePath: string,
    localPath: string,
    taskId: string,
    task: TransferTask,
    totalSize: number,
    p: TransferParams
  ): Promise<void> {
    return this.fastTransfer(task, totalSize, p, (step, done) =>
      sftp.fastGet(
        remotePath,
        localPath,
        { concurrency: 64, chunkSize: 256 * 1024, step },
        done
      )
    , async () => (await fs.promises.stat(localPath)).size, taskId)
  }

  private fastTransfer(
    task: TransferTask,
    totalSize: number,
    p: TransferParams,
    start: (
      step: (transferred: number, chunk: number, total: number) => void,
      done: (error: Error | null) => void
    ) => void,
    measureDestination: () => Promise<number>,
    taskId: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let lastRecordUpdate = Date.now()
      let lastProgressEmit = 0
      const speedSample: RealtimeSpeedSample = { transferred: 0, time: Date.now(), speed: 0 }
      let interruption: 'paused' | 'cancelled' | null = null

      const settle = async (outcome: TransferOutcome) => {
        if (settled) return
        settled = true
        unwatch()
        if (this.activeTransfers.get(taskId) === active) this.activeTransfers.delete(taskId)
        try {
          if (outcome.kind === 'paused' || outcome.kind === 'cancelled') {
            task.status = outcome.kind
            await transferRecordManager
              .updateRecord(taskId, { status: outcome.kind, transferred: task.progress.transferred })
              .catch(console.error)
            this.emitTransfer(outcome.kind, taskId)
            reject(
              outcome.kind === 'paused'
                ? new TransferPausedError(taskId)
                : new TransferCancelledError(taskId)
            )
            return
          }
          let message = outcome.kind === 'failed' ? outcome.message : ''
          if (!message) {
            const written = await withTimeout(measureDestination(), 30_000, '校验传输结果超时').catch(
              (error) => {
                message = `传输校验失败：${error?.message || error}`
                return -1
              }
            )
            if (!message && written !== totalSize) {
              message = `传输不完整：已写入 ${written} / ${totalSize} 字节`
            }
          }
          if (message) {
            task.status = 'failed'
            task.error = message
            await transferRecordManager
              .updateRecord(taskId, { status: 'failed', transferred: task.progress.transferred })
              .catch(console.error)
            reject(this.reportError(taskId, new Error(message)))
            return
          }
          task.status = 'completed'
          task.progress = this.createProgress(totalSize, totalSize, speedSample.speed, 0)
          this.emitTransfer('progress', taskId, task.progress)
          await transferRecordManager
            .updateRecord(taskId, { status: 'completed', transferred: totalSize })
            .catch(console.error)
          this.emitTransfer('complete', taskId)
          resolve()
        } finally {
          this.scheduleTaskCleanup(taskId)
        }
      }

      // fastPut/fastGet 无法中途中止：暂停/取消请求在其回调时生效
      const active: ActiveTransfer = {
        taskId,
        connectionId: p.connectionId,
        settle: async (outcome) => {
          if (outcome.kind === 'paused' || outcome.kind === 'cancelled') {
            interruption = outcome.kind
            task.status = outcome.kind
            return
          }
          await settle(outcome)
        }
      }
      this.activeTransfers.set(taskId, active)
      const unwatch = this.watchChannel(p.connectionId, (error) => {
        settle({ kind: 'failed', message: error.message }).catch(console.error)
      })

      start(
        (transferred, _chunk, total) => {
          const now = Date.now()
          const safeTotal = Number.isFinite(total) && total > 0 ? total : totalSize
          if (now - lastRecordUpdate >= 5000) {
            transferRecordManager
              .updateRecord(taskId, { transferred, status: 'active' })
              .catch(console.error)
            lastRecordUpdate = now
          }
          if (now - lastProgressEmit < 250 && transferred < safeTotal) return
          const speed = this.updateRealtimeSpeedSample(speedSample, transferred, now)
          const eta = speed > 0 ? (safeTotal - transferred) / speed : 0
          task.progress = this.createProgress(transferred, safeTotal, speed, eta)
          if (p.onProgress) p.onProgress(task.progress)
          this.emitTransfer('progress', taskId, task.progress)
          lastProgressEmit = now
        },
        (error) => {
          if (interruption) {
            settle({ kind: interruption }).catch(console.error)
          } else if (error) {
            settle({ kind: 'failed', message: error.message }).catch(console.error)
          } else {
            settle({ kind: 'success' }).catch(console.error)
          }
        }
      )
    })
  }

  /**
   * 获取传输任务
   */
  getTask(taskId: string): TransferTask | undefined {
    return this.transferTasks.get(taskId)
  }

  /**
   * 获取所有传输任务
   */
  getAllTasks(): TransferTask[] {
    return Array.from(this.transferTasks.values())
  }

  private isNotStarted(taskId: string): boolean {
    return (
      this.preparingTasks.has(taskId) || this.slotQueue.some((waiter) => waiter.taskId === taskId)
    )
  }

  /**
   * 取消传输任务
   * - 进行中：中断流并删除不完整的目标文件；
   * - 排队中 / 准备中 / 未知：登记为待取消，任务开始前生效；
   * - 已结束（完成 / 失败 / 已取消）：抛出“任务已结束”。
   */
  async cancelTask(taskId: string): Promise<void> {
    await transferRecordManager.initialize()
    const active = this.activeTransfers.get(taskId)
    if (active) {
      await active.settle({ kind: 'cancelled' })
      return
    }

    if (this.isNotStarted(taskId)) {
      this.markPending(this.pendingCancels, taskId)
      this.pendingPauses.delete(taskId)
      if (this.evictWaiter(taskId, 'interrupt')) {
        // 被移出队列的任务会在 runTransfer 中消费 pendingCancels 并发出 'cancelled'
      }
      return
    }

    const task = this.transferTasks.get(taskId)
    const record = transferRecordManager.getRecord(taskId)
    if (
      (task && ['completed', 'failed', 'cancelled'].includes(task.status) && !record) ||
      (record && FINISHED_RECORD_STATUSES.has(record.status))
    ) {
      throw new Error('任务已结束')
    }

    if (record) {
      // 已暂停（或上次运行遗留）的任务：标记为取消即可，保留已传部分不做删除
      if (task) task.status = 'cancelled'
      await transferRecordManager.updateRecord(taskId, { status: 'cancelled' }).catch(console.error)
      this.pendingPauses.delete(taskId)
      this.emitTransfer('cancelled', taskId)
      return
    }

    // 尚未登记的任务（例如 IPC 尚未到达）：开始前生效
    this.markPending(this.pendingCancels, taskId)
  }

  /**
   * 暂停传输任务（真正中断底层流）
   */
  async pauseTask(taskId: string): Promise<void> {
    await transferRecordManager.initialize()
    const active = this.activeTransfers.get(taskId)
    if (active) {
      const task = this.transferTasks.get(taskId)
      if (!task || task.status === 'active') {
        await active.settle({ kind: 'paused' })
      }
      return
    }

    if (this.isNotStarted(taskId)) {
      if (!this.pendingCancels.has(taskId)) {
        this.markPending(this.pendingPauses, taskId)
        this.evictWaiter(taskId, 'interrupt')
      }
      return
    }

    if (transferRecordManager.getRecord(taskId) || this.transferTasks.has(taskId)) {
      // 已暂停或已结束：无需处理
      return
    }

    this.markPending(this.pendingPauses, taskId)
  }

  /**
   * 校验任务能否在指定连接上恢复（同步失败时由调用方直接返回错误）
   */
  async validateResume(connectionId: string, taskId: string): Promise<'pending' | 'resume'> {
    await transferRecordManager.initialize()
    if (this.pendingPauses.has(taskId) && this.isNotStarted(taskId)) {
      return 'pending'
    }

    const record = transferRecordManager.getRecord(taskId)
    if (!record) {
      if (this.pendingPauses.has(taskId)) return 'pending'
      throw new Error(`Transfer record not found: ${taskId}`)
    }

    if (record.connectionId && record.connectionId !== connectionId) {
      throw new Error('该任务属于其它连接，请先连接原服务器')
    }

    if (!RESUMABLE_TRANSFER_STATUSES.has(record.status)) {
      throw new Error(`Transfer is not resumable: ${taskId}`)
    }

    if (this.activeTransfers.has(taskId) || this.isNotStarted(taskId)) {
      throw new Error(`Transfer is still active: ${taskId}`)
    }

    return 'resume'
  }

  /**
   * 恢复传输任务
   */
  async resumeTask(
    connectionId: string,
    taskId: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    const mode = await this.validateResume(connectionId, taskId)
    if (mode === 'pending') {
      // 任务尚未开始：撤销待生效的暂停，轮到它时会正常运行
      this.pendingPauses.delete(taskId)
      return
    }
    this.pendingPauses.delete(taskId)

    const record = transferRecordManager.getRecord(taskId)!
    try {
      if (record.type === 'upload') {
        await this.uploadFile(
          connectionId,
          record.localPath,
          record.remotePath,
          taskId,
          onProgress,
          true // 启用断点续传
        )
      } else {
        await this.downloadFile(
          connectionId,
          record.remotePath,
          record.localPath,
          taskId,
          onProgress,
          true // 启用断点续传
        )
      }
    } catch (error) {
      if (isTransferInterruption(error)) {
        return
      }
      throw error
    }
  }

  /**
   * 获取未完成的传输
   */
  getIncompleteTransfers(connectionId?: string): TransferRecord[] {
    const records = connectionId
      ? transferRecordManager.getIncompleteTransfersByConnection(connectionId)
      : transferRecordManager.getIncompleteTransfers()

    return records.filter((record) => {
      return !(
        record.status === 'active' &&
        (this.activeTransfers.has(record.id) || this.isNotStarted(record.id))
      )
    })
  }

  /**
   * 获取传输记录
   */
  getTransferRecord(taskId: string): TransferRecord | undefined {
    return transferRecordManager.getRecord(taskId)
  }

  /**
   * 获取所有传输记录
   */
  getAllTransferRecords(): TransferRecord[] {
    return transferRecordManager.getAllRecords()
  }

  /**
   * 删除传输记录
   */
  async deleteTransferRecord(taskId: string): Promise<void> {
    await transferRecordManager.deleteRecord(taskId)
  }

  /**
   * 清理已完成（及已取消）的传输记录
   */
  async cleanupCompletedRecords(): Promise<void> {
    await transferRecordManager.cleanupCompletedRecords()
  }

  // ---------------------------------------------------------------------------
  // 批量传输
  // ---------------------------------------------------------------------------

  /**
   * 批量上传文件（并发由全局限制器控制）
   */
  async uploadFiles(
    connectionId: string,
    files: UploadFileRequest[],
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<TransferBatchResults> {
    return this.runBatch(files, 'upload', (file, taskId) =>
      this.uploadFile(
        connectionId,
        file.localPath,
        file.remotePath,
        taskId,
        onProgress ? (progress) => onProgress(taskId, progress) : undefined,
        true,
        file.resumeFromExisting === true
      )
    )
  }

  /**
   * 批量下载文件（并发由全局限制器控制）
   */
  async downloadFiles(
    connectionId: string,
    files: DownloadFileRequest[],
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<TransferBatchResults> {
    return this.runBatch(files, 'download', (file, taskId) =>
      this.downloadFile(
        connectionId,
        file.remotePath,
        file.localPath,
        taskId,
        onProgress ? (progress) => onProgress(taskId, progress) : undefined,
        true,
        file.resumeFromExisting === true
      )
    )
  }

  private async runBatch<T extends { localPath: string; remotePath: string; taskId?: string }>(
    files: T[],
    kind: 'upload' | 'download',
    run: (file: T, taskId: string) => Promise<void>
  ): Promise<TransferBatchResults> {
    const results: TransferBatchResults = { success: [], failed: [], paused: [], cancelled: [] }
    await Promise.all(
      files.map(async (file) => {
        const reportPath = kind === 'upload' ? file.localPath : file.remotePath
        const taskId = file.taskId || `${kind}-${Date.now()}-${Math.random()}`
        try {
          await run(file, taskId)
          results.success.push(reportPath)
        } catch (error: any) {
          if (error instanceof TransferPausedError) {
            results.paused.push(reportPath)
            return
          }
          if (error instanceof TransferCancelledError) {
            results.cancelled.push(reportPath)
            return
          }
          results.failed.push({ path: reportPath, error: error?.message || String(error) })
        }
      })
    )
    return results
  }

  // ---------------------------------------------------------------------------
  // 文件操作
  // ---------------------------------------------------------------------------

  /**
   * 创建目录
   */
  async createDirectory(connectionId: string, dirPath: string): Promise<void> {
    try {
      await this.sftpRequest<void>(connectionId, `mkdir ${dirPath}`, (sftp, cb) =>
        sftp.mkdir(dirPath, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Create Directory ${dirPath}`)
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(connectionId: string, filePath: string): Promise<void> {
    try {
      await this.sftpRequest<void>(connectionId, `unlink ${filePath}`, (sftp, cb) =>
        sftp.unlink(filePath, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Delete File ${filePath}`)
    }
  }

  /**
   * 删除目录
   */
  async deleteDirectory(connectionId: string, dirPath: string): Promise<void> {
    try {
      await this.sftpRequest<void>(connectionId, `rmdir ${dirPath}`, (sftp, cb) =>
        sftp.rmdir(dirPath, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Delete Directory ${dirPath}`)
    }
  }

  /**
   * 重命名文件
   */
  async renameFile(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    try {
      await this.sftpRequest<void>(connectionId, `rename ${oldPath}`, (sftp, cb) =>
        sftp.rename(oldPath, newPath, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Rename File ${oldPath} to ${newPath}`)
    }
  }

  /**
   * 修改文件权限
   */
  async changePermissions(connectionId: string, filePath: string, mode: number): Promise<void> {
    try {
      await this.sftpRequest<void>(connectionId, `chmod ${filePath}`, (sftp, cb) =>
        sftp.chmod(filePath, mode, cb)
      )
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Change Permissions ${filePath}`)
    }
  }

  /**
   * 获取文件类型
   */
  private getFileType(mode: number): 'file' | 'directory' | 'symlink' {
    const kind = this.getModeKind(mode)
    return kind === 'other' ? 'file' : kind
  }

  private getModeKind(mode: number | undefined): 'file' | 'directory' | 'symlink' | 'other' {
    const S_IFMT = 0o170000
    const S_IFREG = 0o100000
    const S_IFDIR = 0o040000
    const S_IFLNK = 0o120000

    const type = (Number(mode) || 0) & S_IFMT

    if (type === S_IFREG) return 'file'
    if (type === S_IFDIR) return 'directory'
    if (type === S_IFLNK) return 'symlink'

    return 'other'
  }

  /**
   * 批量删除文件
   */
  async deleteFiles(
    connectionId: string,
    filePaths: string[]
  ): Promise<{ success: string[]; failed: Array<{ path: string; error: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>
    }

    for (const filePath of filePaths) {
      try {
        await this.deleteFile(connectionId, filePath)
        results.success.push(filePath)
      } catch (error: any) {
        results.failed.push({
          path: filePath,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * 批量删除目录
   */
  async deleteDirectories(
    connectionId: string,
    dirPaths: string[]
  ): Promise<{ success: string[]; failed: Array<{ path: string; error: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>
    }

    for (const dirPath of dirPaths) {
      try {
        // 递归删除目录内容
        await this.deleteDirectoryRecursive(connectionId, dirPath)
        results.success.push(dirPath)
      } catch (error: any) {
        results.failed.push({
          path: dirPath,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * 递归删除目录
   */
  private async deleteDirectoryRecursive(connectionId: string, dirPath: string): Promise<void> {
    this.requireSFTP(connectionId)

    // 列出目录内容
    const files = await this.listDirectory(connectionId, dirPath)

    // 删除所有文件和子目录（符号链接只删除链接本身，不跟随）
    for (const file of files) {
      const fullPath = joinRemotePath(dirPath, file.name)

      if (file.type === 'directory') {
        // 递归删除子目录
        await this.deleteDirectoryRecursive(connectionId, fullPath)
      } else {
        // 删除文件
        await this.deleteFile(connectionId, fullPath)
      }
    }

    // 删除空目录
    await this.deleteDirectory(connectionId, dirPath)
  }

  /**
   * 读取远程流到内存。maxBytes 为上限：truncate 为 true 时读满即止，否则超过上限报错。
   * 通道关闭时立即失败。
   */
  private collectRemoteFile(
    connectionId: string,
    filePath: string,
    options: { maxBytes?: number; truncate?: boolean } = {}
  ): Promise<Buffer> {
    const sftp = this.requireSFTP(connectionId)
    const { maxBytes, truncate = false } = options
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let totalBytes = 0
      let settled = false
      const streamOptions =
        truncate && maxBytes !== undefined ? { start: 0, end: Math.max(0, maxBytes - 1) } : undefined
      const readStream = streamOptions
        ? sftp.createReadStream(filePath, streamOptions)
        : sftp.createReadStream(filePath)

      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        unwatch()
        if (error) {
          try {
            readStream.destroy()
          } catch {}
          reject(error)
        } else {
          resolve(Buffer.concat(chunks))
        }
      }
      const unwatch = this.watchChannel(connectionId, (error) => finish(error))

      readStream.on('data', (chunk: Buffer | string) => {
        if (settled) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buffer.length
        if (maxBytes !== undefined && totalBytes > maxBytes) {
          if (truncate) {
            chunks.push(buffer.subarray(0, buffer.length - (totalBytes - maxBytes)))
            finish(null)
            try {
              readStream.destroy()
            } catch {}
            return
          }
          finish(new Error(`文件读取超过上限 ${maxBytes} 字节`))
          return
        }
        chunks.push(buffer)
      })
      readStream.on('end', () => finish(null))
      readStream.on('error', (error: Error) => finish(error))
    })
  }

  /**
   * 读取文件内容（文本）
   */
  async readFile(connectionId: string, filePath: string): Promise<string> {
    try {
      return (await this.collectRemoteFile(connectionId, filePath)).toString('utf-8')
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Read File ${filePath}`)
    }
  }

  /**
   * 读取有大小上限的文本文件，避免远端文件在读取期间增长导致内存占用失控。
   */
  async readFileLimited(connectionId: string, filePath: string, maxBytes: number): Promise<string> {
    try {
      return (await this.collectRemoteFile(connectionId, filePath, { maxBytes })).toString('utf-8')
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Read Limited File ${filePath}`)
    }
  }

  /**
   * 预览文件开头：至多读取 maxBytes 字节（上限 10 MB），文件更大时截断而不是报错。
   */
  async readFilePreview(
    connectionId: string,
    filePath: string,
    maxBytes: number
  ): Promise<{ data: string; truncated: boolean; size: number }> {
    const requested = Math.floor(Number(maxBytes))
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 64 * 1024, PREVIEW_MAX_BYTES))
    try {
      const stats = await this.statRemote(connectionId, filePath, 30_000)
      if (this.getModeKind(stats?.mode) === 'directory') {
        throw new Error('不能预览文件夹')
      }
      const size = Number(stats?.size) || 0
      const buffer = await this.collectRemoteFile(connectionId, filePath, {
        maxBytes: limit,
        truncate: true
      })
      const truncated = size > buffer.length && buffer.length >= limit
      const content = truncated ? trimIncompleteUtf8(buffer) : buffer
      return { data: content.toString('utf-8'), truncated, size }
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Read File Preview ${filePath}`)
    }
  }

  /**
   * 读取文件内容（二进制）
   */
  async readFileBuffer(connectionId: string, filePath: string): Promise<Buffer> {
    try {
      return await this.collectRemoteFile(connectionId, filePath)
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Read File Buffer ${filePath}`)
    }
  }

  /**
   * 写入远程文件；校验写入字节数（ssh2 写流出错时可能只关闭而不报错）。
   */
  private writeRemote(
    connectionId: string,
    filePath: string,
    content?: Buffer,
    signal?: AbortSignal
  ): Promise<void> {
    const sftp = this.requireSFTP(connectionId)
    return new Promise<void>((resolve, reject) => {
      let settled = false
      let unwatch: () => void = () => undefined
      let onAbort: (() => void) | undefined
      const writeStream = sftp.createWriteStream(filePath)
      const expected = content ? content.length : 0
      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        unwatch()
        if (onAbort) signal?.removeEventListener('abort', onAbort)
        if (error) {
          try {
            writeStream.destroy()
          } catch {}
          reject(error)
        } else {
          resolve()
        }
      }
      onAbort = () => finish(new Error('远程文件写入已取消'))
      unwatch = this.watchChannel(connectionId, (error) => finish(error))
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })

      writeStream.on('close', () => {
        const written = Number(writeStream.bytesWritten ?? expected)
        if (written !== expected) {
          finish(new Error(`写入不完整：已写入 ${written} / ${expected} 字节`))
        } else {
          finish(null)
        }
      })
      writeStream.on('error', (error: Error) => finish(error))

      if (content && content.length > 0) {
        writeStream.write(content)
      }
      writeStream.end()
    })
  }

  /**
   * 写入文件内容
   */
  async writeFile(
    connectionId: string,
    filePath: string,
    content: string,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      await this.writeRemote(connectionId, filePath, Buffer.from(content, 'utf-8'), signal)
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Write File ${filePath}`)
    }
  }

  /**
   * 创建空文件
   */
  async createFile(connectionId: string, filePath: string): Promise<void> {
    try {
      await this.writeRemote(connectionId, filePath)
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `Create File ${filePath}`)
    }
  }

  /**
   * 复制文件（通过读取和写入实现）
   */
  async copyFile(connectionId: string, sourcePath: string, targetPath: string): Promise<void> {
    try {
      const sftp = this.requireSFTP(connectionId)
      await new Promise<void>((resolve, reject) => {
        let settled = false
        let bytesRead = 0
        const readStream = sftp.createReadStream(sourcePath)
        let writeStream: any = null
        const finish = (error: Error | null) => {
          if (settled) return
          settled = true
          unwatch()
          if (error) {
            try {
              readStream.destroy()
            } catch {}
            try {
              writeStream?.destroy()
            } catch {}
            reject(error)
          } else {
            resolve()
          }
        }
        const unwatch = this.watchChannel(connectionId, (error) => finish(error))

        readStream.on('error', (error: Error) => finish(error))
        // 源可读后才创建（截断）目标
        readStream.once('open', () => {
          if (settled) return
          writeStream = sftp.createWriteStream(targetPath)
          writeStream.on('error', (error: Error) => finish(error))
          writeStream.on('close', () => {
            const written = Number(writeStream.bytesWritten ?? bytesRead)
            if (written !== bytesRead || !readStream.readableEnded) {
              finish(new Error(`复制不完整：已写入 ${written} / ${bytesRead} 字节`))
            } else {
              finish(null)
            }
          })
          readStream.on('data', (chunk: Buffer) => {
            bytesRead += chunk.length
          })
          readStream.pipe(writeStream)
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Copy File ${sourcePath} to ${targetPath}`)
    }
  }
}

// 导出单例实例
export const sftpManager = new SFTPManager()
