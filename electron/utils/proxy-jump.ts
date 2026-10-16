import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import type { Socket } from 'net'
import type { ProxyJumpConfig, ProxyConfig } from '../../src/types/session'
import { ProxyHelper } from './proxy'
import { verifySshHostKey } from './known-hosts'
import type { ConnectionAttemptOptions, SSHTransport } from './ssh-transport'

export class ProxyJumpHelper {
  /** Config order is the network order: local -> first hop -> next hop -> target. */
  static async connectThroughProxy(
    proxyConfig: ProxyJumpConfig,
    targetHost: string,
    targetPort: number,
    underlyingProxy?: ProxyConfig,
    options: ConnectionAttemptOptions = {}
  ): Promise<ClientChannel> {
    const validation = this.validateProxyConfig(proxyConfig)
    if (!validation.valid) throw new Error(validation.error)
    if (
      !targetHost.trim() ||
      !Number.isInteger(targetPort) ||
      targetPort < 1 ||
      targetPort > 65535
    ) {
      throw new Error('目标主机或端口无效')
    }
    const hops = this.getEnabledHops(proxyConfig)
    const clients: Client[] = []
    const channels: ClientChannel[] = []
    let underlyingSocket: Socket | undefined
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      // Keep error/close listeners attached until the transports have actually closed.
      for (const channel of [...channels].reverse()) channel.destroy()
      for (const client of [...clients].reverse()) client.destroy()
      underlyingSocket?.destroy()
    }

    const openHop = (hop: ProxyJumpConfig, host: string, port: number, transport?: SSHTransport) =>
      new Promise<ClientChannel>((resolve, reject) => {
        const client = new Client()
        clients.push(client)
        let settled = false
        const label = `${hop.host}:${hop.port} -> ${host}:${port}`
        const finish = () => {
          settled = true
          clearTimeout(timer)
          options.signal?.removeEventListener('abort', onAbort)
        }
        const fail = (error: Error) => {
          if (!settled) {
            finish()
            reject(error)
          }
          dispose()
        }
        const onAbort = () => fail(new Error('已取消跳板机连接'))
        const timer = setTimeout(
          () => fail(new Error(`跳板链路连接超时：${label}`)),
          options.timeoutMs || 30_000
        )
        client.on('error', (error) => fail(new Error(`跳板连接失败（${label}）：${error.message}`)))
        client.on('close', () => fail(new Error(`跳板连接已关闭：${label}`)))
        client.on('end', () => fail(new Error(`跳板连接已结束：${label}`)))
        options.signal?.addEventListener('abort', onAbort, { once: true })
        if (options.signal?.aborted || disposed) {
          onAbort()
          return
        }
        client.on('ready', () => {
          if (settled) return
          try {
            client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
              if (settled) {
                channel?.destroy()
                return
              }
              if (error) {
                fail(new Error(`跳板转发失败（${label}）：${error.message}`))
                return
              }
              channels.push(channel)
              channel.on('error', dispose)
              channel.once('close', dispose)
              finish()
              resolve(channel)
            })
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        })
        const config: ConnectConfig = {
          host: hop.host,
          port: hop.port,
          username: hop.username,
          sock: transport,
          readyTimeout: options.timeoutMs || 30_000,
          keepaliveInterval: 30_000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer) => verifySshHostKey(hop.host, hop.port, key),
          ...(hop.authType === 'password'
            ? { password: hop.password }
            : { privateKey: hop.privateKey, passphrase: hop.passphrase })
        }
        try {
          client.connect(config)
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })

    try {
      if (underlyingProxy?.enabled) {
        underlyingSocket = await ProxyHelper.connect(
          underlyingProxy,
          hops[0].host,
          hops[0].port,
          options
        )
      }
      let transport: SSHTransport | undefined = underlyingSocket
      for (let i = 0; i < hops.length; i++) {
        const next = hops[i + 1]
        transport = await openHop(
          hops[i],
          next?.host || targetHost,
          next?.port || targetPort,
          transport
        )
      }
      if (disposed || options.signal?.aborted) throw new Error('跳板链路已关闭或取消')
      return transport as ClientChannel
    } catch (error) {
      dispose()
      throw error
    }
  }

  private static getEnabledHops(config: ProxyJumpConfig): ProxyJumpConfig[] {
    const hops: ProxyJumpConfig[] = []
    let current: ProxyJumpConfig | undefined = config
    while (current?.enabled) {
      if (hops.includes(current) || hops.length >= 8) throw new Error('跳板链路存在循环或超过 8 级')
      hops.push(current)
      current = current.nextJump
    }
    return hops
  }

  static validateProxyConfig(config: ProxyJumpConfig): { valid: boolean; error?: string } {
    try {
      const hops = this.getEnabledHops(config)
      if (!hops.length) throw new Error('请启用跳板机')
      for (const hop of hops) {
        if (
          !hop.host?.trim() ||
          !hop.username?.trim() ||
          !Number.isInteger(hop.port) ||
          hop.port < 1 ||
          hop.port > 65535
        ) {
          throw new Error('跳板机配置不完整：需要主机、有效端口和用户名')
        }
        if (hop.authType === 'password') {
          if (!hop.password) throw new Error('跳板机配置不完整：密码认证需要提供密码')
        } else if (hop.authType === 'privateKey') {
          if (!hop.privateKey && !hop.privateKeyPath)
            throw new Error('跳板机配置不完整：密钥认证需要提供私钥')
        } else {
          throw new Error('跳板机认证方式无效')
        }
      }
      return { valid: true }
    } catch (error) {
      return { valid: false, error: (error as Error).message }
    }
  }

  static getProxyChainDescription(config: ProxyJumpConfig): string {
    return this.getEnabledHops(config)
      .map((hop) => `${hop.username}@${hop.host}:${hop.port}`)
      .join(' -> ')
  }

  static getProxyDepth(config: ProxyJumpConfig): number {
    return this.getEnabledHops(config).length
  }
}
