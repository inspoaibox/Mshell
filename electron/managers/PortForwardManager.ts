import { EventEmitter } from 'node:events'
import { Client } from 'ssh2'
import * as net from 'net'
import { BaseManager } from './BaseManager'

export interface PortForward {
  id: string
  sessionId: string
  connectionId?: string // 旧版本使用的临时终端连接 ID，仅用于兼容旧配置
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  status: 'active' | 'inactive' | 'error'
  error?: string
  description?: string
  autoStart?: boolean // 自动启动
  templateId?: string // 关联的模板ID
  createdAt: string
  updatedAt: string
}

export interface PortForwardTemplate {
  id: string
  name: string
  description: string
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  autoStart: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface TrafficStats {
  forwardId: string
  bytesIn: number
  bytesOut: number
  connectionsTotal: number
  connectionsActive: number
  lastActivity: string
  startTime: string
}

interface RemoteForwardRuntime {
  sshClient: Client
  remoteHost: string
  remotePort: number
  listener: (info: any, accept: any, reject?: any) => void
}

type PortForwardCreateData = Omit<PortForward, 'id' | 'createdAt' | 'updatedAt' | 'status'> &
  Partial<Pick<PortForward, 'id' | 'createdAt' | 'updatedAt' | 'status'>>

const getForwardSessionId = (forward: Pick<PortForward, 'sessionId' | 'connectionId'>) =>
  forward.sessionId || forward.connectionId || ''

/**
 * PortForwardConfigManager - 管理端口转发配置持久化
 */
class PortForwardConfigManager extends BaseManager<PortForward> {
  constructor() {
    super('port-forwards.json')
  }

  protected serialize(item: PortForward): any {
    const { connectionId, error, ...config } = item
    return {
      ...config,
      status: 'inactive'
    }
  }

  protected deserialize(data: any): PortForward {
    const { error, ...config } = data
    return {
      ...config,
      sessionId: data.sessionId || data.connectionId || '',
      status: 'inactive'
    }
  }

  /**
   * 创建端口转发配置
   */
  async createForward(data: PortForwardCreateData): Promise<PortForward> {
    const now = new Date().toISOString()
    const forward: PortForward = {
      ...data,
      id: data.id || `forward-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: data.status === 'active' ? 'inactive' : data.status || 'inactive',
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now
    }
    return await this.create(forward)
  }

  /**
   * 获取自动启动的转发
   */
  getAutoStartForwards(sessionId?: string): PortForward[] {
    let forwards = this.getAll().filter(f => f.autoStart)
    if (sessionId) {
      forwards = forwards.filter(f => getForwardSessionId(f) === sessionId)
    }
    return forwards
  }
}

/**
 * PortForwardTemplateManager - 管理端口转发模板
 */
class PortForwardTemplateManager extends BaseManager<PortForwardTemplate> {
  constructor() {
    super('port-forward-templates.json')
  }

  /**
   * 创建模板
   */
  async createTemplate(data: Omit<PortForwardTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<PortForwardTemplate> {
    const now = new Date().toISOString()
    const template: PortForwardTemplate = {
      ...data,
      id: data.id || `template-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: now,
      updatedAt: now
    }
    return await this.create(template)
  }

  /**
   * 按标签获取模板
   */
  getByTag(tag: string): PortForwardTemplate[] {
    return this.getAll().filter(t => t.tags.includes(tag))
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): PortForwardTemplate[] {
    return this.search(query, ['name', 'description'])
  }
}

/**
 * PortForwardManager - 管理端口转发
 */
export class PortForwardManager extends EventEmitter {
  private forwards: Map<string, PortForward>
  private servers: Map<string, net.Server>
  private sshClients: Map<string, Client>
  private remoteForwards: Map<string, RemoteForwardRuntime>
  private forwardConnectionIds: Map<string, string>
  private trafficStats: Map<string, TrafficStats>
  private configManager: PortForwardConfigManager
  private templateManager: PortForwardTemplateManager
  private initialized: boolean
  private initializePromise?: Promise<void>

  constructor() {
    super()
    this.forwards = new Map()
    this.servers = new Map()
    this.sshClients = new Map()
    this.remoteForwards = new Map()
    this.forwardConnectionIds = new Map()
    this.trafficStats = new Map()
    this.configManager = new PortForwardConfigManager()
    this.templateManager = new PortForwardTemplateManager()
    this.initialized = false

    this.initialize().catch(console.error)
  }

