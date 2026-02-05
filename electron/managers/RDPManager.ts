/**
 * RDP 连接管理器
 * 通过调用系统 RDP 客户端 (mstsc.exe) 实现远程桌面连接
 */

import { spawn, ChildProcess } from 'child_process'
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { EventEmitter } from 'events'

export interface RDPConnectionConfig {
  id: string
  host: string
  port?: number
  username?: string
  password?: string
  domain?: string
  // RDP 选项
  width?: number
  height?: number
  fullscreen?: boolean
  multimon?: boolean
  admin?: boolean
  restrictedAdmin?: boolean
  remoteGuard?: boolean
  // 资源重定向
  drives?: boolean
  printers?: boolean
  clipboard?: boolean
  audio?: 'local' | 'remote' | 'none'
  // 显示设置
  colorDepth?: 15 | 16 | 24 | 32
  compression?: boolean
  // 网关
  gateway?: {
    enabled: boolean
    host: string
    port?: number
    username?: string
    password?: string
  }
}

interface RDPConnection {
  id: string
  config: RDPConnectionConfig
  process: ChildProcess | null
  rdpFilePath: string | null
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  startTime: Date
}

class RDPManager extends EventEmitter {
  private connections = new Map<string, RDPConnection>()
  private rdpTempDir: string

  constructor() {
    super()
    // 创建临时目录存放 .rdp 文件
    this.rdpTempDir = join(app.getPath('userData'), 'rdp-temp')
    if (!existsSync(this.rdpTempDir)) {
      mkdirSync(this.rdpTempDir, { recursive: true })
    }
  }

  /**
   * 生成 .rdp 文件内容
   */
  private generateRDPFile(config: RDPConnectionConfig): string {
    const lines: string[] = []

    // 基本连接信息
    lines.push(`full address:s:${config.host}${config.port && config.port !== 3389 ? ':' + config.port : ''}`)
    
    if (config.username) {
      lines.push(`username:s:${config.username}`)
    }
    
    if (config.domain) {
      lines.push(`domain:s:${config.domain}`)
    }

    // 分辨率设置
    if (config.width && config.height) {
      lines.push(`desktopwidth:i:${config.width}`)
      lines.push(`desktopheight:i:${config.height}`)
    }

    // 全屏模式
    if (config.fullscreen) {
      lines.push('screen mode id:i:2')
    } else {
      lines.push('screen mode id:i:1')
    }

    // 多显示器
    if (config.multimon) {
      lines.push('use multimon:i:1')
    }

    // 颜色深度
    if (config.colorDepth) {
      const depthMap: Record<number, number> = { 15: 15, 16: 16, 24: 24, 32: 32 }
      lines.push(`session bpp:i:${depthMap[config.colorDepth] || 32}`)
    }

    // 资源重定向 - 默认禁用驱动器重定向以保护隐私
    if (config.drives === true) {
      lines.push('drivestoredirect:s:*')
    } else {
      lines.push('drivestoredirect:s:')
    }
    
    if (config.printers !== false) {
      lines.push('redirectprinters:i:1')
    } else {
      lines.push('redirectprinters:i:0')
    }
    
    if (config.clipboard !== false) {
      lines.push('redirectclipboard:i:1')
    } else {
      lines.push('redirectclipboard:i:0')
    }

    // 音频重定向
    if (config.audio === 'local') {
      lines.push('audiomode:i:0')
    } else if (config.audio === 'remote') {
      lines.push('audiomode:i:1')
    } else if (config.audio === 'none') {
      lines.push('audiomode:i:2')
    }

    // 压缩
    if (config.compression !== false) {
      lines.push('compression:i:1')
    }

    // 网关设置
    if (config.gateway?.enabled && config.gateway.host) {
      lines.push(`gatewayhostname:s:${config.gateway.host}${config.gateway.port ? ':' + config.gateway.port : ''}`)
      lines.push('gatewayusagemethod:i:1')
      lines.push('gatewayprofileusagemethod:i:1')
      if (config.gateway.username) {
        lines.push(`gatewayusername:s:${config.gateway.username}`)
      }
    }

    // 其他常用设置
    lines.push('autoreconnection enabled:i:1')
    lines.push('authentication level:i:2')
    lines.push('prompt for credentials:i:0')
    lines.push('negotiate security layer:i:1')
    lines.push('remoteapplicationmode:i:0')
    lines.push('alternate shell:s:')
    lines.push('shell working directory:s:')
    lines.push('disable wallpaper:i:0')
    lines.push('disable full window drag:i:0')
    lines.push('disable menu anims:i:0')
    lines.push('disable themes:i:0')
    lines.push('disable cursor setting:i:0')
    lines.push('bitmapcachepersistenable:i:1')

    return lines.join('\r\n')
  }

