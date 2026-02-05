import { EventEmitter } from 'node:events'
import { Client } from 'ssh2'
import * as fs from 'fs'
import { transferRecordManager, type TransferRecord } from './TransferRecordManager'
import { ErrorHandler } from '../utils/error-handler'

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

/**
 * SFTPManager - 管理 SFTP 文件操作
 */
export class SFTPManager extends EventEmitter {
  private sftpClients: Map<string, any>
  private sshClients: Map<string, Client>
  private transferTasks: Map<string, TransferTask>

  constructor() {
    super()
    this.sftpClients = new Map()
    this.sshClients = new Map()
    this.transferTasks = new Map()
    
    // 初始化传输记录管理器
    transferRecordManager.initialize().catch(console.error)
  }

  /**
   * 初始化 SFTP 会话
   */
  async initSFTP(connectionId: string, sshClient: Client): Promise<void> {
    try {
      return new Promise((resolve, reject) => {
        sshClient.sftp((err, sftp) => {
          if (err) {
            const appError = ErrorHandler.createSFTPError(`Failed to initialize SFTP: ${err.message}`)
            reject(appError)
            return
          }

          this.sftpClients.set(connectionId, sftp)
          this.sshClients.set(connectionId, sshClient)
          resolve()
        })
      })
    } catch (error) {
      throw ErrorHandler.handle(error as Error, `SFTP Init ${connectionId}`)
    }
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
    resumable: boolean = true
  ): Promise<void> {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw new Error(`SFTP client not found for connection: ${connectionId}`)
    }

    // 获取文件大小
    const stats = fs.statSync(localPath)
    const totalSize = stats.size

    // 检查是否有未完成的传输记录
    let startPosition = 0
    let record = transferRecordManager.getRecord(taskId)

