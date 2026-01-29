import { ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { sshConnectionManager, SSHConnectionOptions } from '../managers/SSHConnectionManager'
import { logger } from '../utils/logger'
import { knownHostsManager } from '../utils/known-hosts'

/**
 * 注册 SSH IPC 处理器
 */
export function registerSSHHandlers() {
  // 连接 SSH
  ipcMain.handle('ssh:connect', async (_event, id: string, options: any) => {
    try {
      // 如果提供了privateKey路径，读取文件内容
      let privateKeyBuffer: Buffer | undefined
      if (options.privateKey && typeof options.privateKey === 'string') {
        try {
          privateKeyBuffer = await fs.readFile(options.privateKey)
        } catch (error: any) {
          logger.logError('connection', `Failed to read private key file: ${options.privateKey}`, error)
          return { success: false, error: `无法读取密钥文件: ${error.message}` }
        }
      }

      // 构建连接选项
      const connectOptions: SSHConnectionOptions = {
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        privateKey: privateKeyBuffer,
        passphrase: options.passphrase,
        keepaliveInterval: options.keepaliveInterval,
        keepaliveCountMax: options.keepaliveCountMax,
        readyTimeout: options.readyTimeout,
        sessionName: options.sessionName
      }

      await sshConnectionManager.connect(id, connectOptions)
      logger.logConnection(id, options.sessionName || 'Unknown', options.host, options.username, 'connect')
      return { success: true }
    } catch (error: any) {
      logger.logConnection(id, options.sessionName || 'Unknown', options.host, options.username, 'connect', error.message)
      logger.logError('connection', `Failed to connect to ${options.username}@${options.host}`, error)
      return { success: false, error: error.message }
    }
  })

  // 断开 SSH 连接
  ipcMain.handle('ssh:disconnect', async (_event, id: string) => {
    try {
      const connection = sshConnectionManager.getConnection(id)
      await sshConnectionManager.disconnect(id)
      if (connection) {
        logger.logConnection(id, 'Session', connection.options.host, connection.options.username, 'disconnect')
      }
      return { success: true }
    } catch (error: any) {
      logger.logError('connection', `Failed to disconnect session ${id}`, error)
      return { success: false, error: error.message }
    }
  })

  // 写入数据
  ipcMain.on('ssh:write', (_event, id: string, data: string) => {
    try {
      sshConnectionManager.write(id, data)
      logger.logSessionData(id, 'input', data)
    } catch (error: any) {
      logger.logError('connection', `Failed to write to session ${id}`, error)
    }
  })

  // 调整终端大小
  ipcMain.on('ssh:resize', (_event, id: string, cols: number, rows: number) => {
    try {
      sshConnectionManager.resize(id, cols, rows)
    } catch (error: any) {
      console.error('SSH resize error:', error)
    }
  })

  // 执行命令并获取输出
  ipcMain.handle('ssh:executeCommand', async (_event, id: string, command: string, timeout?: number) => {
    try {
      const output = await sshConnectionManager.executeCommand(id, command, timeout)
      return { success: true, data: output }
    } catch (error: any) {
      logger.logError('connection', `Failed to execute command on session ${id}: ${command}`, error)
      return { success: false, error: error.message }
    }
  })

  // 获取连接状态
  ipcMain.handle('ssh:getConnection', async (_event, id: string) => {
    const connection = sshConnectionManager.getConnection(id)
    if (!connection) {
      return null
    }
    return {
      id: connection.id,
      status: connection.status,
      lastActivity: connection.lastActivity
    }
  })

  // 获取所有连接
  ipcMain.handle('ssh:getAllConnections', async () => {
    const connections = sshConnectionManager.getAllConnections()
    return connections.map(conn => ({
      id: conn.id,
      status: conn.status,
      lastActivity: conn.lastActivity,
      host: conn.options.host,
      port: conn.options.port,
      username: conn.options.username
    }))
  })

  // 验证主机密钥
  ipcMain.handle('ssh:verifyHost', async (_event, host: string, port: number, keyType: string, key: string) => {
    const keyBuffer = Buffer.from(key, 'base64')
    const result = knownHostsManager.verifyHost(host, port, keyType, keyBuffer)
    
    if (result === 'unknown') {
      const hostKey = knownHostsManager.getHost(host, port)
      return { status: 'unknown', fingerprint: hostKey?.fingerprint }
    } else if (result === 'changed') {
      return { status: 'changed' }
    }
    
    return { status: 'trusted' }
  })

  // 添加主机密钥
  ipcMain.handle('ssh:addHost', async (_event, host: string, port: number, keyType: string, key: string) => {
    const keyBuffer = Buffer.from(key, 'base64')
    knownHostsManager.addHost(host, port, keyType, keyBuffer)
    return { success: true }
  })

  // 获取所有已知主机
  ipcMain.handle('ssh:getKnownHosts', async () => {
    return knownHostsManager.getAllHosts()
  })

  // 移除主机
  ipcMain.handle('ssh:removeHost', async (_event, host: string, port: number) => {
    knownHostsManager.removeHost(host, port)
    return { success: true }
  })

  // 启用会话日志
  ipcMain.handle('ssh:enableSessionLogging', async (_event, sessionId: string) => {
    logger.enableSessionLogging(sessionId)
    return { success: true }
  })

  // 禁用会话日志
  ipcMain.handle('ssh:disableSessionLogging', async (_event, sessionId: string) => {
    logger.disableSessionLogging(sessionId)
    return { success: true }
  })

  // 转发 SSH 事件到渲染进程
  sshConnectionManager.on('data', (id: string, data: string) => {
    logger.logSessionData(id, 'output', data)
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:data', id, data)
    })
  })

  sshConnectionManager.on('error', (id: string, error: string) => {
    logger.logError('connection', `SSH error for session ${id}`, new Error(error))
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:error', id, error)
    })
  })

  sshConnectionManager.on('close', (id: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:close', id)
    })
  })

  // 重连事件
  sshConnectionManager.on('reconnecting', (id: string, attempt: number, maxAttempts: number) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:reconnecting', id, attempt, maxAttempts)
    })
  })

  sshConnectionManager.on('reconnected', (id: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:reconnected', id)
    })
  })

  sshConnectionManager.on('reconnect-failed', (id: string, reason: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach(win => {
      win.webContents.send('ssh:reconnect-failed', id, reason)
    })
  })

  // 取消重连
  ipcMain.handle('ssh:cancelReconnect', async (_event, id: string) => {
    try {
      sshConnectionManager.cancelReconnect(id)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // 设置重连配置
  ipcMain.handle('ssh:setReconnectConfig', async (_event, id: string, maxAttempts: number, interval: number) => {
    try {
      sshConnectionManager.setReconnectConfig(id, maxAttempts, interval)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
