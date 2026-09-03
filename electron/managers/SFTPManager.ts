import { EventEmitter } from 'node:events'
import { Client } from 'ssh2'
import * as fs from 'fs'
import { transferRecordManager, type TransferRecord } from './TransferRecordManager'
import { ErrorHandler } from '../utils/error-handler'
import { appSettingsManager } from '../utils/app-settings'

export interface SFTPFileInfo {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  modifyTime: Date
  accessTime: Date
  permissions: number
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

class TransferPausedError extends Error {
  constructor(public readonly taskId: string) {
    super(`Transfer paused: ${taskId}`)
    this.name = 'TransferPausedError'
  }
}

class TransferCancelledError extends Error {
  constructor(public readonly taskId: string) {
    super(`Transfer cancelled: ${taskId}`)
    this.name = 'TransferCancelledError'
  }
}

const RESUMABLE_TRANSFER_STATUSES = new Set<TransferRecord['status']>([
  'pending',
  'active',
  'paused',
  'failed'
])

/**
 * SFTPManager - 管理 SFTP 文件操作
 */
export class SFTPManager extends EventEmitter {
  private sftpClients: Map<string, any>
  private sshClients: Map<string, Client>
  private sftpInitGenerations: Map<string, number>
  private pendingSftpInitializations: Map<string, { client: Client; promise: Promise<void> }>
  private transferTasks: Map<string, TransferTask>
  // 暂停控制：存储每个任务的中止控制器，用于真正中断流传输
  private pauseControllers: Map<
    string,
    { paused: boolean; readStream?: fs.ReadStream; writeStream?: any }
  >

  constructor() {
    super()
    this.sftpClients = new Map()
    this.sshClients = new Map()
    this.sftpInitGenerations = new Map()
    this.pendingSftpInitializations = new Map()
    this.transferTasks = new Map()
    this.pauseControllers = new Map()

    // 初始化传输记录管理器
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
    }

    return sample.speed
  }

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

  hasSFTP(connectionId: string, sshClient?: Client): boolean {
    if (!this.sftpClients.has(connectionId)) {
      return false
    }

    return !sshClient || this.sshClients.get(connectionId) === sshClient
  }

  async getFileSize(connectionId: string, filePath: string): Promise<number> {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
    }