  /**
   * 初始化 - 加载持久化的转发配置
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializePromise) return this.initializePromise

    this.initializePromise = (async () => {
      await this.configManager.initialize()
      await this.templateManager.initialize()

      this.forwards.clear()
      const configs = this.configManager.getAll()
      for (const config of configs) {
        config.status = 'inactive'
        delete config.error
        config.sessionId = getForwardSessionId(config)
        this.forwards.set(config.id, config)
      }

      this.initialized = true
    })()

    return this.initializePromise
  }

  /**
   * 初始化流量统计
   */
  private initTrafficStats(forwardId: string): void {
    if (!this.trafficStats.has(forwardId)) {
      this.trafficStats.set(forwardId, {
        forwardId,
        bytesIn: 0,
        bytesOut: 0,
        connectionsTotal: 0,
        connectionsActive: 0,
        lastActivity: new Date().toISOString(),
        startTime: new Date().toISOString()
      })
    }
  }

  /**
   * 更新流量统计
   */
  private updateTrafficStats(forwardId: string, bytesIn: number, bytesOut: number): void {
    const stats = this.trafficStats.get(forwardId)
    if (stats) {
      stats.bytesIn += bytesIn
      stats.bytesOut += bytesOut
      stats.lastActivity = new Date().toISOString()
      this.emit('traffic', forwardId, stats)
    }
  }

  /**
   * 增加连接计数
   */
  private incrementConnection(forwardId: string): void {
    const stats = this.trafficStats.get(forwardId)
    if (stats) {
      stats.connectionsTotal++
      stats.connectionsActive++
    }
  }

  /**
   * 减少连接计数
   */
  private decrementConnection(forwardId: string): void {
    const stats = this.trafficStats.get(forwardId)
    if (stats) {
      stats.connectionsActive = Math.max(0, stats.connectionsActive - 1)
    }
  }

  /**
   * 添加转发配置 (不启动)
   */
  async addForward(forward: PortForwardCreateData): Promise<PortForward> {
    await this.initialize()
    const created = await this.configManager.createForward(forward)
    this.forwards.set(created.id, created)
    return created
  }

