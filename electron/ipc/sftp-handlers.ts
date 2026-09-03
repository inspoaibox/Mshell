import { ipcMain, BrowserWindow } from 'electron'
import { sftpManager } from '../managers/SFTPManager'
import { HostKeyChallengeError, sshConnectionManager } from '../managers/SSHConnectionManager'
import { auditLogManager, AuditAction } from '../managers/AuditLogManager'
import { v4 as uuidv4 } from 'uuid'
import { AppError } from '../utils/error-handler'
import { prepareSSHConnectionOptions } from '../utils/ssh-connect-options'

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
    error: error.message || '未知错误',
    userMessage: '操作失败，请重试'
  }
}

/**
 * 注册 SFTP IPC 处理器
 */
export function registerSFTPHandlers() {
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
      const files = await sftpManager.listDirectory(connectionId, path)
      return { success: true, files }
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
      try {
        const taskId = options?.taskId || uuidv4()
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
        auditLogManager.log(AuditAction.FILE_UPLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: false,
          errorMessage: error.message
        })
        return handleError(error)
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
      try {
        const taskId = options?.taskId || uuidv4()
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
        auditLogManager.log(AuditAction.FILE_DOWNLOAD, {
          sessionId: connectionId,
          resource: remotePath,
          details: { localPath, remotePath },
          success: false,
          errorMessage: error.message
        })
        return handleError(error)
      }
    }
  )

  // 创建目录
  ipcMain.handle('sftp:createDirectory', async (_event, connectionId: string, path: string) => {
    try {
      await sftpManager.createDirectory(connectionId, path)
      return { success: true }
    } catch (error: any) {
      return handleError(error)
    }
  })

  // 删除文件
  ipcMain.handle('sftp:deleteFile', async (_event, connectionId: string, path: string) => {
    try {
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

  // 恢复传输
  ipcMain.handle('sftp:resumeTransfer', async (_event, connectionId: string, taskId: string) => {
    try {
      sftpManager.resumeTask(connectionId, taskId).catch((error: any) => {
        const windows = BrowserWindow.getAllWindows()
        windows.forEach((win) => {
          win.webContents.send('sftp:error', taskId, error.message || '恢复传输失败')
        })
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

  // 清理已完成的记录
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
        const results = await sftpManager.downloadFiles(connectionId, files)
        return { success: true, results }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 批量删除文件
  ipcMain.handle('sftp:deleteFiles', async (_event, connectionId: string, filePaths: string[]) => {
    try {
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
      const content = await sftpManager.readFile(connectionId, filePath)
      return { success: true, data: content }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 读取文件内容（二进制）
  ipcMain.handle('sftp:readFileBuffer', async (_event, connectionId: string, filePath: string) => {
    try {
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
        const path = await import('path')
        const fs = await import('fs')

        // 创建临时目录
        const tempDir = path.join(app.getPath('temp'), 'mshell-drag')
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true })
        }

        const localPath = path.join(tempDir, fileName)

        // 下载文件到临时目录
        await sftpManager.downloadFile(connectionId, remotePath, localPath, `drag-${Date.now()}`)

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
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('sftp:started', taskId, record)
    })
  })

  sftpManager.on('progress', (taskId: string, progress: any) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('sftp:progress', taskId, progress)
    })
  })

  sftpManager.on('complete', (taskId: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('sftp:complete', taskId)
    })
  })

  sftpManager.on('error', (taskId: string, error: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('sftp:error', taskId, error)
    })
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

        // 使用单引号包裹路径，并转义路径中的单引号（' -> '\''）
        const esc = (p: string) => `'${p.replace(/'/g, "'\\''")}'`
        const ext = archivePath.toLowerCase()
        let command: string

        if (ext.endsWith('.zip')) {
          command = `cd $(dirname ${esc(sourcePath)}) && zip -r ${esc(archivePath)} $(basename ${esc(sourcePath)})`
        } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
          command = `tar -czf ${esc(archivePath)} -C $(dirname ${esc(sourcePath)}) $(basename ${esc(sourcePath)})`
        } else if (ext.endsWith('.tar.bz2')) {
          command = `tar -cjf ${esc(archivePath)} -C $(dirname ${esc(sourcePath)}) $(basename ${esc(sourcePath)})`
        } else if (ext.endsWith('.tar.xz')) {
          command = `tar -cJf ${esc(archivePath)} -C $(dirname ${esc(sourcePath)}) $(basename ${esc(sourcePath)})`
        } else if (ext.endsWith('.tar')) {
          command = `tar -cf ${esc(archivePath)} -C $(dirname ${esc(sourcePath)}) $(basename ${esc(sourcePath)})`
        } else {
          command = `tar -czf ${esc(archivePath)} -C $(dirname ${esc(sourcePath)}) $(basename ${esc(sourcePath)})`
        }

        await sshConnectionManager.executeCommand(connectionId, command, 60000)
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

        const esc = (p: string) => `'${p.replace(/'/g, "'\\''")}'`
        const ext = archivePath.toLowerCase()
        const parentDir = sourcePaths[0].substring(0, sourcePaths[0].lastIndexOf('/')) || '/'
        const fileNames = sourcePaths.map((p) => esc(p.substring(p.lastIndexOf('/') + 1))).join(' ')
        let command: string

        if (ext.endsWith('.zip')) {
          command = `cd ${esc(parentDir)} && zip -r ${esc(archivePath)} ${fileNames}`
        } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
          command = `tar -czf ${esc(archivePath)} -C ${esc(parentDir)} ${fileNames}`
        } else if (ext.endsWith('.tar.bz2')) {
          command = `tar -cjf ${esc(archivePath)} -C ${esc(parentDir)} ${fileNames}`
        } else if (ext.endsWith('.tar.xz')) {
          command = `tar -cJf ${esc(archivePath)} -C ${esc(parentDir)} ${fileNames}`
        } else if (ext.endsWith('.tar')) {
          command = `tar -cf ${esc(archivePath)} -C ${esc(parentDir)} ${fileNames}`
        } else {
          command = `tar -czf ${esc(archivePath)} -C ${esc(parentDir)} ${fileNames}`
        }

        await sshConnectionManager.executeCommand(connectionId, command, 60000)
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

        const esc = (p: string) => `'${p.replace(/'/g, "'\\''")}'`
        const ext = archivePath.toLowerCase()

        // 确保目标目录存在
        await sshConnectionManager.executeCommand(connectionId, `mkdir -p ${esc(targetDir)}`, 10000)

        let command: string
        if (ext.endsWith('.zip')) {
          command = `unzip -o ${esc(archivePath)} -d ${esc(targetDir)}`
        } else if (ext.endsWith('.tar.gz') || ext.endsWith('.tgz')) {
          command = `tar -xzf ${esc(archivePath)} -C ${esc(targetDir)}`
        } else if (ext.endsWith('.tar.bz2')) {
          command = `tar -xjf ${esc(archivePath)} -C ${esc(targetDir)}`
        } else if (ext.endsWith('.tar.xz')) {
          command = `tar -xJf ${esc(archivePath)} -C ${esc(targetDir)}`
        } else if (ext.endsWith('.tar')) {
          command = `tar -xf ${esc(archivePath)} -C ${esc(targetDir)}`
        } else if (ext.endsWith('.gz')) {
          const outputFile = archivePath.replace(/\.gz$/, '').split('/').pop() || 'output'
          command = `gunzip -c ${esc(archivePath)} > ${esc(targetDir + '/' + outputFile)}`
        } else if (ext.endsWith('.bz2')) {
          const outputFile =
            archivePath
              .replace(/\.bz2$/, '')
              .split('/')
              .pop() || 'output'
          command = `bunzip2 -c ${esc(archivePath)} > ${esc(targetDir + '/' + outputFile)}`
        } else if (ext.endsWith('.xz')) {
          const outputFile = archivePath.replace(/\.xz$/, '').split('/').pop() || 'output'
          command = `unxz -c ${esc(archivePath)} > ${esc(targetDir + '/' + outputFile)}`
        } else if (ext.endsWith('.rar')) {
          command = `unrar x -o+ ${esc(archivePath)} ${esc(targetDir + '/')}`
        } else if (ext.endsWith('.7z')) {
          command = `7z x -aoa ${esc(archivePath)} -o${esc(targetDir)}`
        } else {
          return { success: false, error: '不支持的压缩格式' }
        }

        await sshConnectionManager.executeCommand(connectionId, command, 120000)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )
}
