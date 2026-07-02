/* global Buffer */

import { promises as fs } from 'fs'
import { createPrivateKey } from 'crypto'
import { logger } from './logger'
import type { SSHConnectionOptions } from '../managers/SSHConnectionManager'
import type { TrustedHostKey } from './known-hosts'
import type { ProxyConfig, ProxyJumpConfig } from '../../src/types/session'

/**
 * 将 PKCS8 格式的私钥转换为 ssh2 兼容的格式。
 */
export function convertPrivateKeyForSSH2(keyBuffer: Buffer, passphrase?: string): Buffer {
  const keyStr = keyBuffer.toString('utf-8')

  if (!keyStr.includes('BEGIN PRIVATE KEY') && !keyStr.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
    return keyBuffer
  }

  try {
    const keyObj = createPrivateKey(
      passphrase ? { key: keyBuffer, passphrase, format: 'pem' } : { key: keyBuffer, format: 'pem' }
    )

    const keyType = keyObj.asymmetricKeyType

    if (keyType === 'rsa') {
      const exported = passphrase
        ? keyObj.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase } as any)
        : keyObj.export({ type: 'pkcs1', format: 'pem' })
      return Buffer.from(exported as string)
    }

    if (keyType === 'ec') {
      const exported = passphrase
        ? keyObj.export({ type: 'sec1', format: 'pem', cipher: 'aes-256-cbc', passphrase } as any)
        : keyObj.export({ type: 'sec1', format: 'pem' })
      return Buffer.from(exported as string)
    }

    if (keyType === 'ed25519' || keyType === 'ed448') {
      if (passphrase) {
        const exported = keyObj.export({ type: 'pkcs8', format: 'pem' })
        return Buffer.from(exported as string)
      }
      return keyBuffer
    }
  } catch (error: any) {
    logger.logError('connection', `Failed to convert private key format: ${error.message}`, error)
  }

  return keyBuffer
}

/**
 * 递归处理跳板机配置中的私钥路径。
 */
export async function processProxyJumpPrivateKeys(
  config: ProxyJumpConfig
): Promise<ProxyJumpConfig> {
  const processed = { ...config }

  if (processed.authType === 'privateKey' && processed.privateKeyPath && !processed.privateKey) {
    try {
      const keyBuffer = await fs.readFile(processed.privateKeyPath)
      processed.privateKey = keyBuffer.toString()
    } catch (error: any) {
      throw new Error(`无法读取跳板机私钥文件 ${processed.privateKeyPath}: ${error.message}`)
    }
  }

  if (processed.nextJump) {
    processed.nextJump = await processProxyJumpPrivateKeys(processed.nextJump)
  }

  return processed
}

export interface RawSSHConnectOptions {
  host: string
  port: number
  username: string
  authType?: 'password' | 'privateKey'
  password?: string
  privateKey?: string
  privateKeyId?: string
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

export async function prepareSSHConnectionOptions(
  options: RawSSHConnectOptions
): Promise<SSHConnectionOptions> {
  let privateKeyBuffer: Buffer | undefined
  const usePassword = options.authType ? options.authType === 'password' : true
  const usePrivateKey = options.authType
    ? options.authType === 'privateKey'
    : !!(options.privateKeyId || options.privateKey)

  if (usePrivateKey && options.privateKeyId) {
    try {
      const { sshKeyManager } = await import('../managers/SSHKeyManager')
      const privateKeyContent = sshKeyManager.readPrivateKey(options.privateKeyId)
      privateKeyBuffer = convertPrivateKeyForSSH2(Buffer.from(privateKeyContent), options.passphrase)
    } catch (error: any) {
      logger.logError(
        'connection',
        `Failed to read private key from key manager: ${options.privateKeyId}`,
        error
      )
      throw new Error(`无法读取SSH密钥: ${error.message}`)
    }
  } else if (usePrivateKey && options.privateKey && typeof options.privateKey === 'string') {
    if (
      options.privateKey.includes('PRIVATE KEY') ||
      options.privateKey.includes('OPENSSH PRIVATE KEY')
    ) {
      privateKeyBuffer = convertPrivateKeyForSSH2(Buffer.from(options.privateKey), options.passphrase)
    } else {
      try {
        const rawKey = await fs.readFile(options.privateKey)
        privateKeyBuffer = convertPrivateKeyForSSH2(rawKey, options.passphrase)
      } catch (error: any) {
        logger.logError('connection', `Failed to read private key file: ${options.privateKey}`, error)
        throw new Error(`无法读取密钥文件: ${error.message}`)
      }
    }
  }

  let processedProxyJump = options.proxyJump
  if (processedProxyJump?.enabled) {
    processedProxyJump = await processProxyJumpPrivateKeys(processedProxyJump)
  }

  return {
    host: options.host,
    port: options.port,
    username: options.username,
    authType: options.authType,
    password: usePassword ? options.password : undefined,
    privateKey: privateKeyBuffer,
    passphrase: usePrivateKey ? options.passphrase : undefined,
    keepaliveInterval: options.keepaliveInterval,
    keepaliveCountMax: options.keepaliveCountMax,
    readyTimeout: options.readyTimeout,
    autoReconnect: options.autoReconnect,
    maxReconnectAttempts: options.maxReconnectAttempts,
    reconnectInterval: options.reconnectInterval,
    sessionName: options.sessionName,
    proxyJump: processedProxyJump,
    proxy: options.proxy,
    openShell: options.openShell,
    trustedHostKey: options.trustedHostKey
  }
}
