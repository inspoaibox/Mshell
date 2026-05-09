/* global Buffer */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CredentialManager } from '../CredentialManager'
import * as fc from 'fast-check'

// Mock Electron's safeStorage
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => {
      // Simple mock encryption: reverse the string and encode
      return Buffer.from(text.split('').reverse().join(''))
    },
    decryptString: (buffer: Buffer) => {
      // Simple mock decryption: decode and reverse
      return buffer.toString().split('').reverse().join('')
    }
  }
}))

describe('CredentialManager', () => {
  let credentialManager: CredentialManager

  beforeEach(() => {
    credentialManager = new CredentialManager()
  })

  describe('Unit Tests', () => {
    it('should check if encryption is available', () => {
      const available = credentialManager.isEncryptionAvailable()
      expect(typeof available).toBe('boolean')
    })

    it('should encrypt a simple string', () => {
      const plaintext = 'myPassword123'
      const encrypted = credentialManager.encrypt(plaintext)

      expect(encrypted).toBeDefined()
      expect(encrypted).not.toBe(plaintext)
      expect(typeof encrypted).toBe('string')
    })

    it('should decrypt an encrypted string', () => {
      const plaintext = 'myPassword123'
      const encrypted = credentialManager.encrypt(plaintext)
      const decrypted = credentialManager.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('should handle empty strings', () => {
      const plaintext = ''
      const encrypted = credentialManager.encrypt(plaintext)
      const decrypted = credentialManager.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('should encrypt and decrypt special characters', () => {
      const plaintext = '!@#$%^&*()_+-=[]{}|;:,.<>?'
      const encrypted = credentialManager.encrypt(plaintext)
      const decrypted = credentialManager.decrypt(encrypted)

      expect(decrypted).toBe(plaintext)
    })

    it('should encrypt fields in an object', () => {
      const obj = {
        username: 'user',
        password: 'secret123',
        host: 'example.com'
      }

      const encrypted = credentialManager.encryptFields(obj, ['password'])

      expect(encrypted.username).toBe('user')
      expect(encrypted.host).toBe('example.com')
      expect(encrypted.password).not.toBe('secret123')
    })

    it('should decrypt fields in an object', () => {
      const obj = {
        username: 'user',
        password: 'secret123',
        host: 'example.com'
      }

      const encrypted = credentialManager.encryptFields(obj, ['password'])
      const decrypted = credentialManager.decryptFields(encrypted, ['password'])

      expect(decrypted).toEqual(obj)
    })

    it('should mark prefixed ciphertext and keep encryption idempotent', () => {
      const plaintext = 'secret123'
      const encrypted = credentialManager.encrypt(plaintext)

      expect(encrypted.startsWith('safe:v1:')).toBe(true)
      expect(credentialManager.isEncrypted(encrypted)).toBe(true)
      expect(credentialManager.encrypt(encrypted)).toBe(encrypted)
    })

    it('should decrypt legacy unprefixed safeStorage values when possible', () => {
      const legacyCiphertext = Buffer.from('terces').toString('base64')

      expect(credentialManager.isEncrypted(legacyCiphertext)).toBe(false)
      expect(credentialManager.decryptLegacyUnprefixed(legacyCiphertext)).toBe('secret')
    })
  })

  describe('Property-Based Tests', () => {
    // Feature: windows-ssh-client, Property 16: 敏感信息加密存储
    // Validates: Requirements 3.9, 10.1
    it('should encrypt any string such that it is not plaintext', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 100 }), (plaintext) => {
          const encrypted = credentialManager.encrypt(plaintext)

          // 加密后的数据不应该等于明文
          expect(encrypted).not.toBe(plaintext)
          // 加密后的数据应该是字符串
          expect(typeof encrypted).toBe('string')
          // 加密后的数据不应该为空
          expect(encrypted.length).toBeGreaterThan(0)
        }),
        { numRuns: 100 }
      )
    })

    // Feature: windows-ssh-client, Property 16: 加密后解密能恢复原始内容
    // Validates: Requirements 3.9, 10.1
    it('should decrypt any encrypted string back to original', () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 200 }), (plaintext) => {
          const encrypted = credentialManager.encrypt(plaintext)
          const decrypted = credentialManager.decrypt(encrypted)

          // 解密后应该恢复原始内容
          expect(decrypted).toBe(plaintext)
        }),
        { numRuns: 100 }
      )
    })

    it('should handle unicode characters correctly', () => {
      fc.assert(
        fc.property(fc.unicodeString({ minLength: 1, maxLength: 50 }), (plaintext) => {
          const encrypted = credentialManager.encrypt(plaintext)
          const decrypted = credentialManager.decrypt(encrypted)

          expect(decrypted).toBe(plaintext)
        }),
        { numRuns: 100 }
      )
    })

    it('should encrypt/decrypt multiple fields correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            field1: fc.string(),
            field2: fc.string(),
            field3: fc.string()
          }),
          (obj) => {
            const fieldsToEncrypt: (keyof typeof obj)[] = ['field1', 'field3']
            const encrypted = credentialManager.encryptFields(obj, fieldsToEncrypt)
            const decrypted = credentialManager.decryptFields(encrypted, fieldsToEncrypt)

            expect(decrypted).toEqual(obj)
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
