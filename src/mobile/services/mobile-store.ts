import type { SessionConfig, SessionGroup } from '@/types/session'
import type { CategoryChanges } from '@/lib/sync/merge'
import type {
  MobileBackupData,
  MobileQuickCommand,
  MobileSyncConfig,
  MobileSnippet,
  MobileSSHKey,
  MobileStoreState
} from '../types'

const STORAGE_KEY = 'mshell-mobile-state-v1'
export const MOBILE_BACKUP_VERSION = '0.2.0'
const QUICK_SNIPPET_PREFIX = 'quick:'

const emptyState = (): MobileStoreState => ({
  sessions: [],
  sessionGroups: [],
  snippets: [],
  sshKeys: [],
  syncConfig: undefined
})

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : [])

const hasId = <T extends { id?: unknown }>(value: T): value is T & { id: string } =>
  typeof value.id === 'string' && value.id.trim().length > 0

const normalizeDate = (value: unknown): Date => {
  if (value instanceof Date) {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }
  return new Date()
}

const normalizeDateString = (value: unknown): string => normalizeDate(value).toISOString()

const normalizeSession = (session: SessionConfig): SessionConfig => {
  const sessionWithFallbacks = session as Partial<SessionConfig>
  return {
    ...session,
    type: 'ssh',
    port: Number.isFinite(Number(session.port)) ? Number(session.port) : 22,
    authType: session.authType || 'password',
    createdAt: normalizeDate(sessionWithFallbacks.createdAt),
    updatedAt: normalizeDate(sessionWithFallbacks.updatedAt),
    expiryDate: session.expiryDate ? normalizeDate(session.expiryDate) : undefined,
    lastConnected: session.lastConnected ? normalizeDate(session.lastConnected) : undefined
  }
}

const isSshSession = (session: SessionConfig): boolean =>
  session.type === undefined || session.type === 'ssh'

const normalizeSnippet = (snippet: MobileSnippet): MobileSnippet => ({
  ...snippet,
  name: snippet.name || '未命名片段',
  command: snippet.command || '',
  description: snippet.description || '',
  category: snippet.category || '',
  tags: asArray<string>(snippet.tags),
  variables: asArray<string>(snippet.variables),
  usageCount: Number.isFinite(Number(snippet.usageCount)) ? Number(snippet.usageCount) : 0,
  createdAt: normalizeDateString(snippet.createdAt),
  updatedAt: normalizeDateString(snippet.updatedAt)
})

const quickCommandToSnippet = (command: MobileQuickCommand): MobileSnippet => ({
  id: command.id.startsWith(QUICK_SNIPPET_PREFIX)
    ? command.id
    : `${QUICK_SNIPPET_PREFIX}${command.id}`,
  name: command.name,
  command: command.command,
  description: command.description || '',
  category: command.category || '快捷命令',
  tags: asArray<string>(command.tags),
  variables: [],
  usageCount: Number.isFinite(Number(command.usageCount)) ? Number(command.usageCount) : 0,
  createdAt: normalizeDateString(command.createdAt),
  updatedAt: normalizeDateString(command.updatedAt)
})

const normalizeKey = (key: MobileSSHKey): MobileSSHKey => ({
  ...key,
  name: key.name || '未命名密钥',
  type: key.type || 'rsa',
  publicKey: key.publicKey || key.publicKeyContent || '',
  fingerprint: key.fingerprint || '',
  createdAt: normalizeDateString(key.createdAt),
  usageCount: Number.isFinite(Number(key.usageCount)) ? Number(key.usageCount) : 0,
  protected: Boolean(key.protected),
  privateKeyContent: key.privateKeyContent,
  publicKeyContent: key.publicKeyContent || key.publicKey || ''
})

const snippetToQuickCommand = (snippet: MobileSnippet): MobileQuickCommand => ({
  id: snippet.id.replace(QUICK_SNIPPET_PREFIX, ''),
  name: snippet.name,
  command: snippet.command,
  description: snippet.description,
  category: snippet.category,
  tags: snippet.tags,
  usageCount: snippet.usageCount,
  createdAt: snippet.createdAt,
  updatedAt: snippet.updatedAt
})

const cloneForJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const normalizeSyncConfig = (config?: Partial<MobileSyncConfig>): MobileSyncConfig | undefined => {
  if (!config) return undefined
  return {
    enabled: Boolean(config.enabled),
    provider: config.provider === 'gitlab' ? 'gitlab' : 'github',
    remoteUrl: config.remoteUrl || '',
    token: config.token || '',
    password: config.password || '',
    lastSyncAt: config.lastSyncAt,
    lastUploadAt: config.lastUploadAt,
    lastDownloadAt: config.lastDownloadAt,
    lastSyncChecksum: config.lastSyncChecksum
  }
}

