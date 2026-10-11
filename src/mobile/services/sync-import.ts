import type { MobileBackupData } from '../types'
import { scrypt } from 'scrypt-js'

interface DesktopSyncEnvelope {
  encrypted?: boolean
  data?: string
  checksum?: string
  lastModified?: string
}

const SYNC_SALT = 'mshell-sync-salt'
const BACKUP_SALT = 'mshell-backup-encryption-key-v1'

export const parseBackupOrSyncPayload = async (
  text: string,
  password?: string
): Promise<MobileBackupData> => {
  let currentText = text.trim()
  for (let depth = 0; depth < 4; depth += 1) {
    const parsed = await parseJsonOrEncryptedBackup(currentText, password)
    const nestedText = extractNestedPayloadText(parsed)
    if (nestedText) {
      currentText = nestedText.trim()
      continue
    }
    return parseParsedPayload(parsed, password)
  }

  throw new Error('同步数据嵌套层级过深，无法导入')
}

const parseJsonOrEncryptedBackup = async (text: string, password?: string): Promise<unknown> => {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    if (looksLikeJson(trimmed)) {
      throw new Error('同步/备份 JSON 不完整或格式不正确，请重新从 URL 读取完整内容')
    }
    if (!looksLikeDesktopAesCbcData(trimmed)) {
      throw new Error('不支持的导入数据格式，请粘贴同步 JSON、备份 JSON 或 .mshell 加密备份内容')
    }
    if (!password) {
      throw new Error('该备份可能已加密，请输入备份密码')
    }
    return JSON.parse(await decryptDesktopAesCbcData(trimmed, password, BACKUP_SALT, '备份数据'))
  }
}

const parseParsedPayload = async (
  parsed: unknown,
  password?: string
): Promise<MobileBackupData> => {
  if (isBackupData(parsed)) {
    return parsed
  }

  if (isSyncEnvelope(parsed)) {
    if (parsed.encrypted) {
      if (!password) {
        throw new Error('该同步数据已加密，请输入同步加密密码')
      }
      if (!looksLikeDesktopAesCbcData(parsed.data || '')) {
        throw new Error('同步数据加密格式不正确，请重新从 URL 读取完整内容')
      }
      const decrypted = await decryptDesktopAesCbcData(
        parsed.data || '',
        password,
        SYNC_SALT,
        '同步数据'
      )
      const data = JSON.parse(decrypted)
      if (!isBackupData(data)) {
        throw new Error('同步数据格式不正确')
      }
      return data
    }

    const data =
      typeof parsed.data === 'string' ? JSON.parse(parsed.data || '{}') : parsed.data || {}
    if (!isBackupData(data)) {
      throw new Error('同步数据格式不正确')
    }
    return data
  }

  throw new Error('不支持的导入数据格式')
}

const extractNestedPayloadText = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as any
  const gistFile = findNestedPayloadFile(candidate)
  if (gistFile?.truncated) {
    throw new Error('GitHub Gist 同步文件内容被截断，请使用 URL 读取或 raw 地址重新读取完整内容')
  }
  if (typeof gistFile?.content === 'string') {
    return gistFile.content
  }

  if (!isBackupData(value) && !isSyncEnvelope(value) && typeof candidate.content === 'string') {
    return candidate.content
  }

  return undefined
}

const findNestedPayloadFile = (candidate: any): any | undefined => {
  const files = candidate.files
  if (!files || typeof files !== 'object') {
    return undefined
  }

  return (
    files['mshell-sync.json'] ||
    files['mshell-backup.json'] ||
    Object.values(files).find((file: any) => {
      const name = String(file?.filename || '')
      return name === 'mshell-sync.json' || name === 'mshell-backup.json'
    })
  )
}

const isBackupData = (value: any): value is MobileBackupData => {
  return (
    !!value && typeof value === 'object' && typeof value.version === 'string' && !!value.timestamp
  )
}

const isSyncEnvelope = (value: any): value is DesktopSyncEnvelope => {
  return (
    !!value &&
    typeof value === 'object' &&
    'data' in value &&
    ('checksum' in value || 'encrypted' in value || 'lastModified' in value)
  )
}

const looksLikeJson = (text: string): boolean => /^[{\[]/.test(text)

const looksLikeDesktopAesCbcData = (value: string): boolean => {
  const compact = value.trim().replace(/\s+/g, '')
  const colonIndex = compact.indexOf(':')
  if (colonIndex < 0) {
    return false
  }

  const ivHex = compact.slice(0, colonIndex)
  const encryptedHex = compact.slice(colonIndex + 1)
  return (
    ivHex.length === 32 &&
    encryptedHex.length > 0 &&
    encryptedHex.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    /^[0-9a-f]+$/i.test(encryptedHex)
  )
}

export const decryptDesktopAesCbcData = async (
  encryptedData: string,
  password: string,
  salt: string,
  label: string
): Promise<string> => {
  const compact = encryptedData.trim().replace(/\s+/g, '')
  const colonIndex = compact.indexOf(':')
  const ivHex = colonIndex >= 0 ? compact.slice(0, colonIndex) : ''
  const encryptedHex = colonIndex >= 0 ? compact.slice(colonIndex + 1) : ''
  if (!ivHex || !encryptedHex) {
    throw new Error(`${label}加密格式不正确`)
  }

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
    ['decrypt']
  )

  try {
    const iv = new Uint8Array(toArrayBuffer(hexToBytes(ivHex)))
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv },
      key,
      toArrayBuffer(hexToBytes(encryptedHex))
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new Error(`${label}解密失败，请检查密码`)
  }
}

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
