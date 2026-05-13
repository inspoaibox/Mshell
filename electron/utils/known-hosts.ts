import { app } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { appSettingsManager } from './app-settings'

type KnownHostStatus = 'trusted' | 'unknown' | 'changed'

interface KnownHostRecord {
  host: string
  port: number
  keyType?: string
  key?: string
  fingerprint: string
  addedAt?: string
  createdAt: string
  updatedAt: string
}

type KnownHosts = Record<string, string | KnownHostRecord>

const knownHostsPath = join(app.getPath('userData'), 'known-hosts.json')
const legacyKnownHostsPath = join(app.getPath('userData'), 'known_hosts')

const getHostKeyId = (host: string, port: number): string => `${host}:${port}`

const parseHostKeyId = (hostKeyId: string) => {
  const separatorIndex = hostKeyId.lastIndexOf(':')
  if (separatorIndex <= 0) {
    return { host: hostKeyId, port: 22 }
  }

  const host = hostKeyId.slice(0, separatorIndex)
  const port = Number(hostKeyId.slice(separatorIndex + 1)) || 22
  return { host, port }
}

const getHostKeyFingerprint = (key: Buffer): string => {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

const loadKnownHosts = (): KnownHosts => {
  try {
    if (!existsSync(knownHostsPath)) {
      return loadLegacyKnownHosts()
    }
    return JSON.parse(readFileSync(knownHostsPath, 'utf-8'))
  } catch (error) {
    console.error('[KnownHosts] Failed to load known hosts:', error)
    return {}
  }
}

const loadLegacyKnownHosts = (): KnownHosts => {
  const knownHosts: KnownHosts = {}
  if (!existsSync(legacyKnownHostsPath)) return knownHosts

  try {
    const now = new Date().toISOString()
    const lines = readFileSync(legacyKnownHostsPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('#'))

    for (const line of lines) {
      const [hostPort, keyType, key] = line.trim().split(/\s+/)
      if (!hostPort || !key) continue

      const { host, port } = parseHostKeyId(hostPort)
      const keyBuffer = Buffer.from(key, 'base64')
      knownHosts[getHostKeyId(host, port)] = {
        host,
        port,
        keyType,
        key,
        fingerprint: getHostKeyFingerprint(keyBuffer),
        addedAt: now,
        createdAt: now,
        updatedAt: now
      }
    }

    if (Object.keys(knownHosts).length > 0) {
      saveKnownHosts(knownHosts)
    }
  } catch (error) {
    console.error('[KnownHosts] Failed to migrate legacy known hosts:', error)
  }

  return knownHosts
}

const saveKnownHosts = (knownHosts: KnownHosts): void => {
  try {
    mkdirSync(dirname(knownHostsPath), { recursive: true })
    writeFileSync(knownHostsPath, JSON.stringify(knownHosts, null, 2), 'utf-8')
  } catch (error) {
    console.error('[KnownHosts] Failed to save known hosts:', error)
  }
}

const toKnownHostRecord = (host: string, port: number, value?: string | KnownHostRecord) => {
  if (!value) return undefined

  if (typeof value === 'string') {
    return {
      host,
      port,
      fingerprint: value,
      addedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  }

  return value
}

export const knownHostsManager = {
  verifyHost(host: string, port: number, keyType: string | undefined, key: Buffer): KnownHostStatus {
    const hostKeyId = getHostKeyId(host, port)
    const fingerprint = getHostKeyFingerprint(key)
    const knownHosts = loadKnownHosts()
    const knownHost = toKnownHostRecord(host, port, knownHosts[hostKeyId])

    if (!knownHost) {
      return 'unknown'
    }

    if (knownHost.fingerprint !== fingerprint) {
      return 'changed'
    }

    if (knownHost.keyType !== keyType && keyType) {
      knownHosts[hostKeyId] = {
        ...knownHost,
        keyType,
        updatedAt: new Date().toISOString()
      }
      saveKnownHosts(knownHosts)
    }

    return 'trusted'
  },

  addHost(host: string, port: number, keyType: string | undefined, key: Buffer): KnownHostRecord {
    const hostKeyId = getHostKeyId(host, port)
    const fingerprint = getHostKeyFingerprint(key)
    const knownHosts = loadKnownHosts()
    const existing = toKnownHostRecord(host, port, knownHosts[hostKeyId])
    const now = new Date().toISOString()
    const record: KnownHostRecord = {
      host,
      port,
      keyType,
      key: key.toString('base64'),
      fingerprint,
      addedAt: existing?.addedAt || existing?.createdAt || now,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    knownHosts[hostKeyId] = record
    saveKnownHosts(knownHosts)
    return record
  },

  getHost(host: string, port: number): KnownHostRecord | undefined {
    const hostKeyId = getHostKeyId(host, port)
    return toKnownHostRecord(host, port, loadKnownHosts()[hostKeyId])
  },

  getAllHosts(): KnownHostRecord[] {
    return Object.entries(loadKnownHosts()).map(([hostKeyId, value]) => {
      const { host, port } = parseHostKeyId(hostKeyId)
      return toKnownHostRecord(host, port, value)!
    })
  },

  removeHost(host: string, port: number): void {
    const hostKeyId = getHostKeyId(host, port)
    const knownHosts = loadKnownHosts()
    delete knownHosts[hostKeyId]
    saveKnownHosts(knownHosts)
  }
}

export const verifySshHostKey = (host: string, port: number, key: Buffer): boolean => {
  const settings = appSettingsManager.getSettings()
  if (settings.security.verifyHostKey === false) {
    return true
  }

  const hostKeyId = getHostKeyId(host, port)
  const result = knownHostsManager.verifyHost(host, port, undefined, key)

  if (result === 'unknown') {
    const hostKey = knownHostsManager.addHost(host, port, undefined, key)
    console.log(`[KnownHosts] Trusting new host key ${hostKeyId} ${hostKey.fingerprint}`)
    return true
  }

  if (result === 'changed') {
    const knownHost = knownHostsManager.getHost(host, port)
    const receivedFingerprint = getHostKeyFingerprint(key)
    console.error(
      `[KnownHosts] Host key mismatch for ${hostKeyId}. Known=${knownHost?.fingerprint}, received=${receivedFingerprint}`
    )
    return false
  }

  return true
}
