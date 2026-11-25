import { Client, ClientChannel } from 'ssh2'
import { EventEmitter } from 'node:events'
import * as net from 'net'
import { appSettingsManager } from '../utils/app-settings'
import { ErrorHandler } from '../utils/error-handler'
import { ProxyJumpHelper } from '../utils/proxy-jump'
import { ProxyHelper } from '../utils/proxy'
import type { SSHTransport } from '../utils/ssh-transport'
import {
  getHostKeyFingerprint,
  knownHostsManager,
  type HostKeyChallengeDetails,
  type TrustedHostKey
} from '../utils/known-hosts'
import type { ProxyJumpConfig, ProxyConfig } from '../../src/types/session'

export interface SSHConnectionOptions {
  host: string
  port: number
  username: string
  authType?: 'password' | 'privateKey'
  password?: string
  privateKey?: Buffer
  passphrase?: string
  keepaliveInterval?: number
  keepaliveCountMax?: number
  readyTimeout?: number
  autoReconnect?: boolean
  maxReconnectAttempts?: number
  reconnectInterval?: number
  sessionName?: string
  proxyJump?: ProxyJumpConfig
  proxy?: ProxyConfig
  openShell?: boolean
  trustedHostKey?: TrustedHostKey
}

export type SSHCloseSource = 'stream' | 'client' | 'socket' | 'manual' | 'timeout' | 'replace'

export interface SSHCloseDetails {
  source: SSHCloseSource
  reason: string
  statusBefore: SSHConnection['status']
  lastActivity: string
  closedAt: string
  hadError?: boolean
  errorMessage?: string
  errorCode?: string
  reconnecting?: boolean
  socket?: {
    destroyed: boolean
    connecting: boolean
    readyState?: string
    bytesRead?: number
    bytesWritten?: number
    localAddress?: string
    localPort?: number
    remoteAddress?: string
    remotePort?: number
  }
}

export class HostKeyChallengeError extends Error {
  public readonly code = 'HOST_KEY_CHALLENGE_REQUIRED'
  public readonly details: HostKeyChallengeDetails

  constructor(details: HostKeyChallengeDetails) {
    super(
      details.status === 'changed' ? 'SSH host key changed' : 'SSH host key confirmation required'
    )
    this.name = 'HostKeyChallengeError'
    this.details = details
  }
}

export interface SSHConnection {
  id: string
  options: SSHConnectionOptions
  status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting'
  client: Client
  socket?: SSHTransport
  cancelConnect?: () => void
  stream?: ClientChannel
  lastActivity: Date
  monitorTimer?: NodeJS.Timeout
  reconnectAttempts?: number
  reconnectTimer?: NodeJS.Timeout
  maxReconnectAttempts?: number
  reconnectInterval?: number
  shellPid?: number // Shell 进程的 PID，用于获取当前目录
  closeEmitted?: boolean
  manualDisconnect?: boolean
  manualDisconnectReason?: SSHCloseSource
  lastCloseDetails?: SSHCloseDetails
  lastError?: string
  lastErrorCode?: string
  lastSocketCloseHadError?: boolean
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
    if (this.connections.has(id)) await this.disconnect(id, 'replace')
    if (options.proxyJump?.enabled) {
      const validation = ProxyJumpHelper.validateProxyConfig(options.proxyJump)
      if (!validation.valid) throw new Error(validation.error)
    }

    const client = new Client()
    const settings = appSettingsManager.getSettings()
    const controller = new AbortController()
    const timeoutMs = Math.max(1, options.readyTimeout || settings.ssh.timeout * 1000 || 20_000)
    const stages =
      1 +
      (options.proxyJump?.enabled ? ProxyJumpHelper.getProxyDepth(options.proxyJump) : 0) +
      (options.proxy?.enabled ? 1 : 0)
    let socket: SSHTransport | undefined

