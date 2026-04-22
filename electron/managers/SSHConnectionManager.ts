import { Client, ClientChannel } from 'ssh2'
import { EventEmitter } from 'node:events'
import * as net from 'net'
import { appSettingsManager } from '../utils/app-settings'
import { ErrorHandler, AppError } from '../utils/error-handler'
import { ProxyJumpHelper } from '../utils/proxy-jump'
import { ProxyHelper } from '../utils/proxy'
import type { ProxyJumpConfig, ProxyConfig } from '../../src/types/session'

export interface SSHConnectionOptions {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: Buffer
  passphrase?: string
  keepaliveInterval?: number
  keepaliveCountMax?: number
  readyTimeout?: number
  sessionName?: string
  proxyJump?: ProxyJumpConfig
  proxy?: ProxyConfig
}

export interface SSHConnection {
  id: string
  options: SSHConnectionOptions
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'
  client: Client
  socket?: net.Socket
  stream?: ClientChannel
  lastActivity: Date
  monitorTimer?: NodeJS.Timeout
  reconnectAttempts?: number
  reconnectTimer?: NodeJS.Timeout
  maxReconnectAttempts?: number
  reconnectInterval?: number
  shellPid?: number // Shell 进程的 PID，用于获取当前目录
}

/**
 * SSHConnectionManager - 管理 SSH 连接的生命周期
 */
export class SSHConnectionManager extends EventEmitter {
  private connections: Map<string, SSHConnection>
  private readonly DEFAULT_MAX_RECONNECT_ATTEMPTS = 3
  private readonly DEFAULT_RECONNECT_INTERVAL = 5000 // 5秒

  constructor() {
    super()
    this.connections = new Map()
  }

  /**
   * 建立 SSH 连接
   */
  async connect(id: string, options: SSHConnectionOptions): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const client = new Client()
      const settings = appSettingsManager.getSettings()

      // Explicitly create socket to enable TCP_NODELAY for lower latency
      let socket: net.Socket

      try {
        if (options.proxyJump && options.proxyJump.enabled) {
          // 验证跳板机配置
          const validation = ProxyJumpHelper.validateProxyConfig(options.proxyJump)
          if (!validation.valid) {
            throw new Error(validation.error)
          }

          // 通过跳板机建立连接，传递底层代理配置（如果有）
          socket = await ProxyJumpHelper.connectThroughProxy(
            options.proxyJump,
            options.host,
            options.port,
            options.proxy // 传递底层代理
          )

          // 发送跳板机连接成功事件
          const chainDesc = ProxyJumpHelper.getProxyChainDescription(options.proxyJump)
          this.emit('proxy-connected', id, chainDesc)
        } else if (options.proxy && options.proxy.enabled) {
          // 只有代理，没有跳板机 -> 通过代理连接目标主机
          socket = await ProxyHelper.connect(options.proxy, options.host, options.port)
          this.emit('proxy-connected', id, `Via ${options.proxy.type.toUpperCase()} Proxy`)
        } else {
          // 直接连接
          socket = new net.Socket()
        }
      } catch (err: any) {
        const appError = ErrorHandler.handle(err, `Connection Init ${id}`)
        reject(appError)
        return
      }

      socket.setNoDelay(true)

      const connection: SSHConnection = {
        id,
        options,
        status: 'connecting',
        client,
        socket,
        lastActivity: new Date(),
        reconnectAttempts: 0,
        maxReconnectAttempts: this.DEFAULT_MAX_RECONNECT_ATTEMPTS,
        reconnectInterval: this.DEFAULT_RECONNECT_INTERVAL
      }

      this.connections.set(id, connection)

      // Handle socket errors
      socket.on('error', (err) => {
        const appError = ErrorHandler.handle(err, `SSH Connection ${id}`)
        if (connection.status === 'connecting') {
          reject(appError)
        }
        this.emit('error', id, appError.userMessage)
      })

