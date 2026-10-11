import { scrypt } from 'scrypt-js'
import type { MobileBackupData } from '../types'

const SYNC_SALT = 'mshell-sync-salt'
const BACKUP_SALT = 'mshell-backup-encryption-key-v1'

interface MobileSyncEnvelope {
  version: string
  appVersion: string
  syncFormat?: number
  lastModified: string
  checksum: string
  encrypted: boolean
  data: string
}

export const createBackupJson = (data: MobileBackupData): string => JSON.stringify(data, null, 2)

export const createEncryptedBackupPayload = async (
  data: MobileBackupData,
  password: string
): Promise<string> => {
  if (!password.trim()) {
    throw new Error('请先输入备份加密密码')
  }
  return encryptDesktopAesCbcData(JSON.stringify(data, null, 2), password, BACKUP_SALT)
}

export const createSyncPayload = async (
  data: MobileBackupData,
  password?: string,
  options: { syncFormat?: number } = {}
): Promise<string> => {
  const jsonData = JSON.stringify(data)
  const encrypted = Boolean(password?.trim())
  const envelope: MobileSyncEnvelope = {
    version: '1.0.0',
    appVersion: 'mshell-mobile',
    ...(options.syncFormat ? { syncFormat: options.syncFormat } : {}),
    lastModified: new Date().toISOString(),
    checksum: await calculateBackupChecksum(data),
    encrypted,
    data: encrypted ? await encryptDesktopAesCbcData(jsonData, password || '', SYNC_SALT) : jsonData
  }

  return JSON.stringify(envelope, null, 2)
}

export const calculateBackupChecksum = async (data: MobileBackupData): Promise<string> => {
  const { timestamp, ...stableData } = data
  void timestamp
  return calculateChecksum(JSON.stringify(stableData))
}

const calculateChecksum = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest)).slice(0, 16)
}

export const encryptSyncText = (data: string, password: string): Promise<string> =>
  encryptDesktopAesCbcData(data, password, SYNC_SALT)

const encryptDesktopAesCbcData = async (
  data: string,
  password: string,
  salt: string
): Promise<string> => {
  const rawKey = await scrypt(
    new TextEncoder().encode(password),
    new TextEncoder().encode(salt),
    16384,
    8,
    1,
    32
  )
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(rawKey),
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  )
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    new TextEncoder().encode(data)
  )

  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(encrypted))}`
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
