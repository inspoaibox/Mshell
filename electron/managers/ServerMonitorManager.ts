import { EventEmitter } from 'node:events'
import { Client } from 'ssh2'

/**
 * 服务器监控数据接口
 */
export interface ServerMetrics {
  sessionId: string
  timestamp: string
  
  // CPU 信息
  cpu: {
    usage: number // 使用率百分比
    loadAverage: number[] // 1分钟、5分钟、15分钟负载
    cores: number // CPU核心数
  }
  
  // 内存信息
  memory: {
    total: number // 总内存（字节）
    used: number // 已用内存
    free: number // 空闲内存
    available: number // 可用内存
    usage: number // 使用率百分比
  }
  
  // 磁盘信息
  disk: {
    total: number // 总空间（字节）
    used: number // 已用空间
    free: number // 空闲空间
    usage: number // 使用率百分比
  }
  
  // 网络信息
  network: {
    bytesIn: number // 接收字节数
    bytesOut: number // 发送字节数
    packetsIn: number // 接收包数
    packetsOut: number // 发送包数
  }
  
  // 进程信息
  processes: {
    total: number // 总进程数
    running: number // 运行中
    sleeping: number // 休眠中
    zombie: number // 僵尸进程
  }
  
  // 系统信息
  system: {
    uptime: number // 运行时间（秒）
    hostname: string
    platform: string
    kernel: string
  }
}

/**
 * 监控配置
 */
export interface MonitorConfig {
  interval: number // 监控间隔（毫秒）
  enabled: boolean
  metrics: {
    cpu: boolean
    memory: boolean
    disk: boolean
    network: boolean
    processes: boolean
  }
}

/**
 * ServerMonitorManager - 服务器监控管理器
 */
export class ServerMonitorManager extends EventEmitter {
  private monitors: Map<string, NodeJS.Timeout>
  private sshClients: Map<string, Client>
  private configs: Map<string, MonitorConfig>
  private latestMetrics: Map<string, ServerMetrics>

  constructor() {
    super()
    this.monitors = new Map()
    this.sshClients = new Map()
    this.configs = new Map()
    this.latestMetrics = new Map()
  }

  /**
   * 开始监控
   */
  startMonitoring(sessionId: string, sshClient: Client, config?: Partial<MonitorConfig>): void {
    // 停止现有监控
    this.stopMonitoring(sessionId)

    // 合并配置
    const fullConfig: MonitorConfig = {
      interval: config?.interval || 5000,
      enabled: config?.enabled !== false,
      metrics: {
        cpu: config?.metrics?.cpu !== false,
        memory: config?.metrics?.memory !== false,
        disk: config?.metrics?.disk !== false,
        network: config?.metrics?.network !== false,
        processes: config?.metrics?.processes !== false
      }
    }

    this.configs.set(sessionId, fullConfig)
    this.sshClients.set(sessionId, sshClient)

    // 立即执行一次
    this.collectMetrics(sessionId)

    // 设置定时器
    const timer = setInterval(() => {
      this.collectMetrics(sessionId)
    }, fullConfig.interval)

    this.monitors.set(sessionId, timer)
  }

  /**
   * 停止监控
   */
  stopMonitoring(sessionId: string): void {
    const timer = this.monitors.get(sessionId)
    if (timer) {
      clearInterval(timer)
      this.monitors.delete(sessionId)
    }

    this.sshClients.delete(sessionId)
    this.configs.delete(sessionId)
  }

  /**
   * 收集指标
   */
  private async collectMetrics(sessionId: string): Promise<void> {
    const client = this.sshClients.get(sessionId)
    const config = this.configs.get(sessionId)

    if (!client || !config) return

    try {
      const metrics: Partial<ServerMetrics> = {
        sessionId,
        timestamp: new Date().toISOString()
      }

      // 收集各项指标
      if (config.metrics.cpu) {
        metrics.cpu = await this.collectCPUMetrics(client)
      }

      if (config.metrics.memory) {
        metrics.memory = await this.collectMemoryMetrics(client)
      }

      if (config.metrics.disk) {
        metrics.disk = await this.collectDiskMetrics(client)
      }

      if (config.metrics.network) {
        metrics.network = await this.collectNetworkMetrics(client)
      }

      if (config.metrics.processes) {
        metrics.processes = await this.collectProcessMetrics(client)
      }

      metrics.system = await this.collectSystemInfo(client)

      // 保存最新指标
      this.latestMetrics.set(sessionId, metrics as ServerMetrics)

      // 发送事件
      this.emit('metrics', sessionId, metrics)
    } catch (error) {
      console.error(`Failed to collect metrics for ${sessionId}:`, error)
      this.emit('error', sessionId, error)
    }
  }

  /**
   * 收集 CPU 指标
   */
  private async collectCPUMetrics(client: Client): Promise<ServerMetrics['cpu']> {
    // CPU 使用率
    const cpuUsage = await this.executeCommand(client, 
      "top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'"
    )

    // 负载平均值
    const loadAvg = await this.executeCommand(client, 
      "cat /proc/loadavg | awk '{print $1,$2,$3}'"
    )

    // CPU 核心数
    const cores = await this.executeCommand(client, 
      "nproc"
    )

    const loadValues = loadAvg.trim().split(' ').map(Number)

    return {
      usage: parseFloat(cpuUsage.trim()) || 0,
      loadAverage: loadValues.length === 3 ? loadValues : [0, 0, 0],
      cores: parseInt(cores.trim()) || 1
    }
  }

