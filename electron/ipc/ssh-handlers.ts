import { ipcMain, BrowserWindow } from 'electron'
import {
  HostKeyChallengeError,
  sshConnectionManager,
  type SSHCloseDetails
} from '../managers/SSHConnectionManager'
import { logger } from '../utils/logger'
import { knownHostsManager } from '../utils/known-hosts'
import { auditLogManager, AuditAction } from '../managers/AuditLogManager'
import { ProxyHelper } from '../utils/proxy'
import { ProxyJumpHelper } from '../utils/proxy-jump'
import type { ProxyJumpConfig, ProxyConfig } from '../../src/types/session'
import {
  prepareSSHConnectionOptions,
  processProxyJumpPrivateKeys
} from '../utils/ssh-connect-options'
import { portForwardManager } from '../managers/PortForwardManager'

/**
 * 注册 SSH IPC 处理器
 */
export function registerSSHHandlers() {
  // 连接 SSH
  ipcMain.handle('ssh:connect', async (_event, id: string, options: any) => {
    try {
      const connectOptions = await prepareSSHConnectionOptions({ ...options, openShell: true })

      await sshConnectionManager.connect(id, connectOptions)
      logger.logConnection(
        id,
        options.sessionName || 'Unknown',
        options.host,
        options.username,
        'connect'
      )

      // 记录审计日志
      auditLogManager.log(AuditAction.SESSION_CONNECT, {
        sessionId: id,
        resource: `${options.username}@${options.host}:${options.port}`,
        details: {
          sessionName: options.sessionName,
          host: options.host,
          port: options.port,
          username: options.username
        },
        success: true
      })

      return { success: true }
    } catch (error: any) {
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

      logger.logConnection(
        id,
        options.sessionName || 'Unknown',
        options.host,
        options.username,
        'connect',
        error.message
      )
      logger.logError(
        'connection',
        `Failed to connect to ${options.username}@${options.host}`,
        error
      )

      // 记录失败的审计日志
      auditLogManager.log(AuditAction.SESSION_CONNECT, {
        sessionId: id,
        resource: `${options.username}@${options.host}:${options.port}`,
        details: {
          sessionName: options.sessionName,
          host: options.host,
          port: options.port,
          username: options.username
        },
        success: false,
        errorMessage: error.message
      })

      return { success: false, error: error.message }
    }
  })

  // 断开 SSH 连接
  ipcMain.handle('ssh:disconnect', async (_event, id: string) => {
    try {
      const connection = sshConnectionManager.getConnection(id)
      await portForwardManager.stopForwardsByConnection(id)
      await sshConnectionManager.disconnect(id)
      if (connection) {
        logger.logConnection(
          id,
          'Session',
          connection.options.host,
          connection.options.username,
          'disconnect'
        )

        // 记录审计日志
        auditLogManager.log(AuditAction.SESSION_DISCONNECT, {
          sessionId: id,
          resource: `${connection.options.username}@${connection.options.host}:${connection.options.port}`,
          details: {
            host: connection.options.host,
            port: connection.options.port,
            username: connection.options.username
          },
          success: true
        })
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
  ipcMain.handle(
    'ssh:executeCommand',
    async (_event, id: string, command: string, timeout?: number) => {
      try {
        const output = await sshConnectionManager.executeCommand(id, command, timeout)
        return { success: true, data: output }
      } catch (error: any) {
        logger.logError(
          'connection',
          `Failed to execute command on session ${id}: ${command}`,
          error
        )
        return { success: false, error: error.message }
      }
    }
  )

  // 获取终端当前工作目录
  ipcMain.handle('ssh:getCurrentDirectory', async (_event, id: string) => {
    try {
      const dir = await sshConnectionManager.getCurrentDirectory(id)
      return { success: true, data: dir }
    } catch (error: any) {
      logger.logError('connection', `Failed to get current directory for session ${id}`, error)
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
    return connections.map((conn) => ({
      id: conn.id,
      status: conn.status,
      lastActivity: conn.lastActivity,
      host: conn.options.host,
      port: conn.options.port,
      username: conn.options.username
    }))
  })

  // 验证主机密钥
  ipcMain.handle(
    'ssh:verifyHost',
    async (_event, host: string, port: number, keyType: string, key: string) => {
      const keyBuffer = Buffer.from(key, 'base64')
      const result = knownHostsManager.verifyHost(host, port, keyType, keyBuffer)

      if (result === 'unknown') {
        const hostKey = knownHostsManager.getHost(host, port)
        return { status: 'unknown', fingerprint: hostKey?.fingerprint }
      } else if (result === 'changed') {
        return { status: 'changed' }
      }

      return { status: 'trusted' }
    }
  )

  // 添加主机密钥
  ipcMain.handle(
    'ssh:addHost',
    async (_event, host: string, port: number, keyType: string, key: string) => {
      const keyBuffer = Buffer.from(key, 'base64')
      knownHostsManager.addHost(host, port, keyType, keyBuffer)
      return { success: true }
    }
  )

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
    windows.forEach((win) => {
      win.webContents.send('ssh:data', id, data)
    })
  })

  sshConnectionManager.on('error', (id: string, error: string) => {
    logger.logError('connection', `SSH error for session ${id}`, new Error(error))
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('ssh:error', id, error)
    })
  })

  sshConnectionManager.on('close', (id: string, details?: SSHCloseDetails) => {
    logger.logInfo(
      'connection',
      `SSH closed for session ${id}`,
      details ? JSON.stringify(details) : undefined
    )

    portForwardManager.stopForwardsByConnection(id).catch((error) => {
      logger.logError('connection', `Failed to stop port forwards for session ${id}`, error)
    })

    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('ssh:close', id, details)
    })
  })

  // 重连事件
  sshConnectionManager.on('reconnecting', (id: string, attempt: number, maxAttempts: number) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('ssh:reconnecting', id, attempt, maxAttempts)
    })
  })

  sshConnectionManager.on('reconnected', (id: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('ssh:reconnected', id)
    })
  })

  sshConnectionManager.on('reconnect-failed', (id: string, reason: string) => {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
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
  ipcMain.handle(
    'ssh:setReconnectConfig',
    async (_event, id: string, maxAttempts: number, interval: number) => {
      try {
        sshConnectionManager.setReconnectConfig(id, maxAttempts, interval)
        return { success: true }
      } catch (error: any) {
        return { success: false, error: error.message }
      }
    }
  )

  // 测试代理连接
  ipcMain.handle('ssh:testProxy', async (_event, proxyConfig: ProxyConfig) => {
    try {
      // 使用一个公共的测试目标（如 Google DNS）
      const testHost = '8.8.8.8'
      const testPort = 53

      const startTime = Date.now()
      const socket = await ProxyHelper.connect(proxyConfig, testHost, testPort)
      const latency = Date.now() - startTime

      // 连接成功，关闭 socket
      socket.destroy()

      return {
        success: true,
        message: `代理连接成功`,
        latency
      }
    } catch (error: any) {
      logger.logError('proxy', `Proxy test failed`, error)
      return {
        success: false,
        error: error.message || '代理连接失败'
      }
    }
  })

  // 测试跳板机连接
  ipcMain.handle(
    'ssh:testProxyJump',
    async (_event, proxyJumpConfig: ProxyJumpConfig, underlyingProxy?: ProxyConfig) => {
      try {
        // 处理私钥
        const processedConfig = await processProxyJumpPrivateKeys(proxyJumpConfig)

        // 验证配置
        const validation = ProxyJumpHelper.validateProxyConfig(processedConfig)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }

        // 使用一个测试目标（跳板机自身）
        const testHost = processedConfig.host
        const testPort = processedConfig.port

        const startTime = Date.now()

        // 尝试通过跳板机建立连接
        const socket = await ProxyJumpHelper.connectThroughProxy(
          processedConfig,
          testHost,
          testPort,
          underlyingProxy
        )

        const latency = Date.now() - startTime

        // 连接成功，关闭 socket
        socket.destroy()

        const chainDesc = ProxyJumpHelper.getProxyChainDescription(processedConfig)

        return {
          success: true,
          message: `跳板机连接成功: ${chainDesc}`,
          latency
        }
      } catch (error: any) {
        logger.logError('proxy-jump', `ProxyJump test failed`, error)
        return {
          success: false,
          error: error.message || '跳板机连接失败'
        }
      }
    }
  )
}
