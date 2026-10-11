import {
  DESKTOP_SYNC_SCHEMA,
  SYNC_FORMAT_VERSION,
  isNonSshSession,
  mergeSnapshot,
  stableStringify,
  type CategoryChanges,
  type CollectionSchema,
  type MassDeleteWarning,
  type SnapshotMergeResult,
  type SyncConflict,
  type SyncSchema
} from '@/lib/sync/merge'
import type { MobileBackupData } from '../types'
import {
  MOBILE_BACKUP_VERSION,
  MOBILE_SYNC_CATEGORIES,
  pickMobileSyncData,
  type MobileSyncData
} from './mobile-store'
import { decryptDesktopAesCbcData, parseBackupOrSyncPayload } from './sync-import'
import { createSyncPayload, encryptSyncText } from './sync-export'
import { parseRemoteTarget } from './remote-sync'

const BASE_STORAGE_KEY = 'mshell-mobile-sync-base-v1'
const SYNC_SALT = 'mshell-sync-salt'
const MAX_ATTEMPTS = 3

const withVolatile = (schema: CollectionSchema, fields: string[]): CollectionSchema => ({
  ...schema,
  volatile: [...(schema.volatile || []), ...fields]
})

/**
 * 移动端只合并自己管理的类别；本地存储会补默认 createdAt，因此不比较它。
 */
export const MOBILE_SYNC_SCHEMA: SyncSchema = {
  sessionGroups: DESKTOP_SYNC_SCHEMA.sessionGroups,
  sessions: withVolatile(DESKTOP_SYNC_SCHEMA.sessions as CollectionSchema, ['createdAt']),
  snippets: withVolatile(DESKTOP_SYNC_SCHEMA.snippets as CollectionSchema, ['createdAt']),
  quickCommands: withVolatile(DESKTOP_SYNC_SCHEMA.quickCommands as CollectionSchema, ['createdAt']),
  sshKeys: withVolatile(DESKTOP_SYNC_SCHEMA.sshKeys as CollectionSchema, ['createdAt'])
}

export interface MobileSyncBase {
  provider: string
  remoteUrl: string
  data: MobileSyncData
}

export interface MobileSyncStore {
  exportSyncData: () => MobileSyncData
  applySyncChanges: (changes: Record<string, CategoryChanges>) => unknown
  importBackup: (data: MobileBackupData) => unknown
}

export interface MobileSyncDeps {
  store: MobileSyncStore
  password: string
  /** 读取云端同步文件内容；云端还没有同步数据时返回 undefined */
  loadRemote: () => Promise<string | undefined>
  /** 上传同步文件内容，返回最新的远端地址 */
  upload: (content: string) => Promise<{ remoteUrl: string; created?: boolean }>
  loadBase: () => Promise<MobileSyncData | undefined>
  saveBase: (data: MobileSyncData, remoteUrl?: string) => Promise<void>
}

export interface MobileSyncResult {
  action: 'uploaded' | 'merged' | 'no-change' | 'needs-confirm'
  remoteUrl?: string
  created?: boolean
  summary?: SnapshotMergeResult['summary']
  conflicts: SyncConflict[]
  massDeletes: MassDeleteWarning[]
}

interface DecodedRemote {
  data: Record<string, any>
  owned: MobileSyncData
}

const decodeRemote = async (text: string, password: string): Promise<DecodedRemote> => {
  const data = (await parseBackupOrSyncPayload(text, password)) as Record<string, any>
  return { data, owned: pickMobileSyncData(data) }
}

const contentWithout = (record: any, volatile: string[]): string => {
  const copy: Record<string, unknown> = { ...record }
  for (const field of volatile) delete copy[field]
  return stableStringify(copy)
}

/**
 * 生成上传内容：移动端管理的类别使用合并结果，其余类别（端口转发、设置、AI 等）
 * 以及非 SSH 会话原样保留云端数据。内容未变化的记录保留云端原始形状，避免桌面端误判为修改。
 */