      // Setup SSH Client events
      client.on('ready', () => {
        connection.status = 'connected'
        connection.lastActivity = new Date()

        // 打开 shell，设置终端类型和环境变量
        // Open shell with window and options
        const window = {
          term: 'xterm-256color',
          cols: 220,  // 使用较大的初始列数，避免服务端按80列折行导致显示错位
          rows: 50,   // 使用较大的初始行数
          modes: {
            ECHO: 1,
            ICANON: 1,  // 开启规范模式，避免特殊字符处理异常
            ISIG: 1,
            ICRNL: 1,
            ONLCR: 1,
            OPOST: 1,
            VERASE: 127  // 0x7F (DEL) - 匹配 xterm.js 发送的 Backspace 字符
          }
        }

        const shellOptions = {
          env: {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'en_US.UTF-8',
            LC_ALL: 'en_US.UTF-8'
          }
        }

        client.shell(window as any, shellOptions, (err, stream) => {
          if (err) {
            connection.status = 'error'
            const appError = ErrorHandler.handle(err, `SSH Shell ${id}`)
            this.emit('error', id, appError.userMessage)
            reject(appError)
            return
          }

          connection.stream = stream

          // 监听数据 - Pass Buffer directly to avoid string conversion overhead and encoding issues
          stream.on('data', (data: Buffer) => {
            connection.lastActivity = new Date()
            this.emit('data', id, data)
          })

          stream.on('close', () => {
            connection.status = 'disconnected'
            this.stopSessionMonitor(id)
            this.emit('close', id)
          })

          stream.stderr.on('data', (data: Buffer) => {
            const appError = ErrorHandler.createConnectionError(data.toString())
            this.emit('error', id, appError.userMessage)
          })

          // 启动会话监控（超时检测）
          this.startSessionMonitor(id)

          // 获取 shell 的 PID（用于后续获取当前目录）
          this.getShellPid(id).then(pid => {
            if (pid) {
              connection.shellPid = pid
            }
          }).catch(() => {
            // 忽略错误，PID 获取失败不影响正常使用
          })

          resolve()
        })
      })

      client.on('error', (err) => {
        const appError = ErrorHandler.handle(err, `SSH Client ${id}`)
        this.emit('error', id, appError.userMessage)
        // 只在连接阶段（connecting）才 reject Promise，避免已连接后的错误重复 reject
        if (connection.status === 'connecting') {
          connection.status = 'error'
          reject(appError)
        } else {
          connection.status = 'error'
        }
      })

      client.on('close', () => {
        connection.status = 'disconnected'
        this.stopSessionMonitor(id)
        this.emit('close', id)

        // 尝试自动重连
        this.attemptReconnect(id)
      })

      // 使用全局设置作为默认值
      // 如果 options 中有值则优先使用 options (通常来自会话特定的配置)
      // 但 currently frontend might not pass keepalive correctly via options if it relies on global settings
      // So we merge logic: Priority: Options > Settings > Defaults

      const keepaliveInterval = options.keepaliveInterval ??
        (settings.ssh.keepalive ? settings.ssh.keepaliveInterval * 1000 : 0)

      const readyTimeout = options.readyTimeout ?? (settings.ssh.timeout * 1000)

      // 连接配置
      const connectConfig: any = {
        sock: socket, // Use our custom socket
        username: options.username,
        readyTimeout: readyTimeout || 20000,
        keepaliveInterval: keepaliveInterval,
        keepaliveCountMax: options.keepaliveCountMax || 3
      }

      if (options.password) {
        connectConfig.password = options.password
      }

      if (options.privateKey) {
        connectConfig.privateKey = options.privateKey
        if (options.passphrase) {
          connectConfig.passphrase = options.passphrase
        }
      }