    return new Promise((resolve, reject) => {
      sftp.stat(filePath, (err: Error, stats: { size: number }) => {
        if (err) {
          reject(ErrorHandler.handle(err, `SFTP Stat ${filePath}`))
          return
        }
        resolve(Number(stats.size) || 0)
      })
    })
  }

  /**
   * 列出目录内容
   */
  async listDirectory(connectionId: string, dirPath: string): Promise<SFTPFileInfo[]> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.readdir(dirPath, (err: Error, list: any[]) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `List Directory ${dirPath}`)
            reject(appError)
            return
          }

          const files: SFTPFileInfo[] = list.map((item) => ({
            name: item.filename,
            type: this.getFileType(item.attrs.mode),
            size: item.attrs.size,
            modifyTime: new Date(item.attrs.mtime * 1000),
            accessTime: new Date(item.attrs.atime * 1000),
            permissions: item.attrs.mode & 0o777,
            owner: item.attrs.uid,
            group: item.attrs.gid
          }))

          resolve(files)
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP List Directory ${dirPath}`)
    }
  }

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
    resumeFromExisting: boolean = false
  ): Promise<void> {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw new Error(`SFTP client not found for connection: ${connectionId}`)
    }

    const stats = fs.statSync(localPath)
    const totalSize = stats.size

    // 检查是否有未完成的传输记录
    let startPosition = 0
    let record = transferRecordManager.getRecord(taskId)

    if (
      resumable &&
      (resumeFromExisting || (record && RESUMABLE_TRANSFER_STATUSES.has(record.status)))
    ) {
      try {
        const remoteStats: any = await new Promise((resolve, reject) => {
          sftp.stat(remotePath, (err: Error, stats: any) => {
            if (err) reject(err)
            else resolve(stats)
          })
        })
        startPosition = remoteStats.size
        if (startPosition > totalSize) {
          startPosition = 0
        }
      } catch (error) {
        startPosition = 0
      }
    }

    // 创建或更新传输记录
    if (!record) {
      record = await transferRecordManager.createRecord({
        id: taskId,
        type: 'upload',
        localPath,
        remotePath,
        totalSize,
        transferred: startPosition,
        status: 'active',
        connectionId
      })
    } else {
      await transferRecordManager.updateRecord(taskId, {
        status: 'active',
        transferred: startPosition
      })
      record = transferRecordManager.getRecord(taskId) || record
    }

    this.emit('started', taskId, record)

    if (resumable && record && startPosition >= totalSize && totalSize > 0) {
      await transferRecordManager
        .updateRecord(taskId, { status: 'completed', transferred: totalSize })
        .catch(console.error)
      this.emit('complete', taskId)
      return
    }

    const task: TransferTask = {
      id: taskId,
      type: 'upload',
      localPath,
      remotePath,
      status: 'active',
      progress: this.createProgress(startPosition, totalSize, 0, 0)
    }
    this.transferTasks.set(taskId, task)

    if (resumable) {
      return this._uploadWithStream(
        sftp,
        localPath,
        remotePath,
        taskId,
        task,
        totalSize,
        startPosition,
        onProgress
      )
    }

    return this._uploadWithFastPut(sftp, localPath, remotePath, taskId, task, totalSize, onProgress)
  }

  /**
   * 并发上传。用于新上传，吞吐优先，进度由服务端写入确认驱动。
   */
  private _uploadWithFastPut(
    sftp: any,
    localPath: string,
    remotePath: string,
    taskId: string,
    task: TransferTask,
    totalSize: number,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const PROGRESS_EVENT_INTERVAL_MS = 250
      const FAST_PUT_CONCURRENCY = 64
      const FAST_PUT_CHUNK_SIZE = 254 * 1024
      const speedSample: RealtimeSpeedSample = {
        transferred: 0,
        time: Date.now(),
        speed: 0
      }
      let lastProgressEmit = 0
      let lastRecordUpdate = Date.now()

      const updateProgress = (totalTransferred: number, total: number, force = false) => {
        const now = Date.now()
        const safeTotal = Number.isFinite(total) && total > 0 ? total : totalSize

        if (now - lastRecordUpdate >= 5000 || force) {
          transferRecordManager
            .updateRecord(taskId, {
              transferred: totalTransferred,
              status: 'active'
            })
            .catch(console.error)
          lastRecordUpdate = now
        }

        if (!force && now - lastProgressEmit < PROGRESS_EVENT_INTERVAL_MS) {
          return
        }

        const speed = this.updateRealtimeSpeedSample(
          speedSample,
          totalTransferred,
          now,
          force || totalTransferred >= safeTotal
        )
        const remaining = safeTotal - totalTransferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = this.createProgress(totalTransferred, safeTotal, speed, eta)
        if (onProgress) onProgress(task.progress)
        this.emit('progress', taskId, task.progress)
        lastProgressEmit = now
      }

      sftp.fastPut(
        localPath,
        remotePath,
        {
          concurrency: FAST_PUT_CONCURRENCY,
          chunkSize: FAST_PUT_CHUNK_SIZE,
          step: (totalTransferred: number, _chunk: number, total: number) => {
            updateProgress(totalTransferred, total || totalSize)
          }
        },
        async (err: Error | null) => {
          if (err) {
            task.status = 'failed'
            task.error = err.message
            await transferRecordManager
              .updateRecord(taskId, { status: 'failed', transferred: task.progress.transferred })
              .catch(console.error)
            this.emit('error', taskId, err.message)
            reject(err)
            return
          }

          updateProgress(totalSize, totalSize, true)
          task.status = 'completed'
          task.progress.percentage = 100
          task.progress.transferred = totalSize
          await transferRecordManager
            .updateRecord(taskId, { status: 'completed', transferred: totalSize })
            .catch(console.error)
          this.emit('complete', taskId)
          resolve()
        }
      )
    })
  }

  /**
   * 流式上传（用于断点续传）
   */
  private _uploadWithStream(
    sftp: any,
    localPath: string,
    remotePath: string,
    taskId: string,
    task: TransferTask,
    totalSize: number,
    startPosition: number,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const CHUNK_SIZE = 256 * 1024
      const readStream = fs.createReadStream(localPath, {
        start: startPosition,
        highWaterMark: CHUNK_SIZE
      })
      const writeStream = sftp.createWriteStream(remotePath, {
        flags: startPosition > 0 ? 'a' : 'w',
        highWaterMark: CHUNK_SIZE
      })

      // 注册流引用，供 pauseTask 使用
      const pauseController = { paused: false, readStream, writeStream }
      this.pauseControllers.set(taskId, pauseController)

      let transferred = startPosition
      let lastRecordUpdate = Date.now()
      const speedSample: RealtimeSpeedSample = {
        transferred: startPosition,
        time: Date.now(),
        speed: 0
      }

      const progressInterval = setInterval(() => {
        if (task.status !== 'active') {
          return
        }

        const now = Date.now()
        const speed = this.updateRealtimeSpeedSample(
          speedSample,
          transferred,
          now,
          transferred >= totalSize
        )
        const remaining = totalSize - transferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = this.createProgress(transferred, totalSize, speed, eta)
        if (onProgress) onProgress(task.progress)
        this.emit('progress', taskId, task.progress)

        if (now - lastRecordUpdate >= 5000) {
          transferRecordManager
            .updateRecord(taskId, { transferred, status: 'active' })
            .catch(console.error)
          lastRecordUpdate = now
        }
      }, 500)

      readStream.on('data', (chunk: Buffer | string) => {
        transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      })

      writeStream.on('close', async () => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        // 如果是暂停导致的关闭，不标记为完成
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'completed'
        task.progress.percentage = 100
        await transferRecordManager
          .updateRecord(taskId, { status: 'completed', transferred: totalSize })
          .catch(console.error)
        this.emit('complete', taskId)
        resolve()
      })

      writeStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'failed'
        task.error = err.message
        await transferRecordManager
          .updateRecord(taskId, { status: 'failed', transferred })
          .catch(console.error)
        this.emit('error', taskId, err.message)
        reject(err)
      })

      readStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'failed'
        task.error = err.message
        await transferRecordManager
          .updateRecord(taskId, { status: 'failed', transferred })
          .catch(console.error)
        reject(err)
      })

      readStream.pipe(writeStream)
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
    resumeFromExisting: boolean = false
  ): Promise<void> {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw new Error(`SFTP client not found for connection: ${connectionId}`)
    }

    const stats: any = await new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err: Error, stats: any) => {
        if (err) reject(err)
        else resolve(stats)
      })
    })
    const totalSize = stats.size

    let startPosition = 0
    let record = transferRecordManager.getRecord(taskId)

    if (
      resumable &&
      (resumeFromExisting || (record && RESUMABLE_TRANSFER_STATUSES.has(record.status)))
    ) {
      if (fs.existsSync(localPath)) {
        const localStats = fs.statSync(localPath)
        startPosition = localStats.size
        if (startPosition > totalSize) {
          startPosition = 0
        }
      }
    }

    if (!record) {
      record = await transferRecordManager.createRecord({
        id: taskId,
        type: 'download',
        localPath,
        remotePath,
        totalSize,
        transferred: startPosition,
        status: 'active',
        connectionId
      })
    } else {
      await transferRecordManager.updateRecord(taskId, {
        status: 'active',
        transferred: startPosition
      })
      record = transferRecordManager.getRecord(taskId) || record
    }

    this.emit('started', taskId, record)

    if (resumable && record && startPosition >= totalSize && totalSize > 0) {
      await transferRecordManager
        .updateRecord(taskId, { status: 'completed', transferred: totalSize })
        .catch(console.error)
      this.emit('complete', taskId)
      return
    }

    const task: TransferTask = {
      id: taskId,
      type: 'download',
      localPath,
      remotePath,
      status: 'active',
      progress: this.createProgress(startPosition, totalSize, 0, 0)
    }
    this.transferTasks.set(taskId, task)

    // 可恢复传输使用流式传输，这样暂停时可以真正中断底层流。
    if (resumable) {
      return this._downloadWithStream(
        sftp,
        remotePath,
        localPath,
        taskId,
        task,
        totalSize,
        startPosition,
        onProgress
      )
    }

    return new Promise((resolve, reject) => {
      let lastRecordUpdate = Date.now()
      const speedSample: RealtimeSpeedSample = {
        transferred: 0,
        time: Date.now(),
        speed: 0
      }

      const stepCb = (totalTransferred: number, _chunk: number, total: number) => {
        const now = Date.now()
        const speed = this.updateRealtimeSpeedSample(
          speedSample,
          totalTransferred,
          now,
          totalTransferred >= total
        )
        const remaining = total - totalTransferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = this.createProgress(totalTransferred, total, speed, eta)

        if (onProgress) onProgress(task.progress)
        this.emit('progress', taskId, task.progress)

        if (now - lastRecordUpdate >= 5000) {
          transferRecordManager
            .updateRecord(taskId, {
              transferred: totalTransferred,
              status: 'active'
            })
            .catch(console.error)
          lastRecordUpdate = now
        }
      }

      sftp.fastGet(
        remotePath,
        localPath,
        {
          concurrency: 64,
          chunkSize: 256 * 1024,
          step: stepCb
        },
        async (err: Error | null) => {
          if (err) {
            task.status = 'failed'
            task.error = err.message
            await transferRecordManager
              .updateRecord(taskId, { status: 'failed', transferred: task.progress.transferred })
              .catch(console.error)
            this.emit('error', taskId, err.message)
            reject(err)
            return
          }
          task.status = 'completed'
          task.progress.percentage = 100
          task.progress.transferred = totalSize
          await transferRecordManager
            .updateRecord(taskId, { status: 'completed', transferred: totalSize })
            .catch(console.error)
          this.emit('complete', taskId)
          resolve()
        }
      )
    })
  }

  /**
   * 流式下载（用于断点续传）
   */
  private _downloadWithStream(
    sftp: any,
    remotePath: string,
    localPath: string,
    taskId: string,
    task: TransferTask,
    totalSize: number,
    startPosition: number,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const CHUNK_SIZE = 256 * 1024
      const readStream = sftp.createReadStream(remotePath, {
        start: startPosition,
        highWaterMark: CHUNK_SIZE
      })
      const writeStream = fs.createWriteStream(localPath, {
        flags: startPosition > 0 ? 'a' : 'w',
        highWaterMark: CHUNK_SIZE
      })

      // 注册流引用，供 pauseTask 使用
      const pauseController = { paused: false, readStream, writeStream }
      this.pauseControllers.set(taskId, pauseController)

      let transferred = startPosition
      let lastRecordUpdate = Date.now()
      const speedSample: RealtimeSpeedSample = {
        transferred: startPosition,
        time: Date.now(),
        speed: 0
      }

      const progressInterval = setInterval(() => {
        if (task.status !== 'active') {
          return
        }

        const now = Date.now()
        const speed = this.updateRealtimeSpeedSample(
          speedSample,
          transferred,
          now,
          transferred >= totalSize
        )
        const remaining = totalSize - transferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = this.createProgress(transferred, totalSize, speed, eta)
        if (onProgress) onProgress(task.progress)
        this.emit('progress', taskId, task.progress)

        if (now - lastRecordUpdate >= 5000) {
          transferRecordManager
            .updateRecord(taskId, { transferred, status: 'active' })
            .catch(console.error)
          lastRecordUpdate = now
        }
      }, 500)

      readStream.on('data', (chunk: Buffer | string) => {
        transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      })

      writeStream.on('close', async () => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'completed'
        task.progress.percentage = 100
        await transferRecordManager
          .updateRecord(taskId, { status: 'completed', transferred: totalSize })
          .catch(console.error)
        this.emit('complete', taskId)
        resolve()
      })

      writeStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'failed'
        task.error = err.message
        await transferRecordManager
          .updateRecord(taskId, { status: 'failed', transferred })
          .catch(console.error)
        this.emit('error', taskId, err.message)
        reject(err)
      })

      readStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        if (this.pauseControllers.get(taskId) === pauseController) {
          this.pauseControllers.delete(taskId)
        }
        if (task.status === 'paused') {
          reject(new TransferPausedError(taskId))
          return
        }
        if (task.status === 'cancelled') {
          reject(new TransferCancelledError(taskId))
          return
        }
        task.status = 'failed'
        task.error = err.message
        await transferRecordManager
          .updateRecord(taskId, { status: 'failed', transferred })
          .catch(console.error)
        reject(err)
      })

      readStream.pipe(writeStream)
    })
  }

  /**
   * 创建目录
   */
  async createDirectory(connectionId: string, dirPath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.mkdir(dirPath, (err: Error) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `Create Directory ${dirPath}`)
            reject(appError)
          } else {
            resolve()
          }
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Create Directory ${dirPath}`)
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(connectionId: string, filePath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.unlink(filePath, (err: Error) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `Delete File ${filePath}`)
            reject(appError)
          } else {
            resolve()
          }
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Delete File ${filePath}`)
    }
  }

  /**
   * 删除目录
   */
  async deleteDirectory(connectionId: string, dirPath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.rmdir(dirPath, (err: Error) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `Delete Directory ${dirPath}`)
            reject(appError)
          } else {
            resolve()
          }
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Delete Directory ${dirPath}`)
    }
  }

  /**
   * 重命名文件
   */
  async renameFile(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.rename(oldPath, newPath, (err: Error) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `Rename File ${oldPath} to ${newPath}`)
            reject(appError)
          } else {
            resolve()
          }
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Rename File ${oldPath}`)
    }
  }

  /**
   * 修改文件权限
   */
  async changePermissions(connectionId: string, filePath: string, mode: number): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        sftp.chmod(filePath, mode, (err: Error) => {
          if (err) {
            const appError = ErrorHandler.handle(err, `Change Permissions ${filePath}`)
            reject(appError)
          } else {
            resolve()
          }
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Change Permissions ${filePath}`)
    }
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

  /**
   * 取消传输任务
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.transferTasks.get(taskId)
    if (task) {
      task.status = 'cancelled'
      const controller = this.pauseControllers.get(taskId)
      if (controller) {
        controller.readStream?.pause?.()
        controller.readStream?.unpipe?.()
        controller.readStream?.destroy?.()
        controller.writeStream?.destroy?.()
        this.pauseControllers.delete(taskId)
      }

      await transferRecordManager
        .updateRecord(taskId, {
          status: 'cancelled',
          transferred: task.progress.transferred
        })
        .catch(console.error)

      this.emit('cancelled', taskId)
    }
  }

  /**
   * 暂停传输任务（真正中断底层流）
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = this.transferTasks.get(taskId)
    if (task && task.status === 'active') {
      task.status = 'paused'

      // 真正暂停底层流
      const controller = this.pauseControllers.get(taskId)
      if (controller) {
        controller.paused = true
        if (controller.readStream) {
          controller.readStream.pause?.()
          controller.readStream.unpipe?.()
          controller.readStream.destroy?.()
        }
        // 销毁写入流，中断传输
        if (controller.writeStream) {
          controller.writeStream.destroy()
        }
      }

      // 更新传输记录
      await transferRecordManager.updateRecord(taskId, {
        status: 'paused',
        transferred: task.progress.transferred
      })

      this.emit('paused', taskId)
    }
  }

  /**
   * 恢复传输任务
   */
  async resumeTask(
    connectionId: string,
    taskId: string,
    onProgress?: (progress: TransferProgress) => void
  ): Promise<void> {
    const record = transferRecordManager.getRecord(taskId)
    if (!record) {
      throw new Error(`Transfer record not found: ${taskId}`)
    }

    if (!RESUMABLE_TRANSFER_STATUSES.has(record.status)) {
      throw new Error(`Transfer is not resumable: ${taskId}`)
    }

    const runningTask = this.transferTasks.get(taskId)
    if (record.status === 'active' && runningTask?.status === 'active') {
      throw new Error(`Transfer is still active: ${taskId}`)
    }

    try {
      // 根据类型恢复传输
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
      if (error instanceof TransferPausedError) {
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
      const runningTask = this.transferTasks.get(record.id)
      return !(record.status === 'active' && runningTask?.status === 'active')
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
   * 清理已完成的传输记录
   */
  async cleanupCompletedRecords(): Promise<void> {
    await transferRecordManager.cleanupCompletedRecords()
  }

  /**
   * 关闭 SFTP 连接
   */
  closeSFTP(connectionId: string): void {
    this.sftpInitGenerations.set(
      connectionId,
      (this.sftpInitGenerations.get(connectionId) || 0) + 1
    )
    const sftp = this.sftpClients.get(connectionId)
    if (sftp) {
      sftp.end()
      this.sftpClients.delete(connectionId)
    }
    this.sshClients.delete(connectionId)
  }

  /**
   * 获取文件类型
   */
  private getFileType(mode: number): 'file' | 'directory' | 'symlink' {
    const S_IFMT = 0o170000
    const S_IFREG = 0o100000
    const S_IFDIR = 0o040000
    const S_IFLNK = 0o120000

    const type = mode & S_IFMT

    if (type === S_IFREG) return 'file'
    if (type === S_IFDIR) return 'directory'
    if (type === S_IFLNK) return 'symlink'

    return 'file'
  }

  /**
   * 批量上传文件
   */
  async uploadFiles(
    connectionId: string,
    files: UploadFileRequest[],
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<{
    success: string[]
    failed: Array<{ path: string; error: string }>
    paused: string[]
  }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>,
      paused: [] as string[]
    }

    await this.runConcurrent(files, this.getMaxConcurrentTransfers(), async (file) => {
      const taskId = file.taskId || `upload-${Date.now()}-${Math.random()}`
      try {
        await this.uploadFile(
          connectionId,
          file.localPath,
          file.remotePath,
          taskId,
          onProgress ? (progress) => onProgress(taskId, progress) : undefined,
          true,
          file.resumeFromExisting === true
        )
        results.success.push(file.localPath)
      } catch (error: any) {
        if (error instanceof TransferPausedError) {
          results.paused.push(file.localPath)
          return
        }
        if (error instanceof TransferCancelledError) {
          return
        }
        results.failed.push({
          path: file.localPath,
          error: error.message
        })
      }
    })

    return results
  }

  /**
   * 批量下载文件
   */
  async downloadFiles(
    connectionId: string,
    files: DownloadFileRequest[],
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<{
    success: string[]
    failed: Array<{ path: string; error: string }>
    paused: string[]
  }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>,
      paused: [] as string[]
    }

    await this.runConcurrent(files, this.getMaxConcurrentTransfers(), async (file) => {
      const taskId = file.taskId || `download-${Date.now()}-${Math.random()}`
      try {
        await this.downloadFile(
          connectionId,
          file.remotePath,
          file.localPath,
          taskId,
          onProgress ? (progress) => onProgress(taskId, progress) : undefined,
          true,
          file.resumeFromExisting === true
        )
        results.success.push(file.remotePath)
      } catch (error: any) {
        if (error instanceof TransferPausedError) {
          results.paused.push(file.remotePath)
          return
        }
        if (error instanceof TransferCancelledError) {
          return
        }
        results.failed.push({
          path: file.remotePath,
          error: error.message
        })
      }
    })

    return results
  }

  private getMaxConcurrentTransfers(): number {
    const configured = appSettingsManager.getSettings().sftp.maxConcurrentTransfers
    return Math.max(1, Math.min(configured || 3, 10))
  }

  private async runConcurrent<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let nextIndex = 0
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++
        await worker(items[currentIndex])
      }
    })

    await Promise.all(workers)
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
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw new Error(`SFTP client not found for connection: ${connectionId}`)
    }

    // 列出目录内容
    const files = await this.listDirectory(connectionId, dirPath)

    // 删除所有文件和子目录
    for (const file of files) {
      const fullPath = `${dirPath}/${file.name}`

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
   * 读取文件内容（文本）
   */
  async readFile(connectionId: string, filePath: string): Promise<string> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(filePath)

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        readStream.on('end', () => {
          const buffer = Buffer.concat(chunks)
          resolve(buffer.toString('utf-8'))
        })

        readStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Read File ${filePath}`)
          reject(appError)
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Read File ${filePath}`)
    }
  }

  /**
   * 读取有大小上限的文本文件，避免远端文件在读取期间增长导致内存占用失控。
   */
  async readFileLimited(connectionId: string, filePath: string, maxBytes: number): Promise<string> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(filePath)
        let totalBytes = 0
        let settled = false

        const fail = (error: Error) => {
          if (settled) return
          settled = true
          try {
            readStream.destroy()
          } catch {}
          reject(error)
        }

        readStream.on('data', (chunk: Buffer) => {
          if (settled) return

          totalBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
          if (totalBytes > maxBytes) {
            fail(new Error(`文件读取超过上限 ${maxBytes} 字节`))
            return
          }

          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        readStream.on('end', () => {
          if (settled) return
          settled = true
          resolve(Buffer.concat(chunks).toString('utf-8'))
        })

        readStream.on('error', (err: Error) => {
          if (settled) return
          settled = true
          reject(ErrorHandler.handle(err, `Read Limited File ${filePath}`))
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Read Limited File ${filePath}`)
    }
  }

  /**
   * 读取文件内容（二进制）
   */
  async readFileBuffer(connectionId: string, filePath: string): Promise<Buffer> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(filePath)

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        readStream.on('end', () => {
          resolve(Buffer.concat(chunks))
        })

        readStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Read File Buffer ${filePath}`)
          reject(appError)
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Read File Buffer ${filePath}`)
    }
  }

  /**
   * 写入文件内容
   */
  async writeFile(connectionId: string, filePath: string, content: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const writeStream = sftp.createWriteStream(filePath)

        writeStream.on('close', () => {
          resolve()
        })

        writeStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Write File ${filePath}`)
          reject(appError)
        })

        writeStream.write(content, 'utf-8')
        writeStream.end()
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Write File ${filePath}`)
    }
  }

  /**
   * 创建空文件
   */
  async createFile(connectionId: string, filePath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const writeStream = sftp.createWriteStream(filePath)

        writeStream.on('close', () => {
          resolve()
        })

        writeStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Create File ${filePath}`)
          reject(appError)
        })

        writeStream.end()
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Create File ${filePath}`)
    }
  }

  /**
   * 复制文件（通过读取和写入实现）
   */
  async copyFile(connectionId: string, sourcePath: string, targetPath: string): Promise<void> {
    try {
      const sftp = this.sftpClients.get(connectionId)
      if (!sftp) {
        throw ErrorHandler.createSFTPError(`SFTP client not found for connection: ${connectionId}`)
      }

      return new Promise((resolve, reject) => {
        const readStream = sftp.createReadStream(sourcePath)
        const writeStream = sftp.createWriteStream(targetPath)

        readStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Copy File Read ${sourcePath}`)
          reject(appError)
        })

        writeStream.on('error', (err: Error) => {
          const appError = ErrorHandler.handle(err, `Copy File Write ${targetPath}`)
          reject(appError)
        })

        writeStream.on('close', () => {
          resolve()
        })

        readStream.pipe(writeStream)
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Copy File ${sourcePath} to ${targetPath}`)
    }
  }
}

// 导出单例实例
export const sftpManager = new SFTPManager()