  /**
   * 收集内存指标
   */
  private async collectMemoryMetrics(client: Client): Promise<ServerMetrics['memory']> {
    const memInfo = await this.executeCommand(client, 
      "free -b | grep Mem | awk '{print $2,$3,$4,$7}'"
    )

    const values = memInfo.trim().split(' ').map(Number)
    const [total, used, free, available] = values

    return {
      total: total || 0,
      used: used || 0,
      free: free || 0,
      available: available || 0,
      usage: total > 0 ? (used / total) * 100 : 0
    }
  }

  /**
   * 收集磁盘指标
   */
  private async collectDiskMetrics(client: Client): Promise<ServerMetrics['disk']> {
    const diskInfo = await this.executeCommand(client, 
      "df -B1 / | tail -1 | awk '{print $2,$3,$4}'"
    )

    const values = diskInfo.trim().split(' ').map(Number)
    const [total, used, free] = values

    return {
      total: total || 0,
      used: used || 0,
      free: free || 0,
      usage: total > 0 ? (used / total) * 100 : 0
    }
  }

  /**
   * 收集网络指标
   */
  private async collectNetworkMetrics(client: Client): Promise<ServerMetrics['network']> {
    const netInfo = await this.executeCommand(client, 
      "cat /proc/net/dev | grep -E 'eth0|ens|enp' | head -1 | awk '{print $2,$3,$10,$11}'"
    )

    const values = netInfo.trim().split(' ').map(Number)
    const [bytesIn, packetsIn, bytesOut, packetsOut] = values

    return {
      bytesIn: bytesIn || 0,
      bytesOut: bytesOut || 0,
      packetsIn: packetsIn || 0,
      packetsOut: packetsOut || 0
    }
  }

  /**
   * 收集进程指标
   */
  private async collectProcessMetrics(client: Client): Promise<ServerMetrics['processes']> {
    const procInfo = await this.executeCommand(client, 
      "ps aux | awk 'NR>1 {print $8}' | sort | uniq -c | awk '{print $2,$1}'"
    )

    const lines = procInfo.trim().split('\n')
    let total = 0
    let running = 0
    let sleeping = 0
    let zombie = 0

    lines.forEach(line => {
      const [state, count] = line.trim().split(' ')
      const num = parseInt(count) || 0
      total += num

      if (state.startsWith('R')) running += num
      else if (state.startsWith('S') || state.startsWith('I')) sleeping += num
      else if (state.startsWith('Z')) zombie += num
    })

    return { total, running, sleeping, zombie }
  }

  /**
   * 收集系统信息
   */
  private async collectSystemInfo(client: Client): Promise<ServerMetrics['system']> {
    const uptime = await this.executeCommand(client, 
      "cat /proc/uptime | awk '{print $1}'"
    )

    const hostname = await this.executeCommand(client, 
      "hostname"
    )

    const platform = await this.executeCommand(client, 
      "uname -s"
    )

    const kernel = await this.executeCommand(client, 
      "uname -r"
    )

    return {
      uptime: parseFloat(uptime.trim()) || 0,
      hostname: hostname.trim(),
      platform: platform.trim(),
      kernel: kernel.trim()
    }
  }

  /**
   * 执行命令
   */
  private executeCommand(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        let output = ''
        let errorOutput = ''

        stream.on('data', (data: Buffer) => {
          output += data.toString()
        })

        stream.stderr.on('data', (data: Buffer) => {
          errorOutput += data.toString()
        })

        stream.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Command failed with code ${code}: ${errorOutput}`))
          } else {
            resolve(output)
          }
        })
      })
    })
  }

  /**
   * 获取最新指标
   */
  getLatestMetrics(sessionId: string): ServerMetrics | undefined {
    return this.latestMetrics.get(sessionId)
  }

  /**
   * 获取所有监控会话
   */
  getMonitoredSessions(): string[] {
    return Array.from(this.monitors.keys())
  }

  /**
   * 更新监控配置
   */
  updateConfig(sessionId: string, config: Partial<MonitorConfig>): void {
    const currentConfig = this.configs.get(sessionId)
    if (!currentConfig) return

    const newConfig = {
      ...currentConfig,
      ...config,
      metrics: {
        ...currentConfig.metrics,
        ...config.metrics
      }
    }

    this.configs.set(sessionId, newConfig)

    // 如果间隔改变，重启监控
    if (config.interval && config.interval !== currentConfig.interval) {
      const client = this.sshClients.get(sessionId)
      if (client) {
        this.startMonitoring(sessionId, client, newConfig)
      }
    }
  }

  /**
   * 清理所有监控
   */
  cleanup(): void {
    for (const sessionId of this.monitors.keys()) {
      this.stopMonitoring(sessionId)
    }
  }
}

// 导出单例
export const serverMonitorManager = new ServerMonitorManager()
