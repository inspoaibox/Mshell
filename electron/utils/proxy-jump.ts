import { Client } from 'ssh2'
import * as net from 'net'
import type { ProxyJumpConfig, ProxyConfig } from '../../src/types/session'
import { ProxyHelper } from './proxy'
import { verifySshHostKey } from './known-hosts'

/**
 * 跳板机连接辅助类
 */
export class ProxyJumpHelper {
  /**
   * 通过跳板机建立连接
   */
  static async connectThroughProxy(
    proxyConfig: ProxyJumpConfig,
    targetHost: string,
    targetPort: number,
    underlyingProxy?: ProxyConfig
  ): Promise<net.Socket> {
    // 如果有多级跳板，递归建立连接
    if (proxyConfig.nextJump) {
      const intermediateSocket = await this.connectThroughProxy(
        proxyConfig.nextJump,
        proxyConfig.host,
        proxyConfig.port,
        underlyingProxy // 传递底层代理配置
      )
      return await this.createProxyConnection(proxyConfig, targetHost, targetPort, intermediateSocket)
    }

    // 第一级跳板机
    // 如果有底层代理，先连接代理
    let socket: net.Socket | undefined
    if (underlyingProxy && underlyingProxy.enabled) {
      socket = await ProxyHelper.connect(underlyingProxy, proxyConfig.host, proxyConfig.port)
    }

    // 直接连接到第一级跳板机（如果有socket则使用socket）
    return await this.createProxyConnection(proxyConfig, targetHost, targetPort, socket)
  }

  /**
   * 创建代理连接
   */
  private static async createProxyConnection(
    proxyConfig: ProxyJumpConfig,
    targetHost: string,
    targetPort: number,
    existingSocket?: net.Socket
  ): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const proxyClient = new Client()

      // 连接配置
      const connectConfig: any = {
        host: proxyConfig.host,
        port: proxyConfig.port,
        username: proxyConfig.username,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 30000,
        hostVerifier: (key: Buffer) => verifySshHostKey(proxyConfig.host, proxyConfig.port, key)
      }

      // 认证方式
      if (proxyConfig.authType === 'password' && proxyConfig.password) {
        connectConfig.password = proxyConfig.password
      } else if (proxyConfig.authType === 'privateKey' && proxyConfig.privateKey) {
        connectConfig.privateKey = Buffer.from(proxyConfig.privateKey)
        if (proxyConfig.passphrase) {
          connectConfig.passphrase = proxyConfig.passphrase
        }
      }

      // 如果有现有的 socket（多级跳板），使用它
      if (existingSocket) {
        connectConfig.sock = existingSocket
      }

      proxyClient.on('ready', () => {
        // 通过跳板机转发到目标主机
        proxyClient.forwardOut(
          '127.0.0.1',
          0,
          targetHost,
          targetPort,
          (err, stream) => {
            if (err) {
              proxyClient.end()
              reject(new Error(`Failed to forward through proxy: ${err.message}`))
              return
            }

            // 将 stream 包装成 net.Socket 兼容的对象
            const socket = stream as any as net.Socket

            // 添加清理逻辑
            socket.on('close', () => {
              proxyClient.end()
            })

            resolve(socket)
          }
        )
      })

      proxyClient.on('error', (err) => {
        reject(new Error(`Proxy connection error: ${err.message}`))
      })

      proxyClient.connect(connectConfig)
    })
  }

  /**
   * 验证跳板机配置
   */
  static validateProxyConfig(config: ProxyJumpConfig): { valid: boolean; error?: string } {
    if (!config.host || !config.port || !config.username) {
      return {
        valid: false,
        error: '跳板机配置不完整：需要主机、端口和用户名'
      }
    }

    if (config.authType === 'password' && !config.password) {
      return {
        valid: false,
        error: '跳板机配置不完整：密码认证需要提供密码'
      }
    }

    if (config.authType === 'privateKey' && !config.privateKey && !config.privateKeyPath) {
      return {
        valid: false,
        error: '跳板机配置不完整：密钥认证需要提供私钥'
      }
    }

    // 递归验证多级跳板
    if (config.nextJump) {
      return this.validateProxyConfig(config.nextJump)
    }

    return { valid: true }
  }

  /**
   * 获取跳板机链路描述
   */
  static getProxyChainDescription(config: ProxyJumpConfig): string {
    const parts: string[] = []
    let current: ProxyJumpConfig | undefined = config

    while (current) {
      parts.push(`${current.username}@${current.host}:${current.port}`)
      current = current.nextJump
    }

    return parts.join(' -> ')
  }

  /**
   * 计算跳板机层级
   */
  static getProxyDepth(config: ProxyJumpConfig): number {
    let depth = 1
    let current = config.nextJump

    while (current) {
      depth++
      current = current.nextJump
    }

    return depth
  }
}