export const buildMobileUploadData = (
  merged: MobileSyncData,
  remoteData: Record<string, any> | undefined
): MobileBackupData => {
  const result: Record<string, any> = {
    ...(remoteData || {}),
    version: remoteData?.version || MOBILE_BACKUP_VERSION,
    timestamp: new Date().toISOString()
  }

  for (const category of MOBILE_SYNC_CATEGORIES) {
    const volatile = (MOBILE_SYNC_SCHEMA[category] as CollectionSchema).volatile || []
    const rawRemote = Array.isArray(remoteData?.[category]) ? remoteData![category] : []
    const remoteOwned = pickMobileSyncData({ [category]: rawRemote })[category]
    const rawById = new Map<string, { raw: any; content: string }>()
    rawRemote.forEach((raw: any) => {
      const normalized = remoteOwned.find((item) => item.id === raw?.id)
      if (normalized) {
        rawById.set(normalized.id, { raw, content: contentWithout(normalized, volatile) })
      }
    })

    result[category] = merged[category].map((record) => {
      const remote = rawById.get(record.id)
      return remote && remote.content === contentWithout(record, volatile) ? remote.raw : record
    })
  }

  result.sessions = [
    ...result.sessions,
    ...(Array.isArray(remoteData?.sessions) ? remoteData!.sessions.filter(isNonSshSession) : [])
  ]
  return result as MobileBackupData
}

const createPayload = (data: MobileBackupData, password: string) =>
  createSyncPayload(data, password, { syncFormat: SYNC_FORMAT_VERSION })

/**
 * 智能同步：与云端逐条三方合并，双方各自的修改都会保留；
 * 同一条记录两边都改时保留 updatedAt 较新的版本。
 */
export const runMobileMergeSync = async (
  deps: MobileSyncDeps,
  options: { allowMassDelete?: boolean } = {}
): Promise<MobileSyncResult> => {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const remoteText = await deps.loadRemote()
    const local = pickMobileSyncData(deps.store.exportSyncData())

    if (remoteText === undefined) {
      const uploaded = await deps.upload(await createPayload(buildMobileUploadData(local, undefined), deps.password))
      await deps.saveBase(local, uploaded.remoteUrl)
      return {
        action: 'uploaded',
        remoteUrl: uploaded.remoteUrl,
        created: uploaded.created,
        conflicts: [],
        massDeletes: []
      }
    }

    const remote = await decodeRemote(remoteText, deps.password)
    const base = await deps.loadBase()
    const result = mergeSnapshot(base, local, remote.owned, MOBILE_SYNC_SCHEMA)

    if (result.massDeletes.length > 0 && !options.allowMassDelete) {
      return {
        action: 'needs-confirm',
        summary: result.summary,
        conflicts: result.conflicts,
        massDeletes: result.massDeletes
      }
    }

    // 上传前确认云端没有被其它设备改过，否则重新合并
    if (result.remoteChanged && (await deps.loadRemote()) !== remoteText) {
      continue
    }

    const mergedData = {} as MobileSyncData
    for (const category of MOBILE_SYNC_CATEGORIES) {
      mergedData[category] = result.merged[category] || []
    }

    if (Object.keys(result.localChanges).length > 0) {
      deps.store.applySyncChanges(result.localChanges)
    }

    let uploaded: { remoteUrl: string; created?: boolean } | undefined
    if (result.remoteChanged) {
      uploaded = await deps.upload(
        await createPayload(buildMobileUploadData(mergedData, remote.data), deps.password)
      )
    }
    await deps.saveBase(mergedData, uploaded?.remoteUrl)

    const changed = result.remoteChanged || Object.keys(result.localChanges).length > 0
    return {
      action: changed ? 'merged' : 'no-change',
      remoteUrl: uploaded?.remoteUrl,
      summary: result.summary,
      conflicts: result.conflicts,
      massDeletes: []
    }
  }

  throw new Error('云端数据在同步过程中多次被其它设备修改，请稍后重试')
}

