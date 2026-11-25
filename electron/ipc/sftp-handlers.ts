import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import { randomBytes } from 'crypto'
import {
  sftpManager,
  isReportedTransferError,
  TransferCancelledError,
  TransferPausedError
} from '../managers/SFTPManager'
import { HostKeyChallengeError, sshConnectionManager } from '../managers/SSHConnectionManager'
import { auditLogManager, AuditAction } from '../managers/AuditLogManager'
import { v4 as uuidv4 } from 'uuid'
import { AppError } from '../utils/error-handler'
import { prepareSSHConnectionOptions } from '../utils/ssh-connect-options'

export const CONNECTION_UNAVAILABLE_MESSAGE = '连接不存在或已断开'

/** 远程压缩/解压可能持续很久（大目录），只在极端情况下超时 */
export const REMOTE_ARCHIVE_TIMEOUT_MS = 2 * 60 * 60 * 1000
const REMOTE_ARCHIVE_MAX_OUTPUT_BYTES = 32 * 1024 * 1024
/** 远程命令用于表示“目标已存在”的退出码 */
const EXIT_TARGET_EXISTS = 17

class ConnectionUnavailableError extends Error {
  constructor() {
    super(CONNECTION_UNAVAILABLE_MESSAGE)
    this.name = 'ConnectionUnavailableError'
  }
}

/**
 * 标准化错误响应
 */
function handleError(error: any) {
  if (error instanceof HostKeyChallengeError) {
    return {
      success: false,
      error: error.message,
      userMessage:
        error.details.status === 'changed'
          ? '服务器主机指纹已变化，请确认是否信任新指纹'
          : '需要确认服务器主机指纹',
      code: error.code,
      details: error.details
    }
  }

  if (error instanceof ConnectionUnavailableError) {
    return { success: false, error: error.message, userMessage: error.message }
  }

  if (error instanceof AppError) {
    return {
      success: false,
      error: error.message,
      userMessage: error.userMessage,
      type: error.type,
      code: error.code,
      details: error.details
    }
  }
  return {
    success: false,
    error: error?.message || '未知错误',
    userMessage: '操作失败，请重试'
  }
}

/**
 * 确保该连接的 SFTP 通道属于当前 SSH Client（自动重连后会换 Client，需要重建通道）。
 */
async function ensureSFTP(connectionId: string): Promise<void> {
  const connection = sshConnectionManager.getConnection(connectionId)
  if (!connection || !connection.client || connection.status !== 'connected') {
    throw new ConnectionUnavailableError()
  }
  await sftpManager.initSFTP(connectionId, connection.client)
}

/** 本地目标文件名校验（纵深防御：防止写到盘符根、备用数据流或上级目录） */
export function validateLocalTargetPath(localPath: unknown): string | null {
  if (typeof localPath !== 'string' || !localPath.trim()) {
    return '本地路径无效'
  }
  const isWindows = process.platform === 'win32'
  const base = isWindows ? path.win32.basename(localPath) : path.posix.basename(localPath)
  if (!base || base === '.' || base === '..' || (isWindows && base.includes(':'))) {
    return `本地文件名无效：${base || localPath}`
  }
  return null
}

/** 拖曳临时文件名：去掉路径成分与 Windows 非法字符 */
export function sanitizeDragFileName(fileName: unknown): string | null {
  if (typeof fileName !== 'string') return null
  const flattened = fileName.replace(/[\\/]/g, '_')
  const base = path.basename(flattened).replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim()
  if (!base || base === '.' || base === '..' || /^\.+$/.test(base)) return null
  return base
}

/** 单引号包裹，并转义路径中的单引号（' -> '\''） */
export const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

function stripTrailingSlashes(remotePath: string): string {
  const stripped = remotePath.replace(/\/+$/, '')
  return stripped || '/'
}

/** 以 - 开头的文件名会被当成选项，加 ./ 前缀 */
function safeOperand(name: string): string {
  return shellQuote(name.startsWith('-') ? `./${name}` : name)
}

