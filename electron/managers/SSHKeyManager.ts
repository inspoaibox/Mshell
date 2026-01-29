import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { generateKeyPairSync } from 'crypto'

/**
 * SSH 密钥信息
 */
export interface SSHKey {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits?: number
  publicKey: string
  privateKeyPath: string
  fingerprint: string
  comment?: string
  createdAt: string
  lastUsed?: string
  usageCount: number
  protected: boolean // 是否有密码保护
}

/**
 * 密钥生成选项
 */
export interface KeyGenerationOptions {
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits?: number // RSA: 2048, 3072, 4096; ECDSA: 256, 384, 521
  passphrase?: string
  comment?: string
}

/**
 * SSHKeyManager - SSH 密钥管理器
 */
export class SSHKeyManager {
  private keysDir: string
  private keysFile: string
  private keys: Map<string, SSHKey>

  constructor() {
    const userDataPath = app.getPath('userData')
    this.keysDir = join(userDataPath, 'ssh-keys')
    this.keysFile = join(userDataPath, 'ssh-keys.json')
    this.keys = new Map()

    // 确保目录存在
    if (!existsSync(this.keysDir)) {
      mkdirSync(this.keysDir, { recursive: true })
    }

    this.loadKeys()
  }

  /**
   * 加载密钥列表
   */
  private loadKeys(): void {
    try {
      if (existsSync(this.keysFile)) {
        const data = readFileSync(this.keysFile, 'utf-8')
        const keysArray: SSHKey[] = JSON.parse(data)
        
        keysArray.forEach(key => {
          // 验证密钥文件是否存在
          if (existsSync(key.privateKeyPath)) {
            this.keys.set(key.id, key)
          }
        })
      }
    } catch (error) {
      console.error('Failed to load SSH keys:', error)
    }
  }

  /**
   * 保存密钥列表
   */
  private saveKeys(): void {
    try {
      const keysArray = Array.from(this.keys.values())
      writeFileSync(this.keysFile, JSON.stringify(keysArray, null, 2))
    } catch (error) {
      console.error('Failed to save SSH keys:', error)
      throw error
    }
  }