  /**
   * 连接到 RDP 服务器
   */
  async connect(config: RDPConnectionConfig): Promise<{ success: boolean; error?: string }> {
    try {
      // 检查是否已存在连接
      if (this.connections.has(config.id)) {
        const existing = this.connections.get(config.id)!
        if (existing.status === 'connected' || existing.status === 'connecting') {
          return { success: false, error: '连接已存在' }
        }
        // 清理旧连接
        this.cleanup(config.id)
      }

      // 生成 .rdp 文件
      const rdpContent = this.generateRDPFile(config)
      const rdpFilePath = join(this.rdpTempDir, `${config.id}.rdp`)
      writeFileSync(rdpFilePath, rdpContent, 'utf-8')

      // 构建 mstsc 命令参数
      const args: string[] = [rdpFilePath]
      
      if (config.admin) {
        args.push('/admin')
      }
      
      if (config.restrictedAdmin) {
        args.push('/restrictedAdmin')
      }
      
      if (config.remoteGuard) {
        args.push('/remoteGuard')
      }

      // 启动 mstsc
      const process = spawn('mstsc', args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })

      // 创建连接记录
      const connection: RDPConnection = {
        id: config.id,
        config,
        process,
        rdpFilePath,
        status: 'connecting',
        startTime: new Date()
      }

      this.connections.set(config.id, connection)

      // 监听进程事件
      process.on('spawn', () => {
        connection.status = 'connected'
        this.emit('connected', config.id)
        console.log(`[RDPManager] RDP connection started: ${config.id}`)
      })

      process.on('error', (error) => {
        connection.status = 'error'
        this.emit('error', config.id, error.message)
        console.error(`[RDPManager] RDP connection error: ${config.id}`, error)
      })

      process.on('exit', (code) => {
        connection.status = 'disconnected'
        this.emit('disconnected', config.id, code)
        console.log(`[RDPManager] RDP connection closed: ${config.id}, code: ${code}`)
        
        // 延迟清理 .rdp 文件（给 mstsc 一些时间读取文件）
        setTimeout(() => {
          this.cleanupRdpFile(rdpFilePath)
        }, 5000)
      })

      // 分离进程，让 mstsc 独立运行
      process.unref()

      return { success: true }
    } catch (error: any) {
      console.error('[RDPManager] Failed to connect:', error)
      return { success: false, error: error.message }
    }
  }

  /**
   * 断开 RDP 连接
   * 注意：由于 mstsc 是独立进程，我们只能尝试终止它
   */
  async disconnect(connectionId: string): Promise<{ success: boolean; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) {
      return { success: false, error: '连接不存在' }
    }

    try {
      if (connection.process && !connection.process.killed) {
        connection.process.kill()
      }
      this.cleanup(connectionId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 获取连接状态
   */
  getStatus(connectionId: string): RDPConnection | null {
    return this.connections.get(connectionId) || null
  }

  /**
   * 获取所有连接
   */
  getAllConnections(): RDPConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * 清理连接资源
   */
  private cleanup(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (connection) {
      if (connection.rdpFilePath) {
        this.cleanupRdpFile(connection.rdpFilePath)
      }
      this.connections.delete(connectionId)
    }
  }

  /**
   * 清理 .rdp 文件
   */
  private cleanupRdpFile(filePath: string): void {
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath)
        console.log(`[RDPManager] Cleaned up RDP file: ${filePath}`)
      }
    } catch (error) {
      console.warn(`[RDPManager] Failed to cleanup RDP file: ${filePath}`, error)
    }
  }

  /**
   * 清理所有连接
   */
  destroyAll(): void {
    for (const connectionId of this.connections.keys()) {
      this.cleanup(connectionId)
    }
  }
}

// 导出单例
export const rdpManager = new RDPManager()