/**
 * 构造远程压缩命令。dirname/basename 在本地用 path.posix 计算后整体转义，
 * 避免 $(dirname ...) 这类未加引号的命令替换在空格、通配符时出错。
 * 压缩文件已存在时以退出码 17 结束。
 */
export function buildCompressCommand(sourcePaths: string[], archivePath: string): string {
  if (!sourcePaths.length || !archivePath) {
    throw new Error('参数不完整')
  }
  if (!archivePath.startsWith('/')) {
    throw new Error('压缩文件路径必须为绝对路径')
  }

  const normalized = sourcePaths.map((source) => stripTrailingSlashes(source))
  const parentDir = path.posix.dirname(normalized[0])
  const names = normalized.map((source) => {
    if (path.posix.dirname(source) !== parentDir) {
      throw new Error('只能压缩同一目录下的文件')
    }
    const base = path.posix.basename(source)
    if (!base || base === '/' || base === '.' || base === '..') {
      throw new Error(`无法压缩该路径：${source}`)
    }
    return safeOperand(base)
  })

  const archive = shellQuote(archivePath)
  const dir = shellQuote(parentDir)
  const operands = names.join(' ')
  const ext = archivePath.toLowerCase()
  let job: string
  if (ext.endsWith('.zip')) {
    job = `cd ${dir} && zip -rq ${archive} ${operands}`
  } else if (ext.endsWith('.tar.bz2')) {
    job = `tar -cjf ${archive} -C ${dir} ${operands}`
  } else if (ext.endsWith('.tar.xz')) {
    job = `tar -cJf ${archive} -C ${dir} ${operands}`
  } else if (ext.endsWith('.tar')) {
    job = `tar -cf ${archive} -C ${dir} ${operands}`
  } else {
    // .tar.gz / .tgz 以及其它扩展名默认使用 tar.gz
    job = `tar -czf ${archive} -C ${dir} ${operands}`
  }

  return `if [ -e ${archive} ] || [ -L ${archive} ]; then exit ${EXIT_TARGET_EXISTS}; fi; ${job}`
}

export type ExtractPlan = {
  command: string
  /** 单文件解压（.gz/.bz2/.xz）时的输出路径 */
  outputPath?: string
}

/**
 * 构造远程解压命令。
 * 单文件格式（.gz/.bz2/.xz）：扩展名不区分大小写地去除；输出路径等于压缩包或已存在时拒绝；
 * 先写入目标目录中的临时文件，成功后再 mv 到位，失败时删除临时文件。
 */