      // 如果使用了代理或跳板机，socket 已经是连接状态，不需要再次 connect
      if ((options.proxyJump && options.proxyJump.enabled) || (options.proxy && options.proxy.enabled)) {
        client.connect(connectConfig)
      } else {
        // 如果是新创建的 socket（未使用代理/跳板机），需要手动连接
        socket.connect(options.port, options.host, () => {
          client.connect(connectConfig)
        })
      }
    })
  }

  /**
   * 断开 SSH 连接
   */
  async disconnect(id: string): Promise<void> {
    const connection = this.connections.get(id)
    if (!connection) {
      console.warn(`Attempted to disconnect non-existent session: ${id}`)
      return
    }

    // 取消重连
    this.cancelReconnect(id)

    this.stopSessionMonitor(id)

    if (connection.stream) {
      connection.stream.end()
    }

    connection.client.end()
    if (connection.socket) {
      connection.socket.destroy()
    }
    this.connections.delete(id)
  }

  /**
   * 写入数据到 SSH 连接
   */
  write(id: string, data: string | Buffer): void {
    const connection = this.connections.get(id)
    if (!connection || !connection.stream) {
      // throw new Error(`Connection not ready: ${id}`)
      // Log warning instead of throwing to prevent app crash on race conditions
      console.warn(`Attempted to write to non-ready session: ${id}`)
      return
    }

    if (typeof data === 'string') {
      connection.stream.write(data, 'utf8')
    } else {
      connection.stream.write(data)
    }

    connection.lastActivity = new Date()
  }

  /**
   * 执行命令并获取输出（用于自动补全等功能）
   */
  async executeCommand(id: string, command: string, timeout: number = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      const connection = this.connections.get(id)
      if (!connection || !connection.client) {
        reject(new Error(`Connection not found: ${id}`))
        return
      }

      let output = ''
      let errorOutput = ''
      let timeoutHandle: NodeJS.Timeout

      connection.client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        // 设置超时
        timeoutHandle = setTimeout(() => {
          stream.close()
          reject(new Error(`Command execution timeout: ${command}`))
        }, timeout)

        stream.on('data', (data: Buffer) => {
          output += data.toString('utf8')
        })

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString('utf8')
        })

        stream.on('close', (code: number) => {
          clearTimeout(timeoutHandle)

          if (code === 0) {
            resolve(output)
          } else {
            reject(new Error(`Command failed with code ${code}: ${errorOutput || output}`))
          }
        })

        stream.on('error', (err: Error) => {
          clearTimeout(timeoutHandle)
          reject(err)
        })
      })
    })
  }

  /**
   * 获取 shell 进程的 PID
   */
  private async getShellPid(id: string): Promise<number | null> {
    try {
      // 使用 pgrep 或 ps 获取当前用户的 shell PID
      const output = await this.executeCommand(id, 'echo $$', 3000)
      const pid = parseInt(output.trim())
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  /**
   * 获取终端当前工作目录
   */
  async getCurrentDirectory(id: string): Promise<string> {
    const connection = this.connections.get(id)
    if (!connection) {
      throw new Error(`Connection not found: ${id}`)
    }

    try {
      // 方法1: 如果有 shell PID，通过 /proc/<pid>/cwd 获取
      if (connection.shellPid) {
        const output = await this.executeCommand(
          id, 
          `readlink /proc/${connection.shellPid}/cwd 2>/dev/null || pwd`,
          3000
        )
        return output.trim()
      }

      // 方法2: 尝试获取最近的 bash/zsh/sh 进程的 cwd
      const output = await this.executeCommand(
        id,
        `readlink /proc/$(pgrep -u $(whoami) -n "bash|zsh|sh" 2>/dev/null || echo self)/cwd 2>/dev/null || pwd`,
        3000
      )
      return output.trim()
    } catch {
      // 降级：返回 home 目录
      try {
        const home = await this.executeCommand(id, 'echo $HOME', 2000)
        return home.trim()
      } catch {
        return '/'
      }
    }
  }

  /**
   * 调整终端大小
   */
  resize(id: string, cols: number, rows: number): void {
    const connection = this.connections.get(id)
    if (!connection || !connection.stream) {
      return
    }

    connection.stream.setWindow(rows, cols, 0, 0)
  }

  /**
   * 获取连接
   */
  getConnection(id: string): SSHConnection | undefined {
    return this.connections.get(id)
  }

  /**
   * 启动会话监控 (Session Timeout Monitor)
   */
  startSessionMonitor(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return

    this.stopSessionMonitor(id)

    // Check every minute
    const checkInterval = 60000

    connection.monitorTimer = setInterval(() => {
      try {
        const settings = appSettingsManager.getSettings()
        const timeoutMinutes = settings.security.sessionTimeout

        // 0 means no timeout
        if (timeoutMinutes > 0) {
          const idleTime = new Date().getTime() - connection.lastActivity.getTime()
          const timeoutMs = timeoutMinutes * 60 * 1000

          if (idleTime > timeoutMs) {
            const appError = ErrorHandler.createConnectionError(
              `会话已超时 (闲置超过 ${timeoutMinutes} 分钟)`
            )
            this.emit('error', id, appError.userMessage)
            this.disconnect(id).catch(err => {
              ErrorHandler.handle(err, `Disconnect timeout session ${id}`)
            })
          }
        }
      } catch (error) {
        ErrorHandler.handle(error as Error, `Session monitor ${id}`)
      }
    }, checkInterval)
  }

  /**
   * 停止会话监控
   */
  stopSessionMonitor(id: string): void {
    const connection = this.connections.get(id)
    if (connection && connection.monitorTimer) {
      clearInterval(connection.monitorTimer)
      connection.monitorTimer = undefined
    }
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): SSHConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return

    // 检查是否超过最大重连次数
    if (connection.reconnectAttempts! >= connection.maxReconnectAttempts!) {
      console.log(`Max reconnect attempts reached for session ${id}`)
      this.emit('reconnect-failed', id, '已达到最大重连次数')
      return
    }

    // 清理旧的重连定时器
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
    }

    connection.status = 'reconnecting'
    connection.reconnectAttempts = (connection.reconnectAttempts || 0) + 1

    console.log(`Attempting to reconnect session ${id} (attempt ${connection.reconnectAttempts}/${connection.maxReconnectAttempts})`)
    this.emit('reconnecting', id, connection.reconnectAttempts, connection.maxReconnectAttempts)

    // 延迟重连
    connection.reconnectTimer = setTimeout(async () => {
      try {
        // 先清理旧连接
        if (connection.stream) {
          connection.stream.removeAllListeners()
          connection.stream.end()
        }
        if (connection.client) {
          connection.client.removeAllListeners()
          connection.client.end()
        }
        if (connection.socket) {
          connection.socket.removeAllListeners()
          connection.socket.destroy()
        }

        // 从 Map 中移除旧连接，让 connect() 创建全新的连接对象
        this.connections.delete(id)

        // 尝试重新连接
        await this.connect(id, connection.options)

        // 重连成功，更新新连接对象的计数器
        const newConnection = this.connections.get(id)
        if (newConnection) {
          newConnection.reconnectAttempts = 0
        }
        console.log(`Successfully reconnected session ${id}`)
        this.emit('reconnected', id)
      } catch (error) {
        console.error(`Reconnect attempt ${connection.reconnectAttempts} failed for session ${id}:`, error)

        // 重新放回旧连接对象以便继续重试
        if (!this.connections.has(id)) {
          this.connections.set(id, connection)
        }

        // 继续尝试重连
        this.attemptReconnect(id)
      }
    }, connection.reconnectInterval)
  }

  /**
   * 取消重连
   */
  cancelReconnect(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return

    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
      connection.reconnectTimer = undefined
    }

    connection.reconnectAttempts = 0
    console.log(`Reconnect cancelled for session ${id}`)
  }

  /**
   * 设置重连配置
   */
  setReconnectConfig(id: string, maxAttempts: number, interval: number): void {
    const connection = this.connections.get(id)
    if (!connection) return

    connection.maxReconnectAttempts = maxAttempts
    connection.reconnectInterval = interval
  }
}

// 导出单例实例
export const sshConnectionManager = new SSHConnectionManager()
