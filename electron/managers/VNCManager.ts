/**
 * VNC 连接管理器
 * 提供 WebSocket → TCP 代理，让 noVNC 可以连接到 VNC 服务器
 */

import { EventEmitter } from 'events'
import { WebSocketServer, WebSocket } from 'ws'
import { createServer as createHttpServer, Server as HttpServer } from 'http'
import * as net from 'net'

export interface VNCConnectionConfig {
  id: string
  host: string
  port?: number  // 默认 5900
  password?: string
  // VNC 选项
  viewOnly?: boolean
  quality?: number
  compression?: number
  localCursor?: boolean
  sharedConnection?: boolean
}

interface VNCConnection {
  id: string
  config: VNCConnectionConfig
  wsServer: WebSocketServer | null
  httpServer: HttpServer | null
  wsPort: number
  tcpSocket: net.Socket | null
  wsClient: WebSocket | null
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  startTime: Date
}

class VNCManager extends EventEmitter {
  private connections = new Map<string, VNCConnection>()
  private portRange = { min: 15900, max: 15999 }
  private usedPorts = new Set<number>()

  constructor() {
    super()
  }

  /**
   * 获取一个可用的端口
   */
  private getAvailablePort(): number {
    for (let port = this.portRange.min; port <= this.portRange.max; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port)
        return port
      }
    }
    throw new Error('No available ports for VNC proxy')
  }

  /**
   * 释放端口
   */
  private releasePort(port: number): void {
    this.usedPorts.delete(port)
  }

  /**
   * 创建 VNC 连接（启动 WebSocket 代理）
   */
  async connect(config: VNCConnectionConfig): Promise<{ success: boolean; wsPort?: number; error?: string }> {
    try {
      // 检查是否已存在连接
      if (this.connections.has(config.id)) {
        const existing = this.connections.get(config.id)!
        if (existing.status === 'connected' || existing.status === 'connecting') {
          return { success: true, wsPort: existing.wsPort }
        }
        // 清理旧连接
        await this.disconnect(config.id)
      }

      const wsPort = this.getAvailablePort()
      const vncHost = config.host
      const vncPort = config.port || 5900

      console.log(`[VNCManager] Starting WebSocket proxy on port ${wsPort} for ${vncHost}:${vncPort}`)

      // 创建 HTTP 服务器
      const httpServer = createHttpServer()
      
      // 创建 WebSocket 服务器
      const wsServer = new WebSocketServer({ 
        server: httpServer,
        // 支持二进制数据
        perMessageDeflate: false
      })

      // 创建连接记录
      const connection: VNCConnection = {
        id: config.id,
        config,
        wsServer,
        httpServer,
        wsPort,
        tcpSocket: null,
        wsClient: null,
        status: 'connecting',
        startTime: new Date()
      }

      this.connections.set(config.id, connection)

      // 处理 WebSocket 连接
      wsServer.on('connection', (ws: WebSocket) => {
        console.log(`[VNCManager] WebSocket client connected for ${config.id}`)
        connection.wsClient = ws

        // 连接到 VNC 服务器
        const tcpSocket = net.createConnection({
          host: vncHost,
          port: vncPort
        })

        connection.tcpSocket = tcpSocket

        tcpSocket.on('connect', () => {
          console.log(`[VNCManager] Connected to VNC server ${vncHost}:${vncPort}`)
          connection.status = 'connected'
          this.emit('connected', config.id)
        })

        tcpSocket.on('data', (data: Buffer) => {
          // 将 VNC 服务器数据转发到 WebSocket
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        })

        tcpSocket.on('error', (error: Error) => {
          console.error(`[VNCManager] TCP error for ${config.id}:`, error.message)
          connection.status = 'error'
          this.emit('error', config.id, error.message)
          ws.close()
        })

        tcpSocket.on('close', () => {
          console.log(`[VNCManager] TCP connection closed for ${config.id}`)
          connection.status = 'disconnected'
          this.emit('disconnected', config.id)
          ws.close()
        })

        // 处理 WebSocket 消息
        ws.on('message', (data: Buffer) => {
          // 将 WebSocket 数据转发到 VNC 服务器
          if (tcpSocket.writable) {
            tcpSocket.write(data)
          }
        })

        ws.on('close', () => {
          console.log(`[VNCManager] WebSocket client disconnected for ${config.id}`)
          if (tcpSocket && !tcpSocket.destroyed) {
            tcpSocket.destroy()
          }
        })

        ws.on('error', (error: Error) => {
          console.error(`[VNCManager] WebSocket error for ${config.id}:`, error.message)
          if (tcpSocket && !tcpSocket.destroyed) {
            tcpSocket.destroy()
          }
        })
      })

      // 启动 HTTP 服务器
      await new Promise<void>((resolve, reject) => {
        httpServer.listen(wsPort, '127.0.0.1', () => {
          console.log(`[VNCManager] WebSocket proxy listening on ws://127.0.0.1:${wsPort}`)
          resolve()
        })
        httpServer.on('error', reject)
      })

      return { success: true, wsPort }
    } catch (error: any) {
      console.error('[VNCManager] Failed to start proxy:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 断开 VNC 连接
   */
  async disconnect(connectionId: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return { success: false, error: '连接不存在' }
    }

    try {
      console.log(`[VNCManager] Disconnecting ${connectionId}`)

      // 关闭 TCP 连接
      if (connection.tcpSocket && !connection.tcpSocket.destroyed) {
        connection.tcpSocket.destroy()
      }

      // 关闭 WebSocket 客户端
      if (connection.wsClient) {
        connection.wsClient.close()
      }

      // 关闭 WebSocket 服务器
      if (connection.wsServer) {
        connection.wsServer.close()
      }

      // 关闭 HTTP 服务器
      if (connection.httpServer) {
        connection.httpServer.close()
      }

      // 释放端口
      this.releasePort(connection.wsPort)

      // 移除连接记录
      this.connections.delete(connectionId)

      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(connectionId: string): VNCConnection | null {
    return this.connections.get(connectionId) || null
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): VNCConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * 清理所有连接
   */
  async destroyAll(): Promise<void> {
    for (const connectionId of this.connections.keys()) {
      await this.disconnect(connectionId)
    }
  }
}

// 导出单例
export const vncManager = new VNCManager()