/**
 * 上传本地（不合并）：移动端管理的类别以本地为准，桌面端独有的数据从云端原样保留。
 * 云端存在但无法读取时抛错，避免清空桌面端数据；传入 ignoreRemoteErrors 可强制只上传移动端数据。
 */
export const forceUploadMobile = async (
  deps: MobileSyncDeps,
  options: { ignoreRemoteErrors?: boolean } = {}
): Promise<{ remoteUrl: string; created?: boolean }> => {
  const local = pickMobileSyncData(deps.store.exportSyncData())
  let remoteData: Record<string, any> | undefined
  try {
    const remoteText = await deps.loadRemote()
    if (remoteText !== undefined) {
      remoteData = (await decodeRemote(remoteText, deps.password)).data
    }
  } catch (error: any) {
    if (!options.ignoreRemoteErrors) {
      throw new RemoteReadError(error?.message || '读取云端数据失败')
    }
  }

  const uploaded = await deps.upload(
    await createPayload(buildMobileUploadData(local, remoteData), deps.password)
  )
  await deps.saveBase(local, uploaded.remoteUrl)
  return uploaded
}

/**
 * 下载到本地（不删除本地数据）：云端记录新增/覆盖到本地，并把云端数据作为下次合并的基准。
 */
export const forceDownloadMobile = async (deps: MobileSyncDeps): Promise<MobileBackupData> => {
  const remoteText = await deps.loadRemote()
  if (remoteText === undefined) {
    throw new Error('云端还没有同步数据')
  }
  const remote = await decodeRemote(remoteText, deps.password)
  deps.store.importBackup(remote.data as MobileBackupData)
  await deps.saveBase(remote.owned)
  return remote.data as MobileBackupData
}

export class RemoteReadError extends Error {}

/**
 * 同步基准保存在本机，使用同步密码加密（包含密码和私钥）。
 * 换了同步服务、地址或密码时视为没有基准，下次同步按首次合并处理（不删除数据）。
 */
export const loadMobileSyncBase = async (
  provider: string,
  remoteUrl: string,
  password: string
): Promise<MobileSyncData | undefined> => {
  try {
    const raw = localStorage.getItem(BASE_STORAGE_KEY)
    if (!raw) return undefined
    const stored = JSON.parse(raw) as { provider?: string; remoteUrl?: string; data?: string }
    if (stored.provider !== provider || !sameRemote(stored.remoteUrl, remoteUrl) || !stored.data) {
      return undefined
    }
    const decrypted = await decryptDesktopAesCbcData(stored.data, password, SYNC_SALT, '同步基准')
    return pickMobileSyncData(JSON.parse(decrypted))
  } catch {
    return undefined
  }
}

export const saveMobileSyncBase = async (
  provider: string,
  remoteUrl: string,
  password: string,
  data: MobileSyncData
): Promise<void> => {
  localStorage.setItem(
    BASE_STORAGE_KEY,
    JSON.stringify({
      provider,
      remoteUrl,
      data: await encryptSyncText(JSON.stringify(data), password)
    })
  )
}

export const clearMobileSyncBase = (): void => {
  localStorage.removeItem(BASE_STORAGE_KEY)
}

const sameRemote = (left: string | undefined, right: string): boolean =>
  remoteIdOf(left || '') === remoteIdOf(right)

const remoteIdOf = (url: string): string => {
  try {
    const target = parseRemoteTarget(url)
    return `${target.source}:${target.id || target.requestUrl}`
  } catch {
    return url.trim()
  }
}

export const formatMassDeleteMessage = (warnings: MassDeleteWarning[]): string =>
  warnings
    .map((item) => `${item.label}：将删除 ${item.deleteCount} 项（本地共 ${item.localCount} 项）`)
    .join('\n')

export const formatConflictMessage = (conflicts: SyncConflict[]): string =>
  conflicts
    .map(
      (item) =>
        `${item.label}「${item.name}」：${item.kept === 'remote' ? '保留云端版本' : '保留本机版本'}`
    )
    .join('\n')