  /**
   * 设置本地端口转发
   */
  async setupLocalForward(
    id: string,
    sessionId: string,
    connectionId: string,
    sshClient: Client,
    localHost: string,
    localPort: number,
    remoteHost: string,
    remotePort: number
  ): Promise<void> {
    await this.initialize()

    return new Promise((resolve, reject) => {
      // 获取现有的转发配置或创建新的
      let forward = this.forwards.get(id)
      if (!forward) {
        forward = {
          id,
          sessionId,
          type: 'local',
          localHost,
          localPort,
          remoteHost,
          remotePort,
          status: 'inactive',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        this.forwards.set(id, forward)
      } else {
        forward.sessionId = forward.sessionId || sessionId || forward.connectionId || connectionId
      }

      if (this.servers.has(id)) {
        forward.status = 'active'
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        resolve()
        return
      }

      // 初始化流量统计
      this.initTrafficStats(id)

      const server = net.createServer((socket) => {
        this.incrementConnection(id)

        let bytesIn = 0
        let bytesOut = 0

        sshClient.forwardOut(
          socket.remoteAddress || '127.0.0.1',
          socket.remotePort || 0,
          remoteHost,
          remotePort,
          (err, stream) => {
            if (err) {
              socket.end()
              this.decrementConnection(id)
              this.emit('error', id, err.message)
              return
            }

            // 监听数据流量
            socket.on('data', (chunk: Buffer) => {
              bytesIn += chunk.length
            })

            stream.on('data', (chunk: Buffer) => {
              bytesOut += chunk.length
            })

            socket.pipe(stream).pipe(socket)

            socket.on('error', (err: Error) => {
              console.error('Socket error:', err)
            })

            stream.on('error', (err: Error) => {
              console.error('Stream error:', err)
            })

            socket.on('close', () => {
              this.decrementConnection(id)
              this.updateTrafficStats(id, bytesIn, bytesOut)
            })
          }
        )
      })

      server.on('error', async (err: Error) => {
        if (forward) {
          forward.status = 'error'
          forward.error = err.message
          await this.configManager.update(id, { sessionId: forward.sessionId })
        }
        this.forwardConnectionIds.delete(id)
        this.emit('error', id, err.message)
        reject(err)
      })

      server.listen(localPort, localHost, async () => {
        if (forward) {
          forward.status = 'active'
          await this.configManager.update(id, { sessionId: forward.sessionId })
        }
        this.servers.set(id, server)
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        this.emit('active', id)
        resolve()
      })
    })
  }

  /**
   * 设置远程端口转发
   */
  async setupRemoteForward(
    id: string,
    sessionId: string,
    connectionId: string,
    sshClient: Client,
    remoteHost: string,
    remotePort: number,
    localHost: string,
    localPort: number
  ): Promise<void> {
    await this.initialize()

    return new Promise((resolve, reject) => {
      let forward = this.forwards.get(id)
      if (!forward) {
        forward = {
          id,
          sessionId,
          type: 'remote',
          localHost,
          localPort,
          remoteHost,
          remotePort,
          status: 'inactive',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        this.forwards.set(id, forward)
      } else {
        forward.sessionId = forward.sessionId || sessionId || forward.connectionId || connectionId
      }

      if (this.remoteForwards.has(id)) {
        forward.status = 'active'
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        resolve()
        return
      }

      this.initTrafficStats(id)

      const tcpConnectionHandler = (info: any, accept: any, rejectConnection?: any) => {
        if (Number(info?.destPort) !== remotePort) {
          return
        }

        const destIP = String(info?.destIP || '')
        const normalizedRemoteHost = remoteHost === 'localhost' ? '127.0.0.1' : remoteHost
        const normalizedDestIP =
          destIP === '::1' || destIP === '::ffff:127.0.0.1' ? '127.0.0.1' : destIP
        const hostMatches =
          !destIP ||
          remoteHost === '0.0.0.0' ||
          remoteHost === '::' ||
          normalizedRemoteHost === normalizedDestIP ||
          (remoteHost === 'localhost' && normalizedDestIP === '127.0.0.1') ||
          net.isIP(remoteHost) === 0

        if (!hostMatches) {
          return
        }

        this.incrementConnection(id)

        let bytesIn = 0
        let bytesOut = 0
        const stream = accept()
        const socket = net.connect(localPort, localHost)

        stream.on('data', (chunk: Buffer) => {
          bytesIn += chunk.length
        })

        socket.on('data', (chunk: Buffer) => {
          bytesOut += chunk.length
        })

        socket.pipe(stream).pipe(socket)

        socket.on('error', (err: Error) => {
          console.error('Socket error:', err)
          if (typeof rejectConnection === 'function') {
            try {
              rejectConnection()
            } catch {}
          }
        })

        stream.on('error', (err: Error) => {
          console.error('Stream error:', err)
        })

        stream.on('close', () => {
          this.decrementConnection(id)
          this.updateTrafficStats(id, bytesIn, bytesOut)
        })
      }

      sshClient.forwardIn(remoteHost, remotePort, (err) => {
        if (err) {
          if (forward) {
            forward.status = 'error'
            forward.error = err.message
          }
          sshClient.removeListener('tcp connection', tcpConnectionHandler)
          this.forwardConnectionIds.delete(id)
          this.emit('error', id, err.message)
          reject(err)
          return
        }

        if (forward) {
          forward.status = 'active'
          this.configManager.update(id, { sessionId: forward.sessionId }).catch(console.error)
        }
        this.remoteForwards.set(id, {
          sshClient,
          remoteHost,
          remotePort,
          listener: tcpConnectionHandler
        })
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        this.emit('active', id)
        resolve()
      })

      sshClient.on('tcp connection', tcpConnectionHandler)
    })
  }

  /**
   * 设置动态端口转发 (SOCKS5)
   */
  async setupDynamicForward(
    id: string,
    sessionId: string,
    connectionId: string,
    sshClient: Client,
    localHost: string,
    localPort: number
  ): Promise<void> {
    await this.initialize()

    return new Promise((resolve, reject) => {
      let forward = this.forwards.get(id)
      if (!forward) {
        forward = {
          id,
          sessionId,
          type: 'dynamic',
          localHost,
          localPort,
          remoteHost: '',
          remotePort: 0,
          status: 'inactive',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
        this.forwards.set(id, forward)
      } else {
        forward.sessionId = forward.sessionId || sessionId || forward.connectionId || connectionId
      }

      if (this.servers.has(id)) {
        forward.status = 'active'
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        resolve()
        return
      }

      this.initTrafficStats(id)

      const server = net.createServer((socket) => {
        // Simple SOCKS5 implementation
        socket.once('data', (data) => {
          // SOCKS5 handshake
          if (data[0] === 0x05) {
            socket.write(Buffer.from([0x05, 0x00]))

            socket.once('data', (data) => {
              const cmd = data[1]
              const atyp = data[3]

              let remoteHost: string
              let remotePort: number

              if (atyp === 0x01) {
                // IPv4
                remoteHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`
                remotePort = data.readUInt16BE(8)
              } else if (atyp === 0x03) {
                // Domain name
                const len = data[4]
                remoteHost = data.subarray(5, 5 + len).toString()
                remotePort = data.readUInt16BE(5 + len)
              } else {
                socket.end()
                return
              }

              if (cmd === 0x01) {
                // CONNECT
                sshClient.forwardOut(
                  socket.remoteAddress || '127.0.0.1',
                  socket.remotePort || 0,
                  remoteHost,
                  remotePort,
                  (err, stream) => {
                    if (err) {
                      socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
                      socket.end()
                      return
                    }

                    socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
                    socket.pipe(stream).pipe(socket)
                  }
                )
              }
            })
          }
        })
      })

      server.on('error', (err: Error) => {
        if (forward) {
          forward.status = 'error'
          forward.error = err.message
        }
        this.forwardConnectionIds.delete(id)
        this.emit('error', id, err.message)
        reject(err)
      })

      server.listen(localPort, localHost, async () => {
        if (forward) {
          forward.status = 'active'
          await this.configManager.update(id, { sessionId: forward.sessionId })
        }
        this.servers.set(id, server)
        this.sshClients.set(id, sshClient)
        this.forwardConnectionIds.set(id, connectionId)
        this.emit('active', id)
        resolve()
      })
    })
  }

  /**
   * 停止端口转发
   */
  async stopForward(id: string): Promise<void> {
    await this.initialize()

    const forward = this.forwards.get(id)
    if (!forward) {
      throw new Error(`Forward not found: ${id}`)
    }

    const server = this.servers.get(id)
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      this.servers.delete(id)
    }

    const remoteForward = this.remoteForwards.get(id)
    if (remoteForward) {
      remoteForward.sshClient.removeListener('tcp connection', remoteForward.listener)
      await new Promise<void>((resolve) => {
        remoteForward.sshClient.unforwardIn(
          remoteForward.remoteHost,
          remoteForward.remotePort,
          (err) => {
            if (err) {
              console.warn(`Failed to cancel remote forward ${id}:`, err.message)
            }
            resolve()
          }
        )
      })
      this.remoteForwards.delete(id)
    }

    forward.status = 'inactive'
    await this.configManager.update(id, { status: 'inactive' })
    this.sshClients.delete(id)
    this.forwardConnectionIds.delete(id)
    this.emit('inactive', id)
  }

  /**
   * 停止指定 SSH 运行连接上的所有转发
   */
  async stopForwardsByConnection(connectionId: string): Promise<void> {
    await this.initialize()

    const forwardIds = Array.from(this.forwardConnectionIds.entries())
      .filter(([, runtimeConnectionId]) => runtimeConnectionId === connectionId)
      .map(([forwardId]) => forwardId)

    for (const forwardId of forwardIds) {
      try {
        await this.stopForward(forwardId)
      } catch (error) {
        console.error(`Failed to stop forward ${forwardId} for connection ${connectionId}:`, error)
      }
    }
  }

  /**
   * 获取端口转发
   */
  getForward(id: string): PortForward | undefined {
    return this.forwards.get(id)
  }

  /**
   * 获取所有端口转发
   */
  getAllForwards(sessionId?: string): PortForward[] {
    const all = Array.from(this.forwards.values())
    if (sessionId) {
      return all.filter(f => getForwardSessionId(f) === sessionId)
    }
    return all
  }

  /**
   * 更新端口转发配置
   */
  async updateForward(id: string, updates: Partial<PortForward>): Promise<void> {
    await this.initialize()

    const forward = this.forwards.get(id)
    if (!forward) {
      throw new Error(`Forward not found: ${id}`)
    }

    // 运行状态变化不算配置修改，避免影响云同步的修改时间比较
    const runtimeOnly = Object.keys(updates).every((key) =>
      ['status', 'error', 'connectionId'].includes(key)
    )
    const configUpdates = runtimeOnly
      ? updates
      : { ...updates, updatedAt: new Date().toISOString() }
    Object.assign(forward, configUpdates)
    await this.configManager.update(id, configUpdates)
  }

  /**
   * 云同步原样写入端口转发配置（运行中的转发会先停止）
   */
  async syncUpsertForward(raw: any): Promise<void> {
    await this.initialize()
    if (!raw?.id) return

    if (this.servers.has(raw.id) || this.remoteForwards.has(raw.id)) {
      await this.stopForward(raw.id).catch(() => {})
    }

    const { error: _error, connectionId: _connectionId, ...config } = raw
    const forward: PortForward = {
      ...config,
      sessionId: getForwardSessionId(raw),
      status: 'inactive'
    }
    await this.configManager.syncPut(forward)
    this.forwards.set(forward.id, this.configManager.get(forward.id) || forward)
  }

  /**
   * 云同步删除端口转发配置（不存在时忽略）
   */
  async syncRemoveForward(id: string): Promise<void> {
    await this.initialize()
    if (!this.forwards.has(id)) {
      await this.configManager.syncRemove(id)
      return
    }
    await this.deleteForward(id)
  }

  /**
   * 删除端口转发
   */
  async deleteForward(id: string): Promise<void> {
    await this.initialize()

    await this.stopForward(id).catch(() => { }) // Ignore error if already stopped
    this.forwards.delete(id)
    await this.configManager.delete(id)
  }

  /**
   * 获取自动启动的转发
   */
  getAutoStartForwards(sessionId?: string): PortForward[] {
    return this.configManager.getAutoStartForwards(sessionId)
  }

  /**
   * 自动启动转发
   */
  async autoStartForwards(sessionId: string, connectionId: string, sshClient: Client): Promise<void> {
    await this.initialize()

    const autoForwards = this.getAutoStartForwards(sessionId)

    for (const forward of autoForwards) {
      try {
        if (forward.type === 'local') {
          await this.setupLocalForward(
            forward.id,
            sessionId,
            connectionId,
            sshClient,
            forward.localHost,
            forward.localPort,
            forward.remoteHost,
            forward.remotePort
          )
        } else if (forward.type === 'remote') {
          await this.setupRemoteForward(
            forward.id,
            sessionId,
            connectionId,
            sshClient,
            forward.remoteHost,
            forward.remotePort,
            forward.localHost,
            forward.localPort
          )
        } else if (forward.type === 'dynamic') {
          await this.setupDynamicForward(
            forward.id,
            sessionId,
            connectionId,
            sshClient,
            forward.localHost,
            forward.localPort
          )
        }
      } catch (error) {
        console.error(`Failed to auto-start forward ${forward.id}:`, error)
      }
    }
  }

  /**
   * 获取流量统计
   */
  getTrafficStats(forwardId: string): TrafficStats | undefined {
    return this.trafficStats.get(forwardId)
  }

  /**
   * 获取所有流量统计
   */
  getAllTrafficStats(): TrafficStats[] {
    return Array.from(this.trafficStats.values())
  }

  /**
   * 重置流量统计
   */
  resetTrafficStats(forwardId: string): void {
    const stats = this.trafficStats.get(forwardId)
    if (stats) {
      stats.bytesIn = 0
      stats.bytesOut = 0
      stats.connectionsTotal = 0
      stats.startTime = new Date().toISOString()
    }
  }

  // ========== 模板管理 ==========

  /**
   * 创建转发模板
   */
  async createTemplate(data: Omit<PortForwardTemplate, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<PortForwardTemplate> {
    return await this.templateManager.createTemplate(data)
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): PortForwardTemplate[] {
    return this.templateManager.getAll()
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): PortForwardTemplate | undefined {
    return this.templateManager.get(id)
  }

  /**
   * 更新模板
   */
  async updateTemplate(id: string, updates: Partial<PortForwardTemplate>): Promise<void> {
    await this.templateManager.update(id, { ...updates, updatedAt: new Date().toISOString() })
  }

  /**
   * 云同步原样写入模板
   */
  async syncUpsertTemplate(raw: any): Promise<void> {
    await this.initialize()
    await this.templateManager.syncPut(raw)
  }

  /**
   * 云同步删除模板（不存在时忽略）
   */
  async syncRemoveTemplate(id: string): Promise<void> {
    await this.initialize()
    await this.templateManager.syncRemove(id)
  }

  /**
   * 删除模板
   */
  async deleteTemplate(id: string): Promise<void> {
    await this.templateManager.delete(id)
  }

  /**
   * 按标签获取模板
   */
  getTemplatesByTag(tag: string): PortForwardTemplate[] {
    return this.templateManager.getByTag(tag)
  }

  /**
   * 搜索模板
   */
  searchTemplates(query: string): PortForwardTemplate[] {
    return this.templateManager.searchTemplates(query)
  }

  /**
   * 从模板创建转发
   */
  async createForwardFromTemplate(
    templateId: string,
    sessionId: string
  ): Promise<PortForward> {
    const template = this.templateManager.get(templateId)
    if (!template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    return await this.addForward({
      sessionId,
      type: template.type,
      localHost: template.localHost,
      localPort: template.localPort,
      remoteHost: template.remoteHost,
      remotePort: template.remotePort,
      description: template.description,
      autoStart: template.autoStart,
      templateId: template.id
    })
  }
}

// 导出单例实例
export const portForwardManager = new PortForwardManager()
