import { execFile } from 'child_process'
import { promisify } from 'util'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'

const execFileAsync = promisify(execFile)

export type IPMITransport = 'redfish' | 'lanplus'
export type IPMIPowerAction = 'on' | 'off' | 'cycle' | 'reset'

export interface IPMIConnectionConfig {
  id: string
  host: string
  port?: number
  username?: string
  password?: string
  ipmiOptions?: {
    transport?: IPMITransport
    redfishHttps?: boolean
    verifyCertificate?: boolean
    basePath?: string
  }
}

export interface IPMIInfo {
  id: string
  host: string
  port: number
  transport: IPMITransport
  status: 'connected' | 'error'
  manufacturer?: string
  model?: string
  serialNumber?: string
  firmwareVersion?: string
  powerState?: string
  systemPath?: string
  warning?: string
}

interface IPMIConnection {
  config: IPMIConnectionConfig
  info: IPMIInfo
  startTime: Date
}

type RedfishPayload = Record<string, any>

const clean = (value: unknown) => String(value ?? '').trim()

const normalizePath = (value: string) => {
  let path = value.trim() || '/redfish/v1'
  while (path.startsWith('/')) path = path.slice(1)
  while (path.endsWith('/')) path = path.slice(0, -1)
  return '/' + path
}

const hostForUrl = (host: string) =>
  host.includes(':') && !host.startsWith('[') ? '[' + host + ']' : host

const errorText = (payload: any, fallback: string) =>
  clean(payload?.error?.message || payload?.message || payload?.error || fallback)

export class IPMIManager {
  private connections = new Map<string, IPMIConnection>()

  private async redfishRequest(
    config: IPMIConnectionConfig,
    path: string,
    method = 'GET',
    body?: RedfishPayload
  ): Promise<RedfishPayload> {
    const useHttps = config.ipmiOptions?.redfishHttps !== false
    const port = config.port || (useHttps ? 443 : 80)
    const basePath = normalizePath(config.ipmiOptions?.basePath || '/redfish/v1')
    const targetPath = path.startsWith('/')
      ? path
      : basePath + '/' + path.replace(/^\/+/, '')
    const url = new URL(
      (useHttps ? 'https' : 'http') + '://' + hostForUrl(config.host) + ':' + port + targetPath
    )
    const username = clean(config.username)
    const password = config.password || ''
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Connection: 'close'
    }
    if (username || password) {
      headers.Authorization =
        'Basic ' + Buffer.from(username + ':' + password).toString('base64')
    }