export function buildExtractCommand(
  archivePath: string,
  targetDir: string,
  tempSuffix: string = randomBytes(4).toString('hex')
): ExtractPlan {
  if (!archivePath || !targetDir) {
    throw new Error('参数不完整')
  }
  const archive = shellQuote(archivePath)
  const target = shellQuote(targetDir)
  const ext = archivePath.toLowerCase()

  if (ext.endsWith('.zip')) {
    return { command: `unzip -oq ${archive} -d ${target}` }
  }
  if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
    return { command: `tar -xzf ${archive} -C ${target}` }
  }
  if (ext.endsWith('.tar.bz2')) {
    return { command: `tar -xjf ${archive} -C ${target}` }
  }
  if (ext.endsWith('.tar.xz')) {
    return { command: `tar -xJf ${archive} -C ${target}` }
  }
  if (ext.endsWith('.tar')) {
    return { command: `tar -xf ${archive} -C ${target}` }
  }
  if (ext.endsWith('.rar')) {
    return { command: `unrar x -o+ -idq ${archive} ${shellQuote(targetDir.replace(/\/?$/, '/'))}` }
  }
  if (ext.endsWith('.7z')) {
    return { command: `7z x -aoa ${archive} -o${target}` }
  }

  const singleFileTools: Array<[RegExp, string]> = [
    [/\.gz$/i, 'gunzip'],
    [/\.bz2$/i, 'bunzip2'],
    [/\.xz$/i, 'unxz']
  ]
  const match = singleFileTools.find(([pattern]) => pattern.test(archivePath))
  if (!match) {
    throw new Error('不支持的压缩格式')
  }
  const [pattern, tool] = match
  const archiveBase = path.posix.basename(archivePath)
  const outputName = archiveBase.replace(pattern, '')
  if (!outputName || outputName === archiveBase || outputName === '.' || outputName === '..') {
    throw new Error('无法确定解压后的文件名')
  }
  const outputPath = path.posix.join(targetDir, outputName)
  if (outputPath === path.posix.normalize(archivePath)) {
    throw new Error(`解压目标文件已存在：${outputPath}`)
  }
  const output = shellQuote(outputPath)
  const temp = shellQuote(path.posix.join(targetDir, `.${outputName}.mshell-${tempSuffix}.part`))
  const command =
    `if [ -e ${output} ] || [ -L ${output} ]; then exit ${EXIT_TARGET_EXISTS}; fi; ` +
    `if ${tool} -c ${archive} > ${temp}; then mv -f -- ${temp} ${output}; ` +
    `else rc=$?; rm -f -- ${temp}; exit $rc; fi`
  return { command, outputPath }
}

/** 执行长时间的远程任务；非 0 退出码视为失败 */
async function runRemoteJob(
  connectionId: string,
  command: string,
  existsMessage: string
): Promise<void> {
  const result = await sshConnectionManager.executeCommandDetailed(
    connectionId,
    command,
    REMOTE_ARCHIVE_TIMEOUT_MS,
    REMOTE_ARCHIVE_MAX_OUTPUT_BYTES
  )
  if (result.exitCode === EXIT_TARGET_EXISTS) {
    throw new Error(existsMessage)
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-2000)
    throw new Error(
      `Command failed with code ${result.exitCode ?? result.signal ?? 'unknown'}: ${detail}`
    )
  }
}

function broadcast(channel: string, ...args: any[]) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, ...args)
  })
}

/** 单文件传输被暂停/取消时的结果（不是失败，不写失败审计） */
function interruptionResult(error: unknown, taskId: string) {
  if (error instanceof TransferPausedError) {
    return { success: false, taskId, paused: true, error: '传输已暂停' }
  }
  if (error instanceof TransferCancelledError) {
    return { success: false, taskId, cancelled: true, error: '传输已取消' }
  }
  return null
}

/**
 * 注册 SFTP IPC 处理器
 */
