import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { createHash, createPrivateKey, generateKeyPairSync as cryptoGenerateKeyPairSync } from 'crypto'
import { utils as ssh2Utils } from 'ssh2'
import type { ParsedKey } from 'ssh2'

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
  updatedAt?: string
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

type SSHKeyType = SSHKey['type']

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
   * 优先使用 ssh2 的 generateKeyPair 生成 OpenSSH 格式密钥，确保兼容性
   * 如果 ssh2 生成失败，回退到 Node.js crypto（RSA->pkcs1, ECDSA->sec1）
   */
  generateKeyPair(options: KeyGenerationOptions): SSHKey {
    const id = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const privateKeyPath = join(this.keysDir, `${id}`)
    const publicKeyPath = `${privateKeyPath}.pub`

    try {
      let publicKey: string
      let privateKey: string

      // 尝试使用 ssh2 的 generateKeyPair（同步包装）
      const ssh2Result = this.generateWithSSH2(options)
      if (ssh2Result) {
        publicKey = ssh2Result.publicKey
        privateKey = ssh2Result.privateKey
      } else {
        if (options.type === 'ed25519') {
          throw new Error('当前 ssh2 运行库无法生成 OpenSSH Ed25519 密钥')
        }
        // 回退到 Node.js crypto
        const cryptoResult = this.generateWithCrypto(options)
        publicKey = cryptoResult.publicKey
        privateKey = cryptoResult.privateKey
      }

      if (!this.isSSHAuthorizedPublicKey(publicKey)) {
        publicKey = this.derivePublicKey(privateKey, options.passphrase)
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
   * 使用 ssh2 的 generateKeyPair 生成密钥（同步包装）
   * 生成的密钥为 OpenSSH 格式，ssh2 完全兼容
   */
  private generateWithSSH2(options: KeyGenerationOptions): { publicKey: string; privateKey: string } | null {
    try {
      const keyOptions: any = {
        comment: options.comment || options.name
      }

      if (options.passphrase) {
        keyOptions.passphrase = options.passphrase
        keyOptions.cipher = 'aes256-cbc'
        keyOptions.rounds = 16
      }

      if (options.type === 'rsa') {
        keyOptions.bits = options.bits || 2048
      } else if (options.type === 'ecdsa') {
        keyOptions.bits = options.bits || 256
      }

      const keyPair = ssh2Utils.generateKeyPairSync(options.type, keyOptions)
      return {
        publicKey: keyPair.public,
        privateKey: keyPair.private
      }
    } catch (err) {
      return null
    }
  }

  /**
   * 使用 Node.js crypto 生成密钥（回退方案）
   * RSA 使用 pkcs1 格式，ECDSA 使用 sec1 格式，ed25519 使用 pkcs8 格式
   */
  private generateWithCrypto(options: KeyGenerationOptions): { publicKey: string; privateKey: string } {
    if (options.type === 'rsa') {
      const bits = options.bits || 2048
      const privateKeyEncoding = options.passphrase
        ? { type: 'pkcs1' as const, format: 'pem' as const, cipher: 'aes-256-cbc' as const, passphrase: options.passphrase }
        : { type: 'pkcs1' as const, format: 'pem' as const }
      const { publicKey, privateKey } = cryptoGenerateKeyPairSync('rsa', {
        modulusLength: bits,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding
      })
      return { publicKey, privateKey }
    } else if (options.type === 'ed25519') {
      // Node 18 只能输出 pkcs8 格式的 ed25519，ssh2 可能不支持
      // 连接时会通过 convertPrivateKeyForSSH2 尝试处理
      const privateKeyEncoding = options.passphrase
        ? { type: 'pkcs8' as const, format: 'pem' as const, cipher: 'aes-256-cbc' as const, passphrase: options.passphrase }
        : { type: 'pkcs8' as const, format: 'pem' as const }
      const { publicKey, privateKey } = cryptoGenerateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding
      })
      return { publicKey, privateKey }
    } else if (options.type === 'ecdsa') {
      const namedCurve = options.bits === 384 ? 'secp384r1' : options.bits === 521 ? 'secp521r1' : 'prime256v1'
      const privateKeyEncoding = options.passphrase
        ? { type: 'sec1' as const, format: 'pem' as const, cipher: 'aes-256-cbc' as const, passphrase: options.passphrase }
        : { type: 'sec1' as const, format: 'pem' as const }
      const { publicKey, privateKey } = cryptoGenerateKeyPairSync('ec', {
        namedCurve,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding
      })
      return { publicKey, privateKey }
    }
    throw new Error(`Unsupported key type: ${options.type}`)
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
        publicKey = readFileSync(publicKeyPath, 'utf-8').trim()
      } else {
        publicKey = this.derivePublicKey(privateKey, passphrase)
      }

      // 生成新的 ID 和路径
      const id = `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const newPrivateKeyPath = join(this.keysDir, `${id}`)
      const newPublicKeyPath = `${newPrivateKeyPath}.pub`

      // 复制密钥文件
      writeFileSync(newPrivateKeyPath, privateKey, { mode: 0o600 })
      writeFileSync(newPublicKeyPath, publicKey, { mode: 0o644 })

      // 检测密钥类型
      const type = this.detectKeyType(privateKey, passphrase)
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
        protected: !!passphrase || this.isPrivateKeyEncrypted(privateKey)
      }

      this.keys.set(id, key)
      this.saveKeys()

      return key
    } catch (error) {
      throw new Error(`Failed to import key: ${(error as Error).message}`)
    }
  }

  /**
   * 批量导入密钥
   * @param files 文件路径数组
   * @returns 导入结果数组
   */
  importKeysBatch(files: string[]): { success: boolean; name: string; error?: string }[] {
    const results: { success: boolean; name: string; error?: string }[] = []

    for (const filePath of files) {
      try {
        // 从文件路径提取文件名作为密钥名称
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown'
        // 移除常见的扩展名
        const keyName = fileName.replace(/\.(pem|key|ppk)$/i, '')

        // 检查是否是公钥文件（跳过，因为会随私钥一起导入）
        if (fileName.endsWith('.pub')) {
          continue
        }

        // 检查文件是否存在
        if (!existsSync(filePath)) {
          results.push({ success: false, name: keyName, error: '文件不存在' })
          continue
        }

        // 读取文件内容检查是否是有效的私钥
        const content = readFileSync(filePath, 'utf-8')
        if (!this.isValidPrivateKey(content)) {
          results.push({ success: false, name: keyName, error: '不是有效的私钥文件' })
          continue
        }

        // 检查是否已存在同名密钥
        const existingKey = Array.from(this.keys.values()).find(k => k.name === keyName)
        const finalName = existingKey ? `${keyName}_${Date.now()}` : keyName

        // 导入密钥
        this.importKey(finalName, filePath)
        results.push({ success: true, name: finalName })
      } catch (error) {
        const fileName = filePath.split(/[/\\]/).pop() || 'unknown'
        results.push({ success: false, name: fileName, error: (error as Error).message })
      }
    }

    return results
  }

  /**
   * 检查是否是有效的私钥文件
   */
  private isValidPrivateKey(content: string, passphrase?: string): boolean {
    try {
      const parsed = this.parsePrivateKey(content, passphrase)
      return parsed.isPrivateKey()
    } catch {
      return content.includes('PRIVATE KEY') ||
             content.includes('OPENSSH PRIVATE KEY') ||
             content.includes('EC PRIVATE KEY') ||
             content.includes('RSA PRIVATE KEY') ||
             content.includes('DSA PRIVATE KEY') ||
             content.includes('ENCRYPTED PRIVATE KEY')
    }
  }

  /**
   * 手动添加密钥
   */
  addKey(keyData: { id?: string; name: string; privateKey: string; publicKey?: string; passphrase?: string; comment?: string }): SSHKey {
    try {
      const id = keyData.id || `key_${Date.now()}_${Math.random().toString(36).substring(7)}`
      const privateKeyPath = join(this.keysDir, `${id}`)
      const publicKeyPath = `${privateKeyPath}.pub`

      // 如果已存在同 ID 的记录，先删除旧文件（防止残留）
      if (this.keys.has(id)) {
        const existing = this.keys.get(id)!
        try {
          if (existsSync(existing.privateKeyPath)) unlinkSync(existing.privateKeyPath)
          const oldPub = `${existing.privateKeyPath}.pub`
          if (existsSync(oldPub)) unlinkSync(oldPub)
        } catch { /* ignore */ }
        this.keys.delete(id)
      }

      const publicKey = keyData.publicKey?.trim() || this.derivePublicKey(keyData.privateKey, keyData.passphrase)

      // 写入私钥文件
      writeFileSync(privateKeyPath, keyData.privateKey, { mode: 0o600 })

      writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })

      // 检测密钥类型
      const type = this.detectKeyType(keyData.privateKey, keyData.passphrase)
      const fingerprint = this.generateFingerprint(publicKey)

      // 创建密钥记录
      const key: SSHKey = {
        id,
        name: keyData.name,
        type,
        publicKey,
        privateKeyPath,
        fingerprint,
        comment: keyData.comment,
        createdAt: new Date().toISOString(),
        usageCount: 0,
        protected: !!keyData.passphrase || this.isPrivateKeyEncrypted(keyData.privateKey)
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
  updateKey(id: string, updates: { name?: string; comment?: string; privateKey?: string; publicKey?: string; passphrase?: string }): void {
    const key = this.keys.get(id)
    if (!key) {
      throw new Error('Key not found')
    }

    // 更新基本信息
    if (updates.name !== undefined) key.name = updates.name
    if (updates.comment !== undefined) key.comment = updates.comment

    // 更新私钥内容
    if (updates.privateKey !== undefined && updates.privateKey.trim()) {
      writeFileSync(key.privateKeyPath, updates.privateKey, { mode: 0o600 })
      // 重新检测密钥类型
      key.type = this.detectKeyType(updates.privateKey, updates.passphrase)
      key.protected = !!updates.passphrase || this.isPrivateKeyEncrypted(updates.privateKey)

      if (updates.publicKey === undefined || !updates.publicKey.trim()) {
        const publicKeyPath = `${key.privateKeyPath}.pub`
        const publicKey = this.derivePublicKey(updates.privateKey, updates.passphrase)
        writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })
        key.publicKey = publicKey
        key.fingerprint = this.generateFingerprint(publicKey)
      }
    }

    // 更新公钥内容
    if (updates.publicKey !== undefined && updates.publicKey.trim()) {
      const publicKeyPath = `${key.privateKeyPath}.pub`
      const publicKey = updates.publicKey.trim()
      writeFileSync(publicKeyPath, publicKey, { mode: 0o644 })
      key.publicKey = publicKey
      key.fingerprint = this.generateFingerprint(publicKey)
    }

    if (updates.privateKey === undefined && updates.passphrase) {
      key.protected = true
    }

    key.updatedAt = new Date().toISOString()
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
   * 云同步原样写入密钥（保留 id、时间戳和元数据，私钥写入本机密钥目录）
   */
  syncUpsertKey(raw: any): void {
    if (!raw?.id || typeof raw.privateKeyContent !== 'string' || !raw.privateKeyContent.trim()) {
      return
    }

    const existing = this.keys.get(raw.id)
    const privateKeyPath = existing?.privateKeyPath || join(this.keysDir, String(raw.id))
    const publicKey = String(raw.publicKeyContent || raw.publicKey || '').trim()
    writeFileSync(privateKeyPath, raw.privateKeyContent, { mode: 0o600 })
    if (publicKey) {
      writeFileSync(`${privateKeyPath}.pub`, publicKey, { mode: 0o644 })
    }

    const {
      privateKeyContent: _privateKeyContent,
      publicKeyContent: _publicKeyContent,
      ...metadata
    } = raw
    const key: SSHKey = {
      ...metadata,
      id: String(raw.id),
      name: String(raw.name || raw.id),
      type: raw.type || 'rsa',
      publicKey: publicKey || existing?.publicKey || '',
      privateKeyPath,
      fingerprint:
        raw.fingerprint || (publicKey ? this.generateFingerprint(publicKey) : existing?.fingerprint || ''),
      createdAt: raw.createdAt || existing?.createdAt || new Date().toISOString(),
      usageCount: existing?.usageCount ?? Number(raw.usageCount || 0),
      lastUsed: existing?.lastUsed ?? raw.lastUsed,
      protected: raw.protected === true
    }
    this.keys.set(key.id, key)
    this.saveKeys()
  }

  /**
   * 云同步删除密钥（不存在时忽略）
   */
  syncRemoveKey(id: string): void {
    if (this.keys.has(id)) {
      this.deleteKey(id)
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
  private detectKeyType(privateKey: string, passphrase?: string): SSHKeyType {
    try {
      const parsed = this.parsePrivateKey(privateKey, passphrase)
      return this.mapParsedKeyType(parsed.type)
    } catch {
      // 继续使用下面的兼容判断，支持部分 crypto PEM 或损坏提示。
    }

    // 传统格式可以直接从头部判断
    if (privateKey.includes('RSA PRIVATE KEY')) {
      return 'rsa'
    } else if (privateKey.includes('EC PRIVATE KEY')) {
      return 'ecdsa'
    } else if (privateKey.includes('OPENSSH PRIVATE KEY')) {
      return 'rsa'
    } else if (privateKey.includes('BEGIN PRIVATE KEY') || privateKey.includes('BEGIN ENCRYPTED PRIVATE KEY')) {
      // PKCS8 通用格式，尝试用 crypto 解析来判断实际类型
      try {
        const keyObj = createPrivateKey(
          passphrase ? { key: privateKey, format: 'pem', passphrase } : { key: privateKey, format: 'pem' }
        )
        const asymType = keyObj.asymmetricKeyType
        if (asymType === 'ec') return 'ecdsa'
        if (asymType === 'ed25519') return 'ed25519'
        if (asymType === 'rsa') return 'rsa'
      } catch {
        // 可能是加密的 PKCS8，无法不带密码解析，默认 rsa
      }
      return 'rsa'
    }
    return 'rsa' // 默认
  }

  /**
   * 生成指纹
   */
  private generateFingerprint(publicKey: string): string {
    const keyMaterial = this.getPublicKeyMaterial(publicKey)
    return `SHA256:${createHash('sha256')
      .update(keyMaterial)
      .digest('base64')
      .replace(/=+$/, '')}`
  }

  private parsePrivateKey(privateKey: string, passphrase?: string): ParsedKey {
    const parsed = ssh2Utils.parseKey(privateKey, passphrase)
    if (parsed instanceof Error) {
      throw parsed
    }

    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key || !key.isPrivateKey()) {
      throw new Error('不是有效的 SSH 私钥')
    }

    return key
  }

  private parsePublicKey(publicKey: string): ParsedKey {
    const parsed = ssh2Utils.parseKey(publicKey.trim())
    if (parsed instanceof Error) {
      throw parsed
    }

    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key) {
      throw new Error('不是有效的 SSH 公钥')
    }

    return key
  }

  private derivePublicKey(privateKey: string, passphrase?: string): string {
    const parsed = this.parsePrivateKey(privateKey, passphrase)
    const comment = parsed.comment ? ` ${parsed.comment}` : ''
    return `${parsed.type} ${parsed.getPublicSSH().toString('base64')}${comment}`.trim()
  }

  private isSSHAuthorizedPublicKey(publicKey: string): boolean {
    return /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(256|384|521))\s+/.test(publicKey.trim())
  }

  private getPublicKeyMaterial(publicKey: string): Buffer | string {
    try {
      const parsed = this.parsePublicKey(publicKey)
      return parsed.getPublicSSH()
    } catch {
      return publicKey.trim()
    }
  }

  private mapParsedKeyType(type: string): SSHKeyType {
    if (type.includes('ed25519')) return 'ed25519'
    if (type.includes('ecdsa')) return 'ecdsa'
    return 'rsa'
  }

  private isPrivateKeyEncrypted(privateKey: string): boolean {
    const parsed = ssh2Utils.parseKey(privateKey)
    if (parsed instanceof Error) {
      return /encrypted|passphrase/i.test(parsed.message) ||
        privateKey.includes('BEGIN ENCRYPTED PRIVATE KEY')
    }

    return privateKey.includes('BEGIN ENCRYPTED PRIVATE KEY')
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