  /**
   * 生成密钥对
   */
  generateKeyPair(options: KeyGenerationOptions): SSHKey {
    const id = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const privateKeyPath = join(this.keysDir, `${id}`)
    const publicKeyPath = `${privateKeyPath}.pub`

    try {
      let publicKey: string
      let privateKey: string

      if (options.type === 'rsa') {
        const bits = options.bits || 2048
        const { publicKey: pubKey, privateKey: privKey } = generateKeyPairSync('rsa', {
          modulusLength: bits,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: options.passphrase ? 'aes-256-cbc' : undefined,
            passphrase: options.passphrase
          }
        })
        publicKey = pubKey
        privateKey = privKey
      } else if (options.type === 'ed25519') {
        const { publicKey: pubKey, privateKey: privKey } = generateKeyPairSync('ed25519', {
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: options.passphrase ? 'aes-256-cbc' : undefined,
            passphrase: options.passphrase
          }
        })
        publicKey = pubKey
        privateKey = privKey
      } else if (options.type === 'ecdsa') {
        const namedCurve = options.bits === 384 ? 'secp384r1' : options.bits === 521 ? 'secp521r1' : 'prime256v1'
        const { publicKey: pubKey, privateKey: privKey } = generateKeyPairSync('ec', {
          namedCurve,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem',
            cipher: options.passphrase ? 'aes-256-cbc' : undefined,
            passphrase: options.passphrase
          }
        })
        publicKey = pubKey
        privateKey = privKey
      } else {
        throw new Error(`Unsupported key type: ${options.type}`)
      }

      // 保存密钥文件
      writeFileSync(privateKeyPath, privateKey, { mode: 0o600 })
      writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })

      // 生成指纹
      const fingerprint = this.generateFingerprint(publicKey)

      // 创建密钥记录
      const key: SSHKey = {
        id,
        name: options.name,
        type: options.type,
        bits: options.bits,
        publicKey,
        privateKeyPath,
        fingerprint,
        comment: options.comment,
        createdAt: new Date().toISOString(),
        usageCount: 0,
        protected: !!options.passphrase
      }

      this.keys.set(id, key)
      this.saveKeys()

      return key
    } catch (error) {
      // 清理可能创建的文件
      try {
        if (existsSync(privateKeyPath)) unlinkSync(privateKeyPath)
        if (existsSync(publicKeyPath)) unlinkSync(publicKeyPath)
      } catch {}
      
      throw error
    }
  }

  /**
   * 导入密钥
   */
  importKey(name: string, privateKeyPath: string, passphrase?: string): SSHKey {
    try {
      // 读取私钥
      if (!existsSync(privateKeyPath)) {
        throw new Error('Private key file not found')
      }

      const privateKey = readFileSync(privateKeyPath, 'utf-8')

      // 尝试读取公钥
      const publicKeyPath = `${privateKeyPath}.pub`
      let publicKey = ''
      
      if (existsSync(publicKeyPath)) {
        publicKey = readFileSync(publicKeyPath, 'utf-8')
      } else {
        // 如果没有公钥文件，尝试从私钥提取（这里简化处理）
        publicKey = 'Public key not available'
      }

      // 生成新的 ID 和路径
      const id = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const newPrivateKeyPath = join(this.keysDir, `${id}`)
      const newPublicKeyPath = `${newPrivateKeyPath}.pub`

      // 复制密钥文件
      writeFileSync(newPrivateKeyPath, privateKey, { mode: 0o600 })
      if (publicKey !== 'Public key not available') {
        writeFileSync(newPublicKeyPath, publicKey, { mode: 0o644 })
      }

      // 检测密钥类型
      const type = this.detectKeyType(privateKey)
      const fingerprint = this.generateFingerprint(publicKey)

      // 创建密钥记录
      const key: SSHKey = {
        id,
        name,
        type,
        publicKey,
        privateKeyPath: newPrivateKeyPath,
        fingerprint,
        createdAt: new Date().toISOString(),
        usageCount: 0,
        protected: !!passphrase
      }

      this.keys.set(id, key)
      this.saveKeys()

      return key
    } catch (error) {
      throw new Error(`Failed to import key: ${(error as Error).message}`)
    }
  }

  /**
   * 手动添加密钥
   */
  addKey(keyData: { name: string; privateKey: string; publicKey?: string; passphrase?: string; comment?: string }): SSHKey {
    try {
      const id = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const privateKeyPath = join(this.keysDir, `${id}`)
      const publicKeyPath = `${privateKeyPath}.pub`

      // 写入私钥文件
      writeFileSync(privateKeyPath, keyData.privateKey, { mode: 0o600 })
      
      // 写入公钥文件（如果提供）
      if (keyData.publicKey) {
        writeFileSync(publicKeyPath, keyData.publicKey, { mode: 0o644 })
      }

      // 检测密钥类型
      const type = this.detectKeyType(keyData.privateKey)
      const fingerprint = this.generateFingerprint(keyData.publicKey || keyData.privateKey)

      // 创建密钥记录
      const key: SSHKey = {
        id,
        name: keyData.name,
        type,
        publicKey: keyData.publicKey || 'Public key not provided',
        privateKeyPath,
        fingerprint,
        comment: keyData.comment,
        createdAt: new Date().toISOString(),
        usageCount: 0,
        protected: !!keyData.passphrase
      }

      this.keys.set(id, key)
      this.saveKeys()

      return key
    } catch (error) {
      throw new Error(`Failed to add key: ${(error as Error).message}`)
    }
  }

  /**
   * 导出密钥
   */
  exportKey(id: string, exportPath: string): void {
    const key = this.keys.get(id)
    if (!key) {
      throw new Error('Key not found')
    }

    try {
      // 读取私钥
      const privateKey = readFileSync(key.privateKeyPath, 'utf-8')
      
      // 写入到导出路径
      writeFileSync(exportPath, privateKey, { mode: 0o600 })
      
      // 如果有公钥，也导出
      const publicKeyPath = `${key.privateKeyPath}.pub`
      if (existsSync(publicKeyPath)) {
        const publicKey = readFileSync(publicKeyPath, 'utf-8')
        writeFileSync(`${exportPath}.pub`, publicKey, { mode: 0o644 })
      }
    } catch (error) {
      throw new Error(`Failed to export key: ${(error as Error).message}`)
    }
  }

  /**
   * 获取所有密钥
   */
  getAllKeys(): SSHKey[] {
    return Array.from(this.keys.values())
  }

  /**
   * 获取密钥
   */
  getKey(id: string): SSHKey | undefined {
    return this.keys.get(id)
  }

  /**
   * 更新密钥信息
   */
  updateKey(id: string, updates: Partial<Pick<SSHKey, 'name' | 'comment'>>): void {
    const key = this.keys.get(id)
    if (!key) {
      throw new Error('Key not found')
    }

    if (updates.name !== undefined) key.name = updates.name
    if (updates.comment !== undefined) key.comment = updates.comment

    this.saveKeys()
  }

  /**
   * 删除密钥
   */
  deleteKey(id: string): void {
    const key = this.keys.get(id)
    if (!key) {
      throw new Error('Key not found')
    }

    try {
      // 删除密钥文件
      if (existsSync(key.privateKeyPath)) {
        unlinkSync(key.privateKeyPath)
      }

      const publicKeyPath = `${key.privateKeyPath}.pub`
      if (existsSync(publicKeyPath)) {
        unlinkSync(publicKeyPath)
      }

      // 从列表中移除
      this.keys.delete(id)
      this.saveKeys()
    } catch (error) {
      throw new Error(`Failed to delete key: ${(error as Error).message}`)
    }
  }

  /**
   * 读取私钥内容
   */
  readPrivateKey(id: string): string {
    const key = this.keys.get(id)
    if (!key) {
      throw new Error('Key not found')
    }

    try {
      return readFileSync(key.privateKeyPath, 'utf-8')
    } catch (error) {
      throw new Error(`Failed to read private key: ${(error as Error).message}`)
    }
  }

  /**
   * 增加使用次数
   */
  incrementUsage(id: string): void {
    const key = this.keys.get(id)
    if (key) {
      key.usageCount++
      key.lastUsed = new Date().toISOString()
      this.saveKeys()
    }
  }

  /**
   * 检测密钥类型
   */
  private detectKeyType(privateKey: string): 'rsa' | 'ed25519' | 'ecdsa' {
    if (privateKey.includes('RSA PRIVATE KEY') || privateKey.includes('BEGIN PRIVATE KEY')) {
      return 'rsa'
    } else if (privateKey.includes('ED25519')) {
      return 'ed25519'
    } else if (privateKey.includes('EC PRIVATE KEY')) {
      return 'ecdsa'
    }
    return 'rsa' // 默认
  }

  /**
   * 生成指纹
   */
  private generateFingerprint(publicKey: string): string {
    // 简化的指纹生成（实际应该使用 crypto 模块生成 MD5 或 SHA256 指纹）
    const crypto = require('crypto')
    const hash = crypto.createHash('md5')
    hash.update(publicKey)
    const fingerprint = hash.digest('hex')
    
    // 格式化为 xx:xx:xx:... 格式
    return fingerprint.match(/.{2}/g)?.join(':') || fingerprint
  }

  /**
   * 获取密钥统计
   */
  getStatistics() {
    const keys = Array.from(this.keys.values())
    
    return {
      total: keys.length,
      byType: {
        rsa: keys.filter(k => k.type === 'rsa').length,
        ed25519: keys.filter(k => k.type === 'ed25519').length,
        ecdsa: keys.filter(k => k.type === 'ecdsa').length
      },
      protected: keys.filter(k => k.protected).length,
      unprotected: keys.filter(k => !k.protected).length,
      mostUsed: keys.sort((a, b) => b.usageCount - a.usageCount).slice(0, 5)
    }
  }
}

// 导出单例
export const sshKeyManager = new SSHKeyManager()
