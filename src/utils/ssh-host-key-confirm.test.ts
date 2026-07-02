import { describe, expect, it } from 'vitest'
import { createSSHConnectOptions } from './ssh-host-key-confirm'
import type { SessionConfig } from '@/types/session'

const baseSession = {
  id: 'session-1',
  name: 'Test SSH',
  type: 'ssh',
  host: 'example.com',
  port: 22,
  username: 'root',
  createdAt: new Date(),
  updatedAt: new Date()
} satisfies Omit<SessionConfig, 'authType'>

describe('createSSHConnectOptions', () => {
  it('uses only password credentials for password auth sessions', () => {
    const options = createSSHConnectOptions({
      ...baseSession,
      authType: 'password',
      password: 'wrong-password',
      privateKeyId: 'key-1',
      privateKeyPath: '/tmp/id_rsa',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      passphrase: 'key-passphrase'
    })

    expect(options.authType).toBe('password')
    expect(options.password).toBe('wrong-password')
    expect(options.privateKeyId).toBeUndefined()
    expect(options.privateKey).toBeUndefined()
    expect(options.passphrase).toBeUndefined()
  })

  it('uses only private key credentials for private key auth sessions', () => {
    const options = createSSHConnectOptions({
      ...baseSession,
      authType: 'privateKey',
      password: 'saved-password',
      privateKeyId: 'key-1',
      privateKeyPath: '/tmp/id_rsa',
      passphrase: 'key-passphrase'
    })

    expect(options.authType).toBe('privateKey')
    expect(options.password).toBeUndefined()
    expect(options.privateKeyId).toBe('key-1')
    expect(options.privateKey).toBeUndefined()
    expect(options.passphrase).toBe('key-passphrase')
  })

  it('infers private key auth for legacy sessions with key fields', () => {
    const options = createSSHConnectOptions({
      ...baseSession,
      authType: undefined as any,
      password: 'saved-password',
      privateKeyId: 'key-1'
    })

    expect(options.authType).toBe('privateKey')
    expect(options.password).toBeUndefined()
    expect(options.privateKeyId).toBe('key-1')
  })
})