export const createMobileId = (prefix: string): string => {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${random}`
}

export class MobileStore {
  private state: MobileStoreState = emptyState()
  private listeners = new Set<(state: MobileStoreState) => void>()

  load(): MobileStoreState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        return this.getState()
      }

      const parsed = JSON.parse(raw) as Partial<MobileStoreState>
      this.state = {
        ...emptyState(),
        ...parsed,
        sessions: asArray<SessionConfig>(parsed.sessions)
          .filter(isSshSession)
          .map(normalizeSession),
        sessionGroups: asArray<SessionGroup>(parsed.sessionGroups).filter(hasId).map(normalizeSessionGroup),
        snippets: asArray<MobileSnippet>(parsed.snippets).filter(hasId).map(normalizeSnippet),
        sshKeys: asArray<MobileSSHKey>(parsed.sshKeys).filter(hasId).map(normalizeKey),
        syncConfig: normalizeSyncConfig(parsed.syncConfig)
      }
      return this.getState()
    } catch (error) {
      console.error('[MobileStore] Failed to load state', error)
      this.state = emptyState()
      return this.getState()
    }
  }

  subscribe(listener: (state: MobileStoreState) => void): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  getState(): MobileStoreState {
    return {
      ...this.state,
      sessions: [...this.state.sessions],
      sessionGroups: [...this.state.sessionGroups],
      snippets: [...this.state.snippets],
      sshKeys: [...this.state.sshKeys],
      syncConfig: this.state.syncConfig ? { ...this.state.syncConfig } : undefined
    }
  }

  importBackup(data: MobileBackupData): MobileStoreState {
    const sessions = asArray<SessionConfig>(data.sessions)
      .filter(isSshSession)
      .map(normalizeSession)
    const snippets = [
      ...asArray<MobileSnippet>(data.snippets).filter(hasId).map(normalizeSnippet),
      ...asArray<MobileQuickCommand>(data.quickCommands).filter(hasId).map(quickCommandToSnippet)
    ]

    this.state = {
      sessions: mergeById(this.state.sessions, sessions),
      sessionGroups: mergeById(
        this.state.sessionGroups,
        asArray<SessionGroup>(data.sessionGroups).filter(hasId).map(normalizeSessionGroup)
      ),
      snippets: mergeById(this.state.snippets, snippets),
      sshKeys: mergeKeysById(
        this.state.sshKeys,
        asArray<MobileSSHKey>(data.sshKeys).filter(hasId).map(normalizeKey)
      ),
      syncConfig: this.state.syncConfig,
      lastImportedAt: new Date().toISOString()
    }
    this.save()
    return this.getState()
  }

  upsertSession(session: SessionConfig): MobileStoreState {
    const existing = this.state.sessions.find((item) => item.id === session.id)
    const now = new Date()
    this.state.sessions = mergeById(this.state.sessions, [
      normalizeSession({
        ...(existing || session),
        ...session,
        type: 'ssh',
        createdAt: existing?.createdAt || normalizeDate(session.createdAt || now),
        updatedAt: now,
        expiryDate: session.expiryDate ? normalizeDate(session.expiryDate) : undefined,
        lastConnected: session.lastConnected ? normalizeDate(session.lastConnected) : undefined
      })
    ])
    this.save()
    return this.getState()
  }

  upsertSnippet(snippet: MobileSnippet): MobileStoreState {
    const existing = this.state.snippets.find((item) => item.id === snippet.id)
    const now = new Date().toISOString()
    this.state.snippets = mergeById(this.state.snippets, [
      normalizeSnippet({
        ...(existing || snippet),
        ...snippet,
        createdAt: existing?.createdAt || snippet.createdAt || now,
        updatedAt: now
      })
    ])
    this.save()
    return this.getState()
  }

  upsertKey(key: MobileSSHKey): MobileStoreState {
    const existing = this.state.sshKeys.find((item) => item.id === key.id)
    const now = new Date().toISOString()
    this.state.sshKeys = mergeKeysById(this.state.sshKeys, [
      normalizeKey({
        ...(existing || key),
        ...key,
        createdAt: existing?.createdAt || key.createdAt || now,
        updatedAt: now
      })
    ])
    this.save()
    return this.getState()
  }

  deleteSession(id: string): MobileStoreState {
    this.state.sessions = this.state.sessions.filter((session) => session.id !== id)
    this.state.sessionGroups = this.state.sessionGroups.map((group) => ({
      ...group,
      sessions: asArray<string>(group.sessions).filter((sessionId) => sessionId !== id)
    }))
    this.save()
    return this.getState()
  }

  deleteSnippet(id: string): MobileStoreState {
    this.state.snippets = this.state.snippets.filter((snippet) => snippet.id !== id)
    this.save()
    return this.getState()
  }

  deleteKey(id: string): MobileStoreState {
    this.state.sshKeys = this.state.sshKeys.filter((key) => key.id !== id)
    this.state.sessions = this.state.sessions.map((session) =>
      session.privateKeyId === id
        ? {
            ...session,
            authType: 'password',
            privateKeyId: undefined,
            privateKey: undefined,
            passphrase: undefined,
            updatedAt: new Date()
          }
        : session
    )
    this.save()
    return this.getState()
  }

  upsertSessionGroup(group: SessionGroup): MobileStoreState {
    const normalized = normalizeSessionGroup(group)
    this.state.sessionGroups = mergeById(this.state.sessionGroups, [normalized])
    this.save()
    return this.getState()
  }

  deleteSessionGroup(id: string): MobileStoreState {
    this.state.sessionGroups = this.state.sessionGroups.filter((group) => group.id !== id)
    this.state.sessions = this.state.sessions.map((session) =>
      session.group === id
        ? {
            ...session,
            group: undefined,
            updatedAt: new Date()
          }
        : session
    )
    this.save()
    return this.getState()
  }

  updateSyncConfig(updates: Partial<MobileSyncConfig>): MobileStoreState {
    this.state.syncConfig = normalizeSyncConfig({
      ...(this.state.syncConfig || {
        enabled: true,
        provider: 'github' as const,
        remoteUrl: '',
        token: '',
        password: ''
      }),
      ...updates
    })
    this.save()
    return this.getState()
  }

  clearSyncConfig(): MobileStoreState {
    this.state.syncConfig = undefined
    this.save()
    return this.getState()
  }

  /**
   * 导出移动端参与云同步合并的数据（只包含移动端管理的类别）
   */
  exportSyncData(): MobileSyncData {
    const backup = this.exportBackup()
    return cloneForJson({
      sessions: backup.sessions || [],
      sessionGroups: backup.sessionGroups || [],
      snippets: backup.snippets || [],
      quickCommands: backup.quickCommands || [],
      sshKeys: backup.sshKeys || []
    })
  }

  /**
   * 应用云同步合并结果：写入新增/更新的记录，删除对方已删除的记录
   */
  applySyncChanges(changes: Record<string, CategoryChanges>): MobileStoreState {
    const collection = (category: string) => {
      const change = changes[category]
      return change && 'upserts' in change ? change : undefined
    }

    const sessions = collection('sessions')
    if (sessions) {
      this.state.sessions = replaceById(
        this.state.sessions.filter((session) => !sessions.deletes.includes(session.id)),
        sessions.upserts
          .filter((session) => hasId(session) && isSshSession(session as SessionConfig))
          .map((session) => normalizeSession(session as SessionConfig))
      )
    }

    const groups = collection('sessionGroups')
    if (groups) {
      this.state.sessionGroups = replaceById(
        this.state.sessionGroups.filter((group) => !groups.deletes.includes(group.id)),
        groups.upserts.filter(hasId).map((group) => normalizeSessionGroup(group as SessionGroup))
      )
    }

    const snippets = collection('snippets')
    const quickCommands = collection('quickCommands')
    if (snippets || quickCommands) {
      const deleted = new Set([
        ...(snippets?.deletes || []),
        ...(quickCommands?.deletes || []).map((id) => `${QUICK_SNIPPET_PREFIX}${id}`)
      ])
      this.state.snippets = replaceById(
        this.state.snippets.filter((snippet) => !deleted.has(snippet.id)),
        [
          ...(snippets?.upserts || [])
            .filter(hasId)
            .map((snippet) => normalizeSnippet(snippet as MobileSnippet)),
          ...(quickCommands?.upserts || [])
            .filter(hasId)
            .map((command) => quickCommandToSnippet(command as MobileQuickCommand))
        ]
      )
    }

    const keys = collection('sshKeys')
    if (keys) {
      this.state.sshKeys = mergeKeysById(
        this.state.sshKeys.filter((key) => !keys.deletes.includes(key.id)),
        keys.upserts.filter(hasId).map((key) => normalizeKey(key as MobileSSHKey))
      )
    }

    this.save()
    return this.getState()
  }

  exportBackup(): MobileBackupData {
    const snippets = this.state.snippets
      .filter((snippet) => !snippet.id.startsWith(QUICK_SNIPPET_PREFIX))
      .map(cloneForJson)
    const quickCommands = this.state.snippets
      .filter((snippet) => snippet.id.startsWith(QUICK_SNIPPET_PREFIX))
      .map(snippetToQuickCommand)
      .map(cloneForJson)

    return {
      version: MOBILE_BACKUP_VERSION,
      timestamp: new Date().toISOString(),
      sessions: this.state.sessions.map(cloneForJson),
      sessionGroups: this.buildSessionGroupsForExport(),
      snippets,
      quickCommands,
      sshKeys: this.state.sshKeys.map(cloneForJson),
      commandHistory: [],
      portForwards: [],
      portForwardTemplates: [],
      sessionTemplates: [],
      scheduledTasks: [],
      workflows: [],
      settings: {}
    }
  }

  clear(): MobileStoreState {
    this.state = emptyState()
    localStorage.removeItem(STORAGE_KEY)
    this.emit()
    return this.getState()
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    this.emit()
  }

  private emit(): void {
    const state = this.getState()
    this.listeners.forEach((listener) => listener(state))
  }

  private buildSessionGroupsForExport(): SessionGroup[] {
    return this.state.sessionGroups.map((group) => ({
      ...cloneForJson(group),
      sessions:
        asArray<string>(group.sessions).length > 0
          ? asArray<string>(group.sessions)
          : this.state.sessions
              .filter((session) => session.group === group.id)
              .map((session) => session.id)
    }))
  }
}

const replaceById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
  const map = new Map<string, T>()
  existing.forEach((item) => map.set(item.id, item))
  incoming.forEach((item) => map.set(item.id, item))
  return Array.from(map.values())
}

const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
  const map = new Map<string, T>()
  existing.forEach((item) => map.set(item.id, item))
  incoming.forEach((item) => map.set(item.id, { ...(map.get(item.id) || item), ...item }))
  return Array.from(map.values())
}

const normalizeSessionGroup = (group: SessionGroup): SessionGroup => ({
  ...group,
  id: group.id,
  name: group.name || '未命名分组',
  sessions: asArray<string>(group.sessions)
})

const mergeKeysById = (existing: MobileSSHKey[], incoming: MobileSSHKey[]): MobileSSHKey[] => {
  const map = new Map<string, MobileSSHKey>()
  existing.forEach((item) => map.set(item.id, item))
  incoming.forEach((item) => {
    const current = map.get(item.id)
    const merged = { ...(current || item), ...item }
    if (!item.privateKeyContent && current?.privateKeyContent) {
      merged.privateKeyContent = current.privateKeyContent
    }
    if (!item.publicKeyContent && current?.publicKeyContent) {
      merged.publicKeyContent = current.publicKeyContent
    }
    map.set(item.id, merged)
  })
  return Array.from(map.values())
}

/** 移动端参与云同步合并的类别 */
export const MOBILE_SYNC_CATEGORIES = [
  'sessions',
  'sessionGroups',
  'snippets',
  'quickCommands',
  'sshKeys'
] as const

export type MobileSyncData = Record<(typeof MOBILE_SYNC_CATEGORIES)[number], any[]>

const SYNC_DATE_FIELDS = ['createdAt', 'updatedAt']

/**
 * 把一条同步记录整理成移动端存储时的形状，用于三方合并比较。
 * 与本地存储的规范化一致，但不凭空生成时间字段。
 */
export const normalizeSyncRecord = (
  category: (typeof MOBILE_SYNC_CATEGORIES)[number],
  record: any
): any => {
  let normalized: any
  switch (category) {
    case 'sessions':
      normalized = normalizeSession(record)
      break
    case 'sessionGroups':
      normalized = normalizeSessionGroup(record)
      break
    case 'snippets':
      normalized = normalizeSnippet(record)
      break
    case 'quickCommands':
      normalized = snippetToQuickCommand(quickCommandToSnippet(record))
      break
    case 'sshKeys':
      normalized = normalizeKey(record)
      break
  }
  for (const field of SYNC_DATE_FIELDS) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      delete normalized[field]
    } else if (field in normalized) {
      normalized[field] = normalizeDateString(record[field])
    }
  }
  return cloneForJson(normalized)
}

/**
 * 从完整同步数据中取出移动端管理的类别并规范化；非 SSH 会话不参与合并。
 */
export const pickMobileSyncData = (data: Record<string, any> | undefined): MobileSyncData => {
  const result = {} as MobileSyncData
  for (const category of MOBILE_SYNC_CATEGORIES) {
    let records = asArray<any>(data?.[category]).filter(
      (record) => record && typeof record === 'object' && hasId(record)
    )
    if (category === 'sessions') {
      records = records.filter(isSshSession)
    }
    result[category] = records.map((record) => normalizeSyncRecord(category, record))
  }
  return result
}

export const mobileStore = new MobileStore()