    return new Promise((resolve, reject) => {
      const connection: SSHConnection = {
        id,
        options,
        status: 'connecting',
        client,
        socket,
        lastActivity: new Date(),
        reconnectAttempts: 0,
        maxReconnectAttempts:
          options.autoReconnect === false
            ? 0
            : (options.maxReconnectAttempts ?? this.DEFAULT_MAX_RECONNECT_ATTEMPTS),
        reconnectInterval: options.reconnectInterval ?? this.DEFAULT_RECONNECT_INTERVAL
      }

      this.connections.set(id, connection)
      let connectSettled = false
      let hostKeyChallenge: HostKeyChallengeDetails | undefined
      // Also bounds TCP setup, forwarding and shell creation, not just SSH's handshake.
      const timer = setTimeout(
        () => rejectWhileConnecting(new Error(`SSH 连接超时：${options.host}:${options.port}`)),
        timeoutMs * stages
      )
      const finishConnect = () => {
        connectSettled = true
        clearTimeout(timer)
        connection.cancelConnect = undefined
      }

      const rejectWhileConnecting = (error: Error) => {
        if (connectSettled) return
        finishConnect()
        connection.status = connection.manualDisconnect ? 'disconnected' : 'error'
        this.stopSessionMonitor(id)

        if (this.connections.get(id) === connection) {
          this.connections.delete(id)
        }

        reject(error)
        controller.abort()
        try {
          client.destroy()
        } catch {}
        try {
          socket?.destroy()
        } catch {}
      }

      const resolveOnce = () => {
        if (connectSettled) return
        finishConnect()
        connection.status = 'connected'
        resolve()
      }

      const rejectHostKeyChallenge = () => {
        if (!hostKeyChallenge || connectSettled) return false
        rejectWhileConnecting(new HostKeyChallengeError(hostKeyChallenge))
        return true
      }

      connection.cancelConnect = () => rejectWhileConnecting(new Error('已取消 SSH 连接'))

      // Setup SSH Client events
      client.on('ready', () => {
        if (connectSettled || this.connections.get(id) !== connection) return
        connection.lastActivity = new Date()

        if (options.openShell === false) {
          this.startSessionMonitor(id)
          resolveOnce()
          return
        }

        // 打开 shell，设置终端类型和环境变量
        // Open shell with window and options
        const window = {
          term: 'xterm-256color',
          cols: 220, // 使用较大的初始列数，避免服务端按80列折行导致显示错位
          rows: 50, // 使用较大的初始行数
          modes: {
            ECHO: 1,
            ICANON: 1, // 开启规范模式，避免特殊字符处理异常
            ISIG: 1,
            ICRNL: 1,
            ONLCR: 1,
            OPOST: 1,
            VERASE: 127 // 0x7F (DEL) - 匹配 xterm.js 发送的 Backspace 字符
          }
        }

        const shellOptions = {
          env: {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            LANG: 'C.UTF-8',
            LC_CTYPE: 'C.UTF-8'
          }
        }

        try {
          client.shell(window as any, shellOptions, (err, stream) => {
            if (connectSettled || this.connections.get(id) !== connection) {
              stream?.destroy()
              return
            }
            if (err) {
              connection.status = 'error'
              const appError = ErrorHandler.handle(err, `SSH Shell ${id}`)
              this.emit('error', id, appError.userMessage)
              rejectWhileConnecting(appError)
              return
            }

            connection.stream = stream

            // 监听数据 - Pass Buffer directly to avoid string conversion overhead and encoding issues
            stream.on('data', (data: Buffer) => {
              connection.lastActivity = new Date()
              this.emit('data', id, data)
            })

            stream.on('close', () => {
              if (connectSettled && this.connections.get(id) !== connection) {
                return
              }
              const closeSource = connection.manualDisconnect
                ? connection.manualDisconnectReason || 'manual'
                : 'stream'
              const closeReason = connection.manualDisconnect
                ? `SSH connection closed by ${closeSource}`
                : 'SSH shell channel closed'
              this.emitCloseOnce(id, connection, closeSource, closeReason)
            })

            stream.stderr.on('data', (data: Buffer) => {
              const appError = ErrorHandler.createConnectionError(data.toString())
              this.emit('error', id, appError.userMessage)
            })

            // 启动会话监控（超时检测）
            this.startSessionMonitor(id)

            // 获取 shell 的 PID（用于后续获取当前目录）
            this.getShellPid(id)
              .then((pid) => {
                if (pid) {
                  connection.shellPid = pid
                }
              })
              .catch(() => {
                // 忽略错误，PID 获取失败不影响正常使用
              })

            resolveOnce()
          })
        } catch (error) {
          rejectWhileConnecting(error instanceof Error ? error : new Error(String(error)))
        }
      })

      client.on('error', (err) => {
        if (this.connections.get(id) !== connection) return
        if (rejectHostKeyChallenge()) return

        const appError = ErrorHandler.handle(err, `SSH Client ${id}`)
        connection.lastError = appError.userMessage
        connection.lastErrorCode = (err as any)?.code
        this.emit('error', id, appError.userMessage)
        // Authentication may have finished while opening the shell is still pending.
        if (!connectSettled) {
          rejectWhileConnecting(appError)
        } else {
          connection.status = 'error'
        }
      })

      client.on('close', () => {
        // 通知依附于该 Client 的子通道（如 SFTP）立即失效，避免请求永远挂起。
        this.emitClientClosed(id, client)
        if (!connectSettled) {
          rejectWhileConnecting(new Error(connection.lastError || 'SSH 连接在就绪前关闭'))
          return
        }
        if (this.connections.get(id) !== connection) {
          return
        }

        const willReconnect =
          !connection.manualDisconnect &&
          Boolean(connection.maxReconnectAttempts && connection.maxReconnectAttempts > 0) &&
          (connection.reconnectAttempts || 0) < (connection.maxReconnectAttempts || 0)

        this.emitCloseOnce(
          id,
          connection,
          connection.manualDisconnect ? connection.manualDisconnectReason || 'manual' : 'client',
          connection.lastError
            ? `SSH client closed after error: ${connection.lastError}`
            : 'SSH client closed',
          willReconnect
        )

        // 尝试自动重连
        if (willReconnect) {
          this.attemptReconnect(id)
        }
      })

      // 使用全局设置作为默认值
      // 如果 options 中有值则优先使用 options (通常来自会话特定的配置)
      // 但 currently frontend might not pass keepalive correctly via options if it relies on global settings
      // So we merge logic: Priority: Options > Settings > Defaults

      const keepaliveInterval =
        options.keepaliveInterval ??
        (settings.ssh.keepalive ? settings.ssh.keepaliveInterval * 1000 : 0)

      const readyTimeout = options.readyTimeout ?? settings.ssh.timeout * 1000

      // 连接配置
      const connectConfig: any = {
        username: options.username,
        readyTimeout: readyTimeout || 20000,
        keepaliveInterval: keepaliveInterval,
        keepaliveCountMax: options.keepaliveCountMax || 3,
        hostVerifier: (key: Buffer, callback: (permitted: boolean) => void) => {
          if (settings.security.verifyHostKey === false) {
            callback(true)
            return
          }

          if (
            knownHostsManager.isTrustedHostKey(
              options.host,
              options.port,
              key,
              options.trustedHostKey
            )
          ) {
            knownHostsManager.addHost(
              options.host,
              options.port,
              options.trustedHostKey?.keyType,
              key
            )
            callback(true)
            return
          }

          const verifyResult = knownHostsManager.verifyHost(
            options.host,
            options.port,
            undefined,
            key
          )

          if (verifyResult === 'trusted') {
            callback(true)
            return
          }

          hostKeyChallenge = knownHostsManager.createChallenge(
            options.host,
            options.port,
            undefined,
            key,
            verifyResult
          )

          if (verifyResult === 'changed') {
            const receivedFingerprint = getHostKeyFingerprint(key)
            const knownHost = knownHostsManager.getHost(options.host, options.port)
            console.error(
              `[KnownHosts] Host key mismatch for ${options.host}:${options.port}. Known=${knownHost?.fingerprint}, received=${receivedFingerprint}`
            )
          }

          callback(false)
        }
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

      const startClient = () => {
        if (connectSettled) return
        try {
          client.connect({ ...connectConfig, sock: socket })
        } catch (error) {
          rejectWhileConnecting(error instanceof Error ? error : new Error(String(error)))
        }
      }
      const initializeTransport = async () => {
        const attempt = { timeoutMs, signal: controller.signal }
        if (options.proxyJump?.enabled) {
          socket = await ProxyJumpHelper.connectThroughProxy(
            options.proxyJump,
            options.host,
            options.port,
            options.proxy,
            attempt
          )
        } else if (options.proxy?.enabled) {
          socket = await ProxyHelper.connect(options.proxy, options.host, options.port, attempt)
        } else {
          socket = new net.Socket()
        }
        if (connectSettled || this.connections.get(id) !== connection) {
          socket.destroy()
          return
        }
        connection.socket = socket
        if ('setNoDelay' in socket) socket.setNoDelay(true)
        socket.on('error', (error: Error) => {
          if (this.connections.get(id) !== connection) return
          if (rejectHostKeyChallenge()) return
          const appError = ErrorHandler.handle(error, `SSH Connection ${id}`)
          connection.lastError = appError.userMessage
          connection.lastErrorCode = (error as NodeJS.ErrnoException).code
          rejectWhileConnecting(appError)
          this.emit('error', id, appError.userMessage)
        })
        socket.on('close', (hadError?: boolean) => {
          connection.lastSocketCloseHadError = hadError === true
          if (!connectSettled) {
            rejectWhileConnecting(new Error('SSH 传输在连接完成前关闭'))
          } else {
            client.destroy()
          }
        })
        if (options.proxyJump?.enabled || options.proxy?.enabled) {
          this.emit(
            'proxy-connected',
            id,
            options.proxyJump?.enabled
              ? ProxyJumpHelper.getProxyChainDescription(options.proxyJump)
              : `Via ${options.proxy!.type.toUpperCase()} Proxy`
          )
          startClient()
        } else {
          // This branch always owns a real TCP socket.
          ;(socket as net.Socket).connect(options.port, options.host, startClient)
        }
      }
      // An async Promise executor would lose exceptions here and leave IPC pending forever.
      void initializeTransport().catch((error) => {
        rejectWhileConnecting(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /**
   * 断开 SSH 连接
   */
  async disconnect(id: string, reason: SSHCloseSource = 'manual'): Promise<void> {
    const connection = this.connections.get(id)
    if (!connection) {
      console.warn(`Attempted to disconnect non-existent session: ${id}`)
      return
    }

    connection.manualDisconnect = true
    connection.manualDisconnectReason = reason
    connection.cancelConnect?.()

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
    this.emitClientClosed(id, connection.client)
  }

  /**
   * 'client-closed' (id, client)：某个连接的 SSH Client 已关闭或被替换（断开/自动重连）。
   * 依附于该 Client 的通道（SFTP 等）应当立即关闭，否则其上的请求不会再回调。
   * 携带 client 实例，监听方可据此判断是否仍是自己绑定的那个 Client。
   */
  private emitClientClosed(id: string, client: Client): void {
    try {
      this.emit('client-closed', id, client)
    } catch (error) {
      console.error(`[SSHConnectionManager] client-closed listener failed for ${id}:`, error)
    }
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
  async executeCommand(
    id: string,
    command: string,
    timeout: number = 5000,
    maxOutputBytes?: number,
    stdin?: string
  ): Promise<string> {
    const result = await this.executeCommandDetailed(
      id,
      command,
      timeout,
      maxOutputBytes ?? 8 * 1024 * 1024,
      stdin
    )
    if (result.exitCode !== 0)
      throw new Error(
        `Command failed with code ${result.exitCode}: ${result.stderr || result.stdout}`
      )
    return result.stdout
  }
  /**
   * 执行命令并分别返回 stdout、stderr 和退出码；非 0 退出码不视为失败。
   * signal 中止时会关闭远程通道。
   */
  async executeCommandDetailed(
    id: string,
    command: string,
    timeout: number,
    maxOutputBytes: number,
    stdin?: string,
    signal?: AbortSignal
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; signal?: string }> {
    return new Promise((resolve, reject) => {
      const connection = this.connections.get(id)
      if (!connection || !connection.client) {
        reject(new Error(`Connection not found: ${id}`))
        return
      }
      if (signal?.aborted) {
        reject(new Error('Command cancelled'))
        return
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let outputBytes = 0
      let settled = false
      let timeoutHandle: NodeJS.Timeout | undefined
      let channel: { close: () => void; signal?: (signal: string) => void } | undefined

      const cleanup = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        signal?.removeEventListener('abort', onAbort)
        connection.client.removeListener('close', onClose)
      }
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
        try {
          channel?.signal?.('TERM')
        } catch {}
        try {
          channel?.close()
        } catch {}
      }
      function onAbort() {
        rejectOnce(new Error('Command cancelled'))
      }
      function onClose() {
        rejectOnce(new Error('SSH connection closed'))
      }

      connection.client.once('close', onClose)
      signal?.addEventListener('abort', onAbort, { once: true })
      timeoutHandle = setTimeout(() => {
        rejectOnce(new Error(`Command execution timed out after ${timeout} ms`))
      }, timeout)

      try {
        connection.client.exec(command, (err, stream) => {
          if (err) {
            rejectOnce(err)
            return
          }
          if (settled) {
            stream.on('error', () => {})
            try {
              stream.signal('TERM')
            } catch {}
            try {
              stream.close()
            } catch {}
            return
          }
          channel = stream

          const appendOutput = (data: Buffer, target: Buffer[]) => {
            if (settled) return
            outputBytes += data.length
            if (outputBytes > maxOutputBytes) {
              rejectOnce(new Error(`Command output exceeded limit of ${maxOutputBytes} bytes`))
              return
            }
            target.push(data)
          }

          stream.on('data', (data: Buffer) => appendOutput(data, stdoutChunks))
          stream.stderr.on('data', (data: Buffer) => appendOutput(data, stderrChunks))
          stream.on('close', (code: number | null, exitSignal?: string) => {
            if (settled) return
            settled = true
            cleanup()
            connection.lastActivity = new Date()
            resolve({
              stdout: Buffer.concat(stdoutChunks).toString('utf8'),
              stderr: Buffer.concat(stderrChunks).toString('utf8'),
              exitCode: typeof code === 'number' ? code : null,
              ...(exitSignal ? { signal: exitSignal } : {})
            })
          })
          stream.on('error', (error: Error) => rejectOnce(error))

          if (stdin !== undefined) stream.end(stdin)
        })
      } catch (error) {
        rejectOnce(error instanceof Error ? error : new Error(String(error)))
      }
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
            this.disconnect(id, 'timeout').catch((err) => {
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

  private createCloseDetails(
    connection: SSHConnection,
    source: SSHCloseSource,
    reason: string,
    reconnecting = false
  ): SSHCloseDetails {
    const socket =
      connection.socket && 'remoteAddress' in connection.socket ? connection.socket : undefined
    const socketInfo = socket
      ? {
          destroyed: socket.destroyed,
          connecting: socket.connecting,
          readyState: socket.readyState,
          bytesRead: socket.bytesRead,
          bytesWritten: socket.bytesWritten,
          localAddress: socket.localAddress,
          localPort: socket.localPort,
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort
        }
      : undefined

    return {
      source,
      reason,
      statusBefore: connection.status,
      lastActivity: connection.lastActivity.toISOString(),
      closedAt: new Date().toISOString(),
      hadError: connection.lastSocketCloseHadError,
      errorMessage: connection.lastError,
      errorCode: connection.lastErrorCode,
      reconnecting,
      socket: socketInfo
    }
  }

  private emitCloseOnce(
    id: string,
    connection: SSHConnection,
    source: SSHCloseSource,
    reason: string,
    reconnecting = false
  ): boolean {
    const details = this.createCloseDetails(connection, source, reason, reconnecting)
    connection.lastCloseDetails = details

    if (connection.closeEmitted) {
      console.warn(
        `[SSHConnectionManager] Duplicate close suppressed for session ${id}: ${source} - ${reason}`
      )
      return false
    }

    connection.closeEmitted = true
    connection.status = 'disconnected'
    this.stopSessionMonitor(id)
    this.emit('close', id, details)
    return true
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(id: string): void {
    const connection = this.connections.get(id)
    if (!connection) return

    if (!connection.maxReconnectAttempts || connection.maxReconnectAttempts <= 0) {
      console.log(`Reconnect disabled for session ${id}`)
      return
    }

    // 检查是否超过最大重连次数
    if (connection.reconnectAttempts! >= connection.maxReconnectAttempts!) {
      console.log(`Max reconnect attempts reached for session ${id}`)
      connection.status = 'error'
      this.emit('reconnect-failed', id, '已达到最大重连次数')
      return
    }

    // 清理旧的重连定时器
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer)
    }

    connection.status = 'reconnecting'
    connection.reconnectAttempts = (connection.reconnectAttempts || 0) + 1

    console.log(
      `Attempting to reconnect session ${id} (attempt ${connection.reconnectAttempts}/${connection.maxReconnectAttempts})`
    )
    this.emit('reconnecting', id, connection.reconnectAttempts, connection.maxReconnectAttempts)

    // 延迟重连
    connection.reconnectTimer = setTimeout(async () => {
      connection.reconnectTimer = undefined
      if (connection.manualDisconnect || this.connections.get(id) !== connection) return
      let attempt: SSHConnection | undefined
      try {
        // 先清理旧连接
        if (connection.stream) {
          connection.stream.removeAllListeners()
          connection.stream.end()
        }
        if (connection.client) {
          connection.client.end()
        }
        if (connection.socket) {
          connection.socket.destroy()
        }

        // 从 Map 中移除旧连接，让 connect() 创建全新的连接对象
        this.connections.delete(id)

        // 尝试重新连接
        const reconnect = this.connect(id, connection.options)
        attempt = this.connections.get(id)
        await reconnect
        if (!attempt || attempt.manualDisconnect || this.connections.get(id) !== attempt) return

        // 重连成功，更新新连接对象的计数器
        const newConnection = this.connections.get(id)
        if (newConnection) {
          newConnection.reconnectAttempts = 0
        }
        console.log(`Successfully reconnected session ${id}`)
        this.emit('reconnected', id)
      } catch (error) {
        // A cancelled/replaced attempt must not resurrect an orphan connection.
        if (connection.manualDisconnect || attempt?.manualDisconnect || this.connections.has(id))
          return
        console.error(
          `Reconnect attempt ${connection.reconnectAttempts} failed for session ${id}:`,
          error
        )

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

    if (connection.status === 'connecting' || connection.status === 'reconnecting') {
      connection.manualDisconnect = true
      connection.cancelConnect?.()
      connection.status = 'disconnected'
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