    if (resumable && record && record.status === 'paused') {
      // 验证远程文件是否存在
      try {
        const remoteStats: any = await new Promise((resolve, reject) => {
          sftp.stat(remotePath, (err: Error, stats: any) => {
            if (err) reject(err)
            else resolve(stats)
          })
        })
        
        // 从上次中断的位置继续
        startPosition = remoteStats.size
        
        // 验证文件大小是否匹配
        if (startPosition > totalSize) {
          // 远程文件比本地文件大，可能已损坏，重新上传
          startPosition = 0
        }
      } catch (error) {
        // 远程文件不存在，从头开始
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
    }

    // 创建传输任务
    const task: TransferTask = {
      id: taskId,
      type: 'upload',
      localPath,
      remotePath,
      status: 'active',
      progress: {
        transferred: startPosition,
        total: totalSize,
        percentage: (startPosition / totalSize) * 100,
        speed: 0,
        eta: 0
      }
    }
    this.transferTasks.set(taskId, task)

    return new Promise((resolve, reject) => {
      // 创建读取流，从指定位置开始
      const readStream = fs.createReadStream(localPath, { start: startPosition })
      
      // 创建写入流，追加模式
      const writeStream = startPosition > 0
        ? sftp.createWriteStream(remotePath, { flags: 'a' })
        : sftp.createWriteStream(remotePath)

      let transferred = startPosition
      let lastTransferred = startPosition
      let lastTime = Date.now()

      const progressInterval = setInterval(() => {
        const now = Date.now()
        const timeDiff = (now - lastTime) / 1000
        const bytesDiff = transferred - lastTransferred

        const speed = bytesDiff / timeDiff
        const remaining = totalSize - transferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = {
          transferred,
          total: totalSize,
          percentage: (transferred / totalSize) * 100,
          speed,
          eta
        }

        if (onProgress) {
          onProgress(task.progress)
        }

        this.emit('progress', taskId, task.progress)

        // 更新传输记录
        transferRecordManager.updateRecord(taskId, {
          transferred,
          status: 'active'
        }).catch(console.error)

        lastTransferred = transferred
        lastTime = now
      }, 500)

      readStream.on('data', (chunk: Buffer | string) => {
        transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      })

      writeStream.on('close', async () => {
        clearInterval(progressInterval)
        task.status = 'completed'
        task.progress.percentage = 100
        
        // 更新记录为已完成
        await transferRecordManager.updateRecord(taskId, {
          status: 'completed',
          transferred: totalSize
        })
        
        this.emit('complete', taskId)
        resolve()
      })

      writeStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        task.status = 'failed'
        task.error = err.message
        
        // 更新记录为失败
        await transferRecordManager.updateRecord(taskId, {
          status: 'failed',
          transferred
        })
        
        this.emit('error', taskId, err.message)
        reject(err)
      })

      readStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        task.status = 'failed'
        task.error = err.message
        
        await transferRecordManager.updateRecord(taskId, {
          status: 'failed',
          transferred
        })
        
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
    resumable: boolean = true
  ): Promise<void> {
    const sftp = this.sftpClients.get(connectionId)
    if (!sftp) {
      throw new Error(`SFTP client not found for connection: ${connectionId}`)
    }

    // 获取远程文件大小
    const stats: any = await new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err: Error, stats: any) => {
        if (err) reject(err)
        else resolve(stats)
      })
    })

    const totalSize = stats.size

    // 检查是否有未完成的传输记录
    let startPosition = 0
    let record = transferRecordManager.getRecord(taskId)

    if (resumable && record && record.status === 'paused') {
      // 检查本地文件是否存在
      if (fs.existsSync(localPath)) {
        const localStats = fs.statSync(localPath)
        startPosition = localStats.size
        
        // 验证文件大小
        if (startPosition > totalSize) {
          // 本地文件比远程文件大，可能已损坏，重新下载
          startPosition = 0
        }
      }
    }

    // 创建或更新传输记录
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
    }

    // 创建传输任务
    const task: TransferTask = {
      id: taskId,
      type: 'download',
      localPath,
      remotePath,
      status: 'active',
      progress: {
        transferred: startPosition,
        total: totalSize,
        percentage: (startPosition / totalSize) * 100,
        speed: 0,
        eta: 0
      }
    }
    this.transferTasks.set(taskId, task)

    return new Promise((resolve, reject) => {
      // 创建读取流，从指定位置开始
      const readStream = startPosition > 0
        ? sftp.createReadStream(remotePath, { start: startPosition })
        : sftp.createReadStream(remotePath)
      
      // 创建写入流，追加模式
      const writeStream = startPosition > 0
        ? fs.createWriteStream(localPath, { flags: 'a' })
        : fs.createWriteStream(localPath)

      let transferred = startPosition
      let lastTransferred = startPosition
      let lastTime = Date.now()

      const progressInterval = setInterval(() => {
        const now = Date.now()
        const timeDiff = (now - lastTime) / 1000
        const bytesDiff = transferred - lastTransferred

        const speed = bytesDiff / timeDiff
        const remaining = totalSize - transferred
        const eta = speed > 0 ? remaining / speed : 0

        task.progress = {
          transferred,
          total: totalSize,
          percentage: (transferred / totalSize) * 100,
          speed,
          eta
        }

        if (onProgress) {
          onProgress(task.progress)
        }

        this.emit('progress', taskId, task.progress)

        // 更新传输记录
        transferRecordManager.updateRecord(taskId, {
          transferred,
          status: 'active'
        }).catch(console.error)

        lastTransferred = transferred
        lastTime = now
      }, 500)

      readStream.on('data', (chunk: Buffer | string) => {
        transferred += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
      })

      writeStream.on('close', async () => {
        clearInterval(progressInterval)
        task.status = 'completed'
        task.progress.percentage = 100
        
        // 更新记录为已完成
        await transferRecordManager.updateRecord(taskId, {
          status: 'completed',
          transferred: totalSize
        })
        
        this.emit('complete', taskId)
        resolve()
      })

      writeStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        task.status = 'failed'
        task.error = err.message
        
        // 更新记录为失败
        await transferRecordManager.updateRecord(taskId, {
          status: 'failed',
          transferred
        })
        
        this.emit('error', taskId, err.message)
        reject(err)
      })

      readStream.on('error', async (err: Error) => {
        clearInterval(progressInterval)
        task.status = 'failed'
        task.error = err.message
        
        await transferRecordManager.updateRecord(taskId, {
          status: 'failed',
          transferred
        })
        
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
  async renameFile(
    connectionId: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
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
  async changePermissions(
    connectionId: string,
    filePath: string,
    mode: number
  ): Promise<void> {
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
  cancelTask(taskId: string): void {
    const task = this.transferTasks.get(taskId)
    if (task) {
      task.status = 'cancelled'
      this.emit('cancelled', taskId)
    }
  }

  /**
   * 暂停传输任务
   */
  async pauseTask(taskId: string): Promise<void> {
    const task = this.transferTasks.get(taskId)
    if (task && task.status === 'active') {
      task.status = 'paused'
      
      // 更新传输记录
      await transferRecordManager.updateRecord(taskId, {
        status: 'paused'
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

    if (record.status !== 'paused') {
      throw new Error(`Transfer is not paused: ${taskId}`)
    }

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
  }

  /**
   * 获取未完成的传输
   */
  getIncompleteTransfers(connectionId?: string): TransferRecord[] {
    if (connectionId) {
      return transferRecordManager.getIncompleteTransfersByConnection(connectionId)
    }
    return transferRecordManager.getIncompleteTransfers()
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
    files: Array<{ localPath: string; remotePath: string }>,
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<{ success: string[]; failed: Array<{ path: string; error: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>
    }

    for (const file of files) {
      const taskId = `upload-${Date.now()}-${Math.random()}`
      try {
        await this.uploadFile(
          connectionId, 
          file.localPath, 
          file.remotePath, 
          taskId, 
          onProgress ? (progress) => onProgress(taskId, progress) : undefined
        )
        results.success.push(file.localPath)
      } catch (error: any) {
        results.failed.push({
          path: file.localPath,
          error: error.message
        })
      }
    }

    return results
  }

  /**
   * 批量下载文件
   */
  async downloadFiles(
    connectionId: string,
    files: Array<{ remotePath: string; localPath: string }>,
    onProgress?: (taskId: string, progress: TransferProgress) => void
  ): Promise<{ success: string[]; failed: Array<{ path: string; error: string }> }> {
    const results = {
      success: [] as string[],
      failed: [] as Array<{ path: string; error: string }>
    }

    for (const file of files) {
      const taskId = `download-${Date.now()}-${Math.random()}`
      try {
        await this.downloadFile(
          connectionId, 
          file.remotePath, 
          file.localPath, 
          taskId, 
          onProgress ? (progress) => onProgress(taskId, progress) : undefined
        )
        results.success.push(file.remotePath)
      } catch (error: any) {
        results.failed.push({
          path: file.remotePath,
          error: error.message
        })
      }
    }

    return results
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
