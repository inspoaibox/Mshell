import { safeStorage } from 'electron'

/**
 * CredentialManager - 安全地加密和解密敏感信息
 * 使用 Electron safeStorage API (Windows 上使用 DPAPI)
 */
export class CredentialManager {
  /**
   * 检查加密功能是否可用
   */
  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  /**
   * 加密明文字符串
   * @param plaintext 要加密的明文
   * @returns Base64 编码的加密字符串
   */
  encrypt(plaintext: string): string {
    // 已经是加密格式的值直接返回，防止双重加密
    if (plaintext.startsWith('enc:') || plaintext.startsWith('b64:')) {
      return plaintext
    }

    if (!this.isEncryptionAvailable()) {
      console.warn('Encryption not available, storing as base64 (NOT SECURE)')
      return Buffer.from(plaintext).toString('base64')
    }

    try {
      const encrypted = safeStorage.encryptString(plaintext)
      return encrypted.toString('base64')
    } catch (error) {
      console.error('Encryption failed:', error)
      throw new Error('Failed to encrypt data')
    }
  }

  /**
   * 解密加密的字符串
   * @param ciphertext Base64 编码的加密字符串
   * @returns 解密后的明文
   */
  decrypt(ciphertext: string): string {
    // 处理带 enc: 前缀的数据（之前版本错误写入的格式）
    if (ciphertext.startsWith('enc:')) {
      const base64Part = ciphertext.slice(4)
      if (!this.isEncryptionAvailable()) {
        return Buffer.from(base64Part, 'base64').toString('utf-8')
      }
      try {
        const buffer = Buffer.from(base64Part, 'base64')
        return safeStorage.decryptString(buffer)
      } catch (error) {
        console.error('Decryption failed for enc: prefixed value:', error)
        throw new Error('Failed to decrypt data')
      }
    }

    // 处理带 b64: 前缀的数据
    if (ciphertext.startsWith('b64:')) {
      return Buffer.from(ciphertext.slice(4), 'base64').toString('utf-8')
    }

    // 标准格式（无前缀，直接 base64 编码的 safeStorage 密文）
    if (!this.isEncryptionAvailable()) {
      return Buffer.from(ciphertext, 'base64').toString('utf-8')
    }

    try {
      const buffer = Buffer.from(ciphertext, 'base64')
      return safeStorage.decryptString(buffer)
    } catch (error) {
      console.error('Decryption failed:', error)
      throw new Error('Failed to decrypt data')
    }
  }

  /**
   * 检查字符串是否已加密（用于备份恢复时判断是否为明文）
   * 旧格式无法可靠判断，只能尝试解密
   */
  isEncrypted(_value: string): boolean {
    return false // 保守策略：始终尝试解密，失败则保留原值
  }

  /**
   * 批量加密对象中的敏感字段
   * @param obj 包含敏感字段的对象
   * @param fields 需要加密的字段名数组
   * @returns 加密后的对象
   */
  encryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj }
    for (const field of fields) {
      // 只加密非空字符串（空字符串和 undefined/null 不加密，保持原样）
      if (result[field] !== undefined && result[field] !== null && 
          typeof result[field] === 'string' && result[field] !== '') {
        result[field] = this.encrypt(result[field] as string) as any
      }
    }
    return result
  }

  /**
   * 批量解密对象中的敏感字段
   * @param obj 包含加密字段的对象
   * @param fields 需要解密的字段名数组
   * @returns 解密后的对象
   */
  decryptFields<T extends Record<string, any>>(obj: T, fields: (keyof T)[]): T {
    const result = { ...obj }
    for (const field of fields) {
      if (result[field] && typeof result[field] === 'string') {
        try {
          result[field] = this.decrypt(result[field] as string) as any
        } catch (error) {
          console.error(`Failed to decrypt field ${String(field)}:`, error)
          // 解密失败保持原值（可能是明文，来自备份/导入）
        }
      }
    }
    return result
  }
}

// 导出单例实例
export const credentialManager = new CredentialManager()