export function registerSFTPHandlers() {
  // SSH Client 关闭或被自动重连替换时，关闭依附其上的 SFTP 通道，
  // 让进行中的传输/请求立即失败（可续传），而不是永远挂起。
  sshConnectionManager.on('client-closed', (connectionId: string, client: any) => {
    if (sftpManager.hasSFTP(connectionId, client)) {
      sftpManager.closeSFTP(connectionId)
    }
  })

  // 建立独立的 SFTP 连接。
  // 文件传输不依赖终端窗口，但连接参数处理必须和终端 SSH 保持一致。
  ipcMain.handle('sftp:connect', async (_event, connectionId: string, options: any) => {
    try {
      const connectOptions = await prepareSSHConnectionOptions({ ...options, openShell: false })
      await sshConnectionManager.connect(connectionId, connectOptions)
      const connection = sshConnectionManager.getConnection(connectionId)
      if (!connection) {
        return { success: false, error: 'Connection not found', userMessage: '连接不存在' }
      }
      await sftpManager.initSFTP(connectionId, connection.client)
      return { success: true }
    } catch (error: any) {
      try {
        sftpManager.closeSFTP(connectionId)
        await sshConnectionManager.disconnect(connectionId)
      } catch {}
      return handleError(error)
    }
  })

  // 初始化 SFTP
  ipcMain.handle('sftp:init', async (_event, connectionId: string) => {
    try {
      const connection = sshConnectionManager.getConnection(connectionId)
      if (!connection) {
        return { success: false, error: 'Connection not found', userMessage: '连接不存在' }
      }
      if (connection.status !== 'connected') {
        return {
          success: false,
          error: 'Connection is not ready',
          userMessage: 'SSH 连接当前不可用'
        }
      }

      await sftpManager.initSFTP(connectionId, connection.client)
      return { success: true }
    } catch (error: any) {
      return handleError(error)
    }
  })

  // 列出目录
  ipcMain.handle('sftp:listDirectory', async (_event, connectionId: string, path: string) => {
    try {
      await ensureSFTP(connectionId)
      const files = await sftpManager.listDirectory(connectionId, path)
      return { success: true, files }
    } catch (error: any) {
      return handleError(error)
    }
  })

  // 解析远程路径（'.' 为家目录）
  ipcMain.handle('sftp:realpath', async (_event, connectionId: string, remotePath: string) => {
    try {
      await ensureSFTP(connectionId)
      const resolved = await sftpManager.realpath(connectionId, remotePath)
      return { success: true, path: resolved }
    } catch (error: any) {
      return handleError(error)
    }
  })

  // 上传文件
  ipcMain.handle(
    'sftp:uploadFile',
    async (
      _event,
      connectionId: string,
      localPath: string,
      remotePath: string,
      options?: { resumeFromExisting?: boolean; taskId?: string }
    ) => {
      const taskId = options?.taskId || uuidv4()
      try {
        await ensureSFTP(connectionId)
        await sftpManager.uploadFile(
          connectionId,
          localPath,
          remotePath,
          taskId,
          undefined,
          true,
          options?.resumeFromExisting === true
        )

        // 记录审计日志
        auditLogManager.log(AuditAction.FILE_UPLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: true
        })

        return { success: true, taskId }
      } catch (error: any) {
        const interrupted = interruptionResult(error, taskId)
        if (interrupted) return interrupted
        auditLogManager.log(AuditAction.FILE_UPLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: false,
          errorMessage: error.message
        })
        return { ...handleError(error), taskId }
      }
    }
  )

  // 下载文件
  ipcMain.handle(
    'sftp:downloadFile',
    async (
      _event,
      connectionId: string,
      remotePath: string,
      localPath: string,
      options?: { resumeFromExisting?: boolean; taskId?: string }
    ) => {
      const taskId = options?.taskId || uuidv4()
      try {
        const invalid = validateLocalTargetPath(localPath)
        if (invalid) {
          return { success: false, taskId, error: invalid, userMessage: invalid }
        }
        await ensureSFTP(connectionId)
        await sftpManager.downloadFile(
          connectionId,
          remotePath,
          localPath,
          taskId,
          undefined,
          true,
          options?.resumeFromExisting === true
        )

        // 记录审计日志
        auditLogManager.log(AuditAction.FILE_DOWNLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: true
        })

        return { success: true, taskId }
      } catch (error: any) {
        const interrupted = interruptionResult(error, taskId)
        if (interrupted) return interrupted
        auditLogManager.log(AuditAction.FILE_DOWNLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: false,
          errorMessage: error.message
        })
        return { ...handleError(error), taskId }
      }
    }
  )

  // 创建目录
  ipcMain.handle('sftp:createDirectory', async (_event, connectionId: string, path: string) => {
    try {
      await ensureSFTP(connectionId)
      await sftpManager.createDirectory(connectionId, path)
      return { success: true }
    } catch (error: any) {
      return handleError(error)
    }
  })

  // 删除文件
  ipcMain.handle('sftp:deleteFile', async (_event, connectionId: string, path: string) => {
    try {
      await ensureSFTP(connectionId)
      await sftpManager.deleteFile(connectionId, path)

      // 记录审计日志
      auditLogManager.log(AuditAction.FILE_DELETE, {
        sessionId: connectionId,
        resource: path,
        success: true
      })

      return { success: true }
    } catch (error: any) {
      auditLogManager.log(AuditAction.FILE_DELETE, {
        sessionId: connectionId,
        resource: path,
        success: false,
        errorMessage: error.message
      })
      return handleError(error)
    }
  })

  // 重命名文件
  ipcMain.handle(
    'sftp:renameFile',
    async (_event, connectionId: string, oldPath: string, newPath: string) => {
      try {
        await ensureSFTP(connectionId)
        await sftpManager.renameFile(connectionId, oldPath, newPath)

        // 记录审计日志
        auditLogManager.log(AuditAction.FILE_RENAME, {
          sessionId: connectionId,
          resource: oldPath,
          details: { oldPath, newPath },
          success: true
        })

        return { success: true }
      } catch (error: any) {
        auditLogManager.log(AuditAction.FILE_RENAME, {
          sessionId: connectionId,
          resource: oldPath,
          details: { oldPath, newPath },
          success: false,
          errorMessage: error.message
        })
        return handleError(error)
      }
    }
  )

  // 修改权限
  ipcMain.handle(
    'sftp:changePermissions',
    async (_event, connectionId: string, path: string, mode: number) => {
      try {
        await ensureSFTP(connectionId)
        await sftpManager.changePermissions(connectionId, path, mode)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 获取所有传输任务
  ipcMain.handle('sftp:getAllTasks', async () => {
    const tasks = sftpManager.getAllTasks()
    return { success: true, tasks }
  })

  // 取消传输任务
  ipcMain.handle('sftp:cancelTask', async (_event, taskId: string) => {
    try {
      await sftpManager.cancelTask(taskId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 暂停传输
  ipcMain.handle('sftp:pauseTransfer', async (_event, taskId: string) => {
    try {
      await sftpManager.pauseTask(taskId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 恢复传输：同步校验（记录存在、属于该连接、可恢复），传输本身在后台进行，
  // 结果通过 sftp:started / progress / complete / error / paused / cancelled 事件通知。
  ipcMain.handle('sftp:resumeTransfer', async (_event, connectionId: string, taskId: string) => {
    try {
      await sftpManager.validateResume(connectionId, taskId)
      await ensureSFTP(connectionId)
      sftpManager.resumeTask(connectionId, taskId).catch((error: any) => {
        if (
          error instanceof TransferPausedError ||
          error instanceof TransferCancelledError ||
          isReportedTransferError(error)
        ) {
          return
        }
        broadcast('sftp:error', taskId, error?.message || '恢复传输失败')
      })
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取未完成的传输
  ipcMain.handle('sftp:getIncompleteTransfers', async (_event, connectionId?: string) => {
    try {
      const transfers = sftpManager.getIncompleteTransfers(connectionId)
      return { success: true, data: transfers }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取传输记录
  ipcMain.handle('sftp:getTransferRecord', async (_event, taskId: string) => {
    try {
      const record = sftpManager.getTransferRecord(taskId)
      return { success: true, data: record }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 获取所有传输记录
  ipcMain.handle('sftp:getAllTransferRecords', async () => {
    try {
      const records = sftpManager.getAllTransferRecords()
      return { success: true, data: records }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 删除传输记录
  ipcMain.handle('sftp:deleteTransferRecord', async (_event, taskId: string) => {
    try {
      await sftpManager.deleteTransferRecord(taskId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 清理已完成（及已取消）的记录
  ipcMain.handle('sftp:cleanupCompletedRecords', async () => {
    try {
      await sftpManager.cleanupCompletedRecords()
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 批量上传文件
  ipcMain.handle(
    'sftp:uploadFiles',
    async (
      _event,
      connectionId: string,
      files: Array<{
        localPath: string
        remotePath: string
        taskId?: string
        resumeFromExisting?: boolean
      }>
    ) => {
      try {
        await ensureSFTP(connectionId)
        const results = await sftpManager.uploadFiles(connectionId, files)
        return { success: true, results }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 批量下载文件
  ipcMain.handle(
    'sftp:downloadFiles',
    async (
      _event,
      connectionId: string,
      files: Array<{
        remotePath: string
        localPath: string
        taskId?: string
        resumeFromExisting?: boolean
      }>
    ) => {
      try {
        const rejected: Array<{ path: string; error: string }> = []
        const accepted = (files || []).filter((file) => {
          const invalid = validateLocalTargetPath(file?.localPath)
          if (invalid) rejected.push({ path: file?.remotePath, error: invalid })
          return !invalid
        })
        await ensureSFTP(connectionId)
        const results = await sftpManager.downloadFiles(connectionId, accepted)
        results.failed.push(...rejected)
        return { success: true, results }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 批量删除文件
  ipcMain.handle('sftp:deleteFiles', async (_event, connectionId: string, filePaths: string[]) => {
    try {
      await ensureSFTP(connectionId)
      const results = await sftpManager.deleteFiles(connectionId, filePaths)
      return { success: true, results }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 批量删除目录
  ipcMain.handle(
    'sftp:deleteDirectories',
    async (_event, connectionId: string, dirPaths: string[]) => {
      try {
        await ensureSFTP(connectionId)
        const results = await sftpManager.deleteDirectories(connectionId, dirPaths)
        return { success: true, results }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 读取文件内容（文本）
  ipcMain.handle('sftp:readFile', async (_event, connectionId: string, filePath: string) => {
    try {
      await ensureSFTP(connectionId)
      const content = await sftpManager.readFile(connectionId, filePath)
      return { success: true, data: content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 读取文件开头用于预览（超过 maxBytes 截断）
  ipcMain.handle(
    'sftp:readFilePreview',
    async (_event, connectionId: string, filePath: string, maxBytes: number) => {
      try {
        await ensureSFTP(connectionId)
        const preview = await sftpManager.readFilePreview(connectionId, filePath, maxBytes)
        return { success: true, ...preview }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 读取文件内容（二进制）
  ipcMain.handle('sftp:readFileBuffer', async (_event, connectionId: string, filePath: string) => {
    try {
      await ensureSFTP(connectionId)
      const buffer = await sftpManager.readFileBuffer(connectionId, filePath)
      // 将 Buffer 转换为 base64 字符串，便于通过 IPC 传输
      return { success: true, data: buffer.toString('base64') }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 写入文件内容
  ipcMain.handle(
    'sftp:writeFile',
    async (_event, connectionId: string, filePath: string, content: string) => {
      try {
        await ensureSFTP(connectionId)
        await sftpManager.writeFile(connectionId, filePath, content)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 创建空文件
  ipcMain.handle('sftp:createFile', async (_event, connectionId: string, filePath: string) => {
    try {
      await ensureSFTP(connectionId)
      await sftpManager.createFile(connectionId, filePath)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 复制文件
  ipcMain.handle(
    'sftp:copyFile',
    async (_event, connectionId: string, sourcePath: string, targetPath: string) => {
      try {
        await ensureSFTP(connectionId)
        await sftpManager.copyFile(connectionId, sourcePath, targetPath)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 修改权限（使用 chmod 别名）
  ipcMain.handle('sftp:chmod', async (_event, connectionId: string, path: string, mode: number) => {
    try {
      await ensureSFTP(connectionId)
      await sftpManager.changePermissions(connectionId, path, mode)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 拖曳下载 - 先下载到临时目录，然后启动系统拖曳
  ipcMain.handle(
    'sftp:startDrag',
    async (event, connectionId: string, remotePath: string, fileName: string) => {
      try {
        const { app, nativeImage } = await import('electron')
        const fs = await import('fs')

        const safeName = sanitizeDragFileName(fileName)
        if (!safeName) {
          return { success: false, error: '无效的文件名' }
        }

        await ensureSFTP(connectionId)

        // 每次拖曳使用独立的临时子目录，避免同名文件并发拖曳互相覆盖
        const tempRoot = path.join(app.getPath('temp'), 'mshell-drag')
        await fs.promises.mkdir(tempRoot, { recursive: true })
        const dragDir = await fs.promises.mkdtemp(path.join(tempRoot, 'drag-'))
        const localPath = path.join(dragDir, safeName)

        // 临时下载：不进入全局排队、不广播传输事件、结束后删除传输记录
        await sftpManager.downloadFile(
          connectionId,
          remotePath,
          localPath,
          `drag-${uuidv4()}`,
          undefined,
          true,
          false,
          { skipQueue: true, ephemeral: true }
        )

        // 创建一个简单的拖曳图标（使用空图标，让系统使用默认图标）
        const icon = nativeImage.createEmpty()

        // 启动系统拖曳
        event.sender.startDrag({
          file: localPath,
          icon: icon
        })

        return { success: true, localPath }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 转发 SFTP 事件到渲染进程
  sftpManager.on('started', (taskId: string, record: any) => {
    broadcast('sftp:started', taskId, record)
  })

  sftpManager.on('progress', (taskId: string, progress: any) => {
    broadcast('sftp:progress', taskId, progress)
  })

  sftpManager.on('complete', (taskId: string) => {
    broadcast('sftp:complete', taskId)
  })

  sftpManager.on('error', (taskId: string, error: string) => {
    broadcast('sftp:error', taskId, error)
  })

  sftpManager.on('paused', (taskId: string) => {
    broadcast('sftp:paused', taskId)
  })

  sftpManager.on('cancelled', (taskId: string) => {
    broadcast('sftp:cancelled', taskId)
  })

  // 远程压缩单个文件或目录
  ipcMain.handle(
    'sftp:compress',
    async (_event, connectionId: string, sourcePath: string, archivePath: string) => {
      try {
        if (!sourcePath || !archivePath) {
          return { success: false, error: '参数不完整' }
        }
        const connection = sshConnectionManager.getConnection(connectionId)
        if (!connection) {
          return { success: false, error: '连接不存在' }
        }

        const command = buildCompressCommand([sourcePath], archivePath)
        await runRemoteJob(
          connectionId,
          command,
          `压缩文件已存在：${path.posix.basename(archivePath)}`
        )
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 远程压缩多个文件或目录
  ipcMain.handle(
    'sftp:compressMultiple',
    async (_event, connectionId: string, sourcePaths: string[], archivePath: string) => {
      try {
        if (!sourcePaths?.length || !archivePath) {
          return { success: false, error: '参数不完整' }
        }
        const connection = sshConnectionManager.getConnection(connectionId)
        if (!connection) {
          return { success: false, error: '连接不存在' }
        }

        const command = buildCompressCommand(sourcePaths, archivePath)
        await runRemoteJob(
          connectionId,
          command,
          `压缩文件已存在：${path.posix.basename(archivePath)}`
        )
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 远程解压文件
  ipcMain.handle(
    'sftp:extract',
    async (_event, connectionId: string, archivePath: string, targetDir: string) => {
      try {
        if (!archivePath || !targetDir) {
          return { success: false, error: '参数不完整' }
        }
        const connection = sshConnectionManager.getConnection(connectionId)
        if (!connection) {
          return { success: false, error: '连接不存在' }
        }

        // 先构造命令（会拒绝无法确定输出名、输出与压缩包相同等情况），再做任何远程修改
        const plan = buildExtractCommand(archivePath, targetDir)

        // 确保目标目录存在
        await sshConnectionManager.executeCommand(
          connectionId,
          `mkdir -p ${shellQuote(targetDir)}`,
          30000
        )

        await runRemoteJob(
          connectionId,
          plan.command,
          `解压目标文件已存在：${plan.outputPath || targetDir}`
        )
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )
}