    return await new Promise<RedfishPayload>((resolve, reject) => {
      const request = (useHttps ? httpsRequest : httpRequest) as typeof httpsRequest
      const req = request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: url.pathname + url.search,
          method,
          headers,
          ...(useHttps
            ? { rejectUnauthorized: config.ipmiOptions?.verifyCertificate !== false }
            : {})
        } as any,
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            let payload: RedfishPayload = {}
            try {
              payload = text ? JSON.parse(text) : {}
            } catch {
              payload = { message: text }
            }
            const statusCode = res.statusCode || 0
            if (statusCode < 200 || statusCode >= 300) {
              reject(
                new Error(
                  'Redfish 请求失败 (' +
                    statusCode +
                    ')：' +
                    errorText(payload, text || '设备返回错误')
                )
              )
              return
            }
            resolve(payload)
          })
        }
      )
      req.setTimeout(15000, () => req.destroy(new Error('Redfish 请求超时')))
      req.on('error', reject)
      if (body !== undefined) req.write(JSON.stringify(body))
      req.end()
    })
  }

  private async runIpmiTool(config: IPMIConnectionConfig, args: string[]) {
    const command = process.platform === 'win32' ? 'ipmitool.exe' : 'ipmitool'
    try {
      const result = await execFileAsync(
        command,
        [
          '-I',
          'lanplus',
          '-H',
          config.host,
          '-p',
          String(config.port || 623),
          '-U',
          clean(config.username),
          '-E',
          ...args
        ],
        {
          env: { ...process.env, IPMI_PASSWORD: config.password || '' },
          timeout: 20000,
          windowsHide: true,
          maxBuffer: 2 * 1024 * 1024
        }
      )
      return {
        stdout: clean((result as any).stdout),
        stderr: clean((result as any).stderr)
      }
    } catch (error: any) {
      if (error?.code === 'ENOENT') {
        throw new Error('未找到 ipmitool，请先在本机安装 ipmitool')
      }
      const detail = clean(error?.stderr || error?.stdout || error?.message)
      throw new Error(detail || 'ipmitool 执行失败')
    }
  }

  private async readRedfishInfo(config: IPMIConnectionConfig): Promise<IPMIInfo> {
    const root = await this.redfishRequest(
      config,
      normalizePath(config.ipmiOptions?.basePath || '/redfish/v1')
    )
    let system: RedfishPayload = root
    let systemPath = ''
    const systemsPath = clean(root?.Systems?.['@odata.id'])
    if (systemsPath) {
      const collection = await this.redfishRequest(config, systemsPath)
      const memberPath = clean(collection?.Members?.[0]?.['@odata.id'])
      if (memberPath) {
        systemPath = memberPath
        system = await this.redfishRequest(config, memberPath)
      }
    }
    const verifyCertificate = config.ipmiOptions?.verifyCertificate !== false
    return {
      id: config.id,
      host: config.host,
      port: config.port || (config.ipmiOptions?.redfishHttps === false ? 80 : 443),
      transport: 'redfish',
      status: 'connected',
      manufacturer: clean(system.Manufacturer || root.Manufacturer),
      model: clean(system.Model || root.Model),
      serialNumber: clean(system.SerialNumber || root.SerialNumber),
      firmwareVersion: clean(system.BiosVersion || system.FirmwareVersion || root.FirmwareVersion),
      powerState: clean(system.PowerState),
      systemPath,
      warning: verifyCertificate ? undefined : '当前未验证 BMC HTTPS 证书，请确认网络环境可信'
    }
  }

  private async readLanplusInfo(config: IPMIConnectionConfig): Promise<IPMIInfo> {
    const results = await Promise.all([
      this.runIpmiTool(config, ['mc', 'info']),
      this.runIpmiTool(config, ['chassis', 'power', 'status'])
    ])
    const mc = results[0]
    const power = results[1]
    const field = (label: string, output: string) => {
      const line = output
        .split(/\r?\n/)
        .find((item) => item.toLowerCase().startsWith(label.toLowerCase()))
      return line ? clean(line.slice(line.indexOf(':') + 1)) : ''
    }
    const powerLine = power.stdout.split(/\r?\n/).find((line) => /power is/i.test(line))
    return {
      id: config.id,
      host: config.host,
      port: config.port || 623,
      transport: 'lanplus',
      status: 'connected',
      manufacturer: field('Manufacturer ID', mc.stdout),
      model: field('Product Name', mc.stdout),
      firmwareVersion: field('Firmware Revision', mc.stdout),
      powerState: powerLine ? clean(powerLine.split(':').slice(1).join(':')) : power.stdout,
      warning: 'IPMI LAN 模式依赖本机已安装 ipmitool'
    }
  }

  private async readInfo(config: IPMIConnectionConfig): Promise<IPMIInfo> {
    const transport = config.ipmiOptions?.transport || 'redfish'
    if (!clean(config.host)) throw new Error('IPMI 主机地址不能为空')
    if (!clean(config.username)) throw new Error('IPMI 用户名不能为空')
    if (!config.password) throw new Error('IPMI 密码不能为空')
    return transport === 'lanplus'
      ? this.readLanplusInfo(config)
      : this.readRedfishInfo(config)
  }

  async connect(config: IPMIConnectionConfig): Promise<{ success: boolean; data?: IPMIInfo; error?: string }> {
    try {
      const info = await this.readInfo(config)
      this.connections.set(config.id, { config, info, startTime: new Date() })
      return { success: true, data: info }
    } catch (error: any) {
      return { success: false, error: error?.message || 'IPMI 连接失败' }
    }
  }

  async getInfo(connectionId: string): Promise<{ success: boolean; data?: IPMIInfo; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) return { success: false, error: 'IPMI 连接不存在' }
    try {
      connection.info = await this.readInfo(connection.config)
      return { success: true, data: connection.info }
    } catch (error: any) {
      connection.info = { ...connection.info, status: 'error' }
      return { success: false, error: error?.message || '读取 IPMI 状态失败' }
    }
  }

  async power(
    connectionId: string,
    action: IPMIPowerAction
  ): Promise<{ success: boolean; data?: IPMIInfo; error?: string }> {
    const connection = this.connections.get(connectionId)
    if (!connection) return { success: false, error: 'IPMI 连接不存在' }
    try {
      if (connection.info.transport === 'lanplus') {
        await this.runIpmiTool(connection.config, ['chassis', 'power', action])
      } else {
        const systemPath =
          connection.info.systemPath || (await this.readRedfishInfo(connection.config)).systemPath
        if (!systemPath) throw new Error('Redfish 未找到可控制的计算机系统')
        const resetType: Record<IPMIPowerAction, string> = {
          on: 'On',
          off: 'ForceOff',
          cycle: 'PowerCycle',
          reset: 'ForceRestart'
        }
        await this.redfishRequest(
          connection.config,
          systemPath.replace(/\/+$/, '') + '/Actions/ComputerSystem.Reset',
          'POST',
          { ResetType: resetType[action] }
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const result = await this.getInfo(connectionId)
      if (!result.success || !result.data) throw new Error(result.error || '读取电源状态失败')
      return result
    } catch (error: any) {
      return { success: false, error: error?.message || 'IPMI 电源操作失败' }
    }
  }

  async disconnect(connectionId: string): Promise<{ success: boolean; error?: string }> {
    this.connections.delete(connectionId)
    return { success: true }
  }

  getStatus(connectionId: string) {
    return this.connections.get(connectionId) || null
  }

  async destroyAll(): Promise<void> {
    this.connections.clear()
  }
}

export const ipmiManager = new IPMIManager()
