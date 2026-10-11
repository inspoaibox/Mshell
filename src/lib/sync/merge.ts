/**
 * 云同步三方合并（base / local / remote）。
 *
 * base 是本机上一次同步成功后的数据快照。每次同步时逐条比较：
 * 只有一边相对 base 发生变化时直接采用变化的一边；两边都变化时
 * 以 updatedAt 较新的一边为准（无时间时保留本地），并记录冲突。
 * 一边删除、另一边修改时保留修改后的版本，避免丢数据。
 *
 * 纯 TS 实现，桌面端主进程和移动端共用。
 */

export type SyncRecord = Record<string, any>

export interface CollectionSchema {
  kind: 'collection'
  label: string
  /** 记录主键，默认 id */
  key?: (record: SyncRecord) => string | undefined
  /** 比较内容时忽略的字段（运行时状态、计数器等） */
  volatile?: string[]
  /** 记录显示名，用于冲突提示 */
  name?: (record: SyncRecord) => string
  /** 是否参与大批量删除保护 */
  guard?: boolean
}

export interface ObjectSchema {
  kind: 'object'
  label: string
  /** 不参与同步的顶层字段：结果始终取本地值 */
  exclude?: string[]
}

export interface MapSchema {
  kind: 'map'
  label: string
}

export interface ValueSchema {
  kind: 'value'
  label: string
}

export type CategorySchema = CollectionSchema | ObjectSchema | MapSchema | ValueSchema

export type SyncSchema = Record<string, CategorySchema>

export interface SyncConflict {
  category: string
  label: string
  key: string
  name: string
  kept: 'local' | 'remote'
  reason: 'both-modified' | 'modified-deleted'
}

export interface CollectionChanges {
  kind: 'collection' | 'map'
  /** 需要写入本地的记录（新增或被云端更新） */
  upserts: SyncRecord[]
  /** 需要从本地删除的记录主键 */
  deletes: string[]
}

export interface ValueChanges {
  kind: 'object' | 'value'
  value: any
}

export type CategoryChanges = CollectionChanges | ValueChanges

export interface MassDeleteWarning {
  category: string
  label: string
  deleteCount: number
  localCount: number
}

export interface SnapshotMergeResult {
  merged: SyncRecord
  /** 需要应用到本地的变化（只包含有变化的类别） */
  localChanges: Record<string, CategoryChanges>
  /** 合并结果与云端内容不同，需要上传 */
  remoteChanged: boolean
  conflicts: SyncConflict[]
  massDeletes: MassDeleteWarning[]
  summary: {
    /** 本地新增/修改后需要上传到云端的记录数 */
    uploaded: number
    /** 从云端新增/更新到本地的记录数 */
    downloaded: number
    /** 本地删除的记录数 */
    deleted: number
  }
}

const MASS_DELETE_MIN_COUNT = 5
const MASS_DELETE_RATIO = 0.5

const isPlainObject = (value: unknown): value is Record<string, any> =>
  Object.prototype.toString.call(value) === '[object Object]'

/**
 * 键排序后的稳定序列化，忽略 undefined，Date 转为 ISO 字符串。
 */
export const stableStringify = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString()
    if (Array.isArray(input)) return input.map((item) => (item === undefined ? null : normalize(item)))
    if (isPlainObject(input)) {
      const result: Record<string, unknown> = {}
      for (const key of Object.keys(input).sort()) {
        const item = input[key]
        if (item === undefined || typeof item === 'function') continue
        result[key] = normalize(item)
      }
      return result
    }
    return input
  }
  return JSON.stringify(normalize(value)) ?? 'undefined'
}

const sameValue = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right)

const contentOf = (record: SyncRecord | undefined, volatile: string[]): string => {
  if (!record) return ''
  if (volatile.length === 0) return stableStringify(record)
  const stripped: SyncRecord = {}
  for (const key of Object.keys(record)) {
    if (!volatile.includes(key)) stripped[key] = record[key]
  }
  return stableStringify(stripped)
}

export const parseSyncTime = (value: unknown): number => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value) {
    const time = new Date(value).getTime()
    return Number.isNaN(time) ? NaN : time
  }
  return NaN
}

const defaultKey = (record: SyncRecord): string | undefined =>
  record && (typeof record.id === 'string' || typeof record.id === 'number')
    ? String(record.id)
    : undefined

const defaultName = (record: SyncRecord): string =>
  String(record?.name || record?.command || record?.title || record?.id || '')

const toArray = (value: unknown): SyncRecord[] | undefined =>
  Array.isArray(value) ? value.filter((item) => isPlainObject(item)) : undefined

const indexBy = (
  records: SyncRecord[],
  key: (record: SyncRecord) => string | undefined
): Map<string, SyncRecord> => {
  const map = new Map<string, SyncRecord>()
  for (const record of records) {
    const id = key(record)
    if (id !== undefined && id !== '' && !map.has(id)) map.set(id, record)
  }
  return map
}

export interface CollectionMergeResult {
  merged: SyncRecord[]
  upserts: SyncRecord[]
  deletes: string[]
  conflicts: SyncConflict[]
  remoteChanged: boolean
  uploaded: number
}

/**
 * 合并一组以主键区分的记录。
 * local / remote 为 undefined 表示该端未提供此类数据，按 base 处理。
 */
export function mergeCollection(
  category: string,
  schema: CollectionSchema,
  baseInput: unknown,
  localInput: unknown,
  remoteInput: unknown
): CollectionMergeResult {
  const keyOf = schema.key || defaultKey
  const nameOf = schema.name || defaultName
  const volatile = schema.volatile || []
  const preserveLocal = volatile.filter((field) => field !== 'updatedAt')

  const base = toArray(baseInput) || []
  const local = toArray(localInput) ?? base
  const remote = toArray(remoteInput) ?? base

  const baseMap = indexBy(base, keyOf)
  const localMap = indexBy(local, keyOf)
  const remoteMap = indexBy(remote, keyOf)

  const conflicts: SyncConflict[] = []
  const upserts: SyncRecord[] = []
  const deletes: string[] = []
  const mergedMap = new Map<string, SyncRecord>()
  let uploaded = 0

  const conflict = (
    key: string,
    record: SyncRecord,
    kept: SyncConflict['kept'],
    reason: SyncConflict['reason']
  ) => {
    conflicts.push({ category, label: schema.label, key, name: nameOf(record), kept, reason })
  }

  // 采用云端版本时保留本地的运行时字段（计数、本地路径、连接状态等）
  const takeRemote = (remoteRecord: SyncRecord, localRecord?: SyncRecord): SyncRecord => {
    if (!localRecord || preserveLocal.length === 0) return remoteRecord
    const result = { ...remoteRecord }
    for (const field of preserveLocal) {
      if (localRecord[field] !== undefined) result[field] = localRecord[field]
      else delete result[field]
    }
    return result
  }

  const keys = new Set<string>([...localMap.keys(), ...remoteMap.keys()])
  for (const key of keys) {
    const b = baseMap.get(key)
    const l = localMap.get(key)
    const r = remoteMap.get(key)
    const bc = contentOf(b, volatile)
    const lc = contentOf(l, volatile)
    const rc = contentOf(r, volatile)

    if (l && r) {
      if (lc === rc) {
        mergedMap.set(key, l)
        continue
      }
      const localChanged = !b || lc !== bc
      const remoteChanged = !b || rc !== bc
      let useRemote: boolean
      if (localChanged && !remoteChanged) {
        useRemote = false
      } else if (!localChanged && remoteChanged) {
        useRemote = true
      } else {
        const localTime = parseSyncTime(l.updatedAt)
        const remoteTime = parseSyncTime(r.updatedAt)
        useRemote = !Number.isNaN(remoteTime) && (Number.isNaN(localTime) || remoteTime > localTime)
        conflict(key, useRemote ? r : l, useRemote ? 'remote' : 'local', 'both-modified')
      }
      if (useRemote) {
        const record = takeRemote(r, l)
        mergedMap.set(key, record)
        upserts.push(record)
      } else {
        mergedMap.set(key, l)
        uploaded++
      }
      continue
    }

    if (l) {
      if (b && lc === bc) {
        // 云端已删除，本地未改动 → 删除本地
        deletes.push(key)
        continue
      }
      if (b) conflict(key, l, 'local', 'modified-deleted')
      mergedMap.set(key, l)
      uploaded++
      continue
    }

    if (r) {
      if (b && rc === bc) {
        // 本地已删除，云端未改动 → 云端也删除
        continue
      }
      if (b) conflict(key, r, 'remote', 'modified-deleted')
      mergedMap.set(key, r)
      upserts.push(r)
    }
  }

  // 保持本地顺序，云端新增的追加在后面
  const merged: SyncRecord[] = []
  const emitted = new Set<string>()
  for (const source of [local, remote]) {
    for (const record of source) {
      const key = keyOf(record)
      if (key === undefined || emitted.has(key) || !mergedMap.has(key)) continue
      merged.push(mergedMap.get(key)!)
      emitted.add(key)
    }
  }

  const remoteChanged =
    merged.length !== remoteMap.size ||
    merged.some((record) => {
      const key = keyOf(record)!
      const r = remoteMap.get(key)
      return !r || contentOf(r, volatile) !== contentOf(record, volatile)
    })

  return { merged, upserts, deletes, conflicts, remoteChanged, uploaded }
}

const mergeValueTree = (
  base: unknown,
  local: unknown,
  remote: unknown,
  onConflict: () => void
): unknown => {
  if (sameValue(local, remote)) return local
  if (
    isPlainObject(local) &&
    isPlainObject(remote) &&
    (base === undefined || isPlainObject(base))
  ) {
    const b = (base || {}) as Record<string, unknown>
    const result: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(local), ...Object.keys(remote)])
    for (const key of keys) {
      const value = mergeValueTree(b[key], local[key], remote[key], onConflict)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  if (sameValue(local, base)) return remote
  if (sameValue(remote, base)) return local
  onConflict()
  return local
}

/**
 * 单对象按字段三方合并（数组视为整体值），同字段冲突保留本地。
 */
export function mergeObject(
  category: string,
  schema: ObjectSchema,
  base: unknown,
  local: unknown,
  remote: unknown
): { merged: unknown; conflicts: SyncConflict[] } {
  const effectiveLocal = local === undefined ? base : local
  const effectiveRemote = remote === undefined ? base : remote
  const exclude = schema.exclude || []
  const strip = (value: unknown) => {
    if (!isPlainObject(value) || exclude.length === 0) return value
    const copy = { ...value }
    for (const key of exclude) delete copy[key]
    return copy
  }

  const conflictPaths: string[] = []
  const merged = mergeValueTree(strip(base), strip(effectiveLocal), strip(effectiveRemote), () => {
    conflictPaths.push(category)
  })

  if (isPlainObject(merged) && isPlainObject(effectiveLocal)) {
    for (const key of exclude) {
      if (effectiveLocal[key] !== undefined) merged[key] = effectiveLocal[key]
    }
  }

  return {
    merged,
    conflicts: conflictPaths.length
      ? [
          {
            category,
            label: schema.label,
            key: category,
            name: schema.label,
            kept: 'local',
            reason: 'both-modified'
          }
        ]
      : []
  }
}

const mapToRecords = (value: unknown): SyncRecord[] | undefined =>
  isPlainObject(value)
    ? Object.entries(value).map(([key, item]) => ({ key, value: item }))
    : undefined

/**
 * 合并整份数据。schema 中没有列出的字段保持本地值。
 */
export function mergeSnapshot(
  base: SyncRecord | undefined,
  local: SyncRecord,
  remote: SyncRecord,
  schema: SyncSchema
): SnapshotMergeResult {
  const merged: SyncRecord = { ...local }
  const localChanges: Record<string, CategoryChanges> = {}
  const conflicts: SyncConflict[] = []
  const massDeletes: MassDeleteWarning[] = []
  const summary = { uploaded: 0, downloaded: 0, deleted: 0 }
  let remoteChanged = false
  const b = base || {}

  for (const [category, categorySchema] of Object.entries(schema)) {
    if (categorySchema.kind === 'collection' || categorySchema.kind === 'map') {
      const isMap = categorySchema.kind === 'map'
      const collectionSchema: CollectionSchema = isMap
        ? { kind: 'collection', label: categorySchema.label, key: (record) => record.key, name: (record) => record.key }
        : categorySchema
      const toInput = isMap ? mapToRecords : (value: unknown) => value
      const result = mergeCollection(
        category,
        collectionSchema,
        toInput(b[category]),
        toInput(local[category]),
        toInput(remote[category])
      )

      if (isMap) {
        const record: Record<string, unknown> = {}
        for (const entry of result.merged) record[entry.key] = entry.value
        merged[category] = record
      } else {
        merged[category] = result.merged
      }

      if (result.upserts.length || result.deletes.length) {
        localChanges[category] = {
          kind: isMap ? 'map' : 'collection',
          upserts: result.upserts,
          deletes: result.deletes
        }
      }
      if (result.remoteChanged) remoteChanged = true
      conflicts.push(...result.conflicts)
      summary.uploaded += result.uploaded
      summary.downloaded += result.upserts.length
      summary.deleted += result.deletes.length

      if (!isMap && (categorySchema as CollectionSchema).guard) {
        const localCount = (toArray(local[category]) || []).length
        const lost = localCount - result.merged.length
        if (
          result.deletes.length >= MASS_DELETE_MIN_COUNT &&
          lost >= MASS_DELETE_MIN_COUNT &&
          result.merged.length < localCount * MASS_DELETE_RATIO
        ) {
          massDeletes.push({
            category,
            label: categorySchema.label,
            deleteCount: result.deletes.length,
            localCount
          })
        }
      }
      continue
    }

    if (categorySchema.kind === 'object') {
      const result = mergeObject(category, categorySchema, b[category], local[category], remote[category])
      merged[category] = result.merged
      conflicts.push(...result.conflicts)
      if (result.merged !== undefined && !sameValue(result.merged, local[category])) {
        localChanges[category] = { kind: 'object', value: result.merged }
        summary.downloaded++
      }
      const remoteValue = remote[category] === undefined ? b[category] : remote[category]
      if (!sameValue(stripExcluded(result.merged, categorySchema), stripExcluded(remoteValue, categorySchema))) {
        remoteChanged = true
      }
      continue
    }

    // value：整体比较，冲突保留本地
    const baseValue = b[category]
    const localValue = local[category] === undefined ? baseValue : local[category]
    const remoteValue = remote[category] === undefined ? baseValue : remote[category]
    let value = localValue
    if (!sameValue(localValue, remoteValue)) {
      if (sameValue(localValue, baseValue)) {
        value = remoteValue
      } else if (!sameValue(remoteValue, baseValue)) {
        conflicts.push({
          category,
          label: categorySchema.label,
          key: category,
          name: categorySchema.label,
          kept: 'local',
          reason: 'both-modified'
        })
      }
    }
    merged[category] = value
    if (value !== undefined && !sameValue(value, local[category])) {
      localChanges[category] = { kind: 'value', value }
      summary.downloaded++
    }
    if (!sameValue(value, remoteValue)) remoteChanged = true
  }

  return { merged, localChanges, remoteChanged, conflicts, massDeletes, summary }
}

const stripExcluded = (value: unknown, schema: ObjectSchema): unknown => {
  if (!isPlainObject(value) || !schema.exclude?.length) return value
  const copy = { ...value }
  for (const key of schema.exclude) delete copy[key]
  return copy
}

const lazyScriptKey = (record: SyncRecord): string | undefined => {
  const fileName = String(record?.fileName || record?.name || '').trim()
  return fileName || defaultKey(record)
}

/**
 * 桌面端完整同步数据的合并规则。
 */
export const DESKTOP_SYNC_SCHEMA: SyncSchema = {
  sessionGroups: { kind: 'collection', label: '会话分组', volatile: ['sessions'], guard: true },
  sessions: {
    kind: 'collection',
    label: '会话',
    volatile: ['updatedAt', 'usageCount', 'lastConnected'],
    guard: true
  },
  snippets: {
    kind: 'collection',
    label: '命令片段',
    volatile: ['updatedAt', 'usageCount'],
    guard: true
  },
  quickCommands: {
    kind: 'collection',
    label: '快捷命令',
    volatile: ['updatedAt', 'usageCount'],
    guard: true
  },
  sshKeys: {
    kind: 'collection',
    label: 'SSH 密钥',
    volatile: ['updatedAt', 'privateKeyPath', 'usageCount', 'lastUsed'],
    guard: true
  },
  portForwards: {
    kind: 'collection',
    label: '端口转发',
    volatile: ['updatedAt', 'status', 'error', 'connectionId'],
    guard: true
  },
  portForwardTemplates: { kind: 'collection', label: '端口转发模板', volatile: ['updatedAt'], guard: true },
  sessionTemplates: { kind: 'collection', label: '会话模板', volatile: ['updatedAt'], guard: true },
  scheduledTasks: {
    kind: 'collection',
    label: '计划任务',
    volatile: [
      'updatedAt',
      'lastExecution',
      'nextExecution',
      'executionCount',
      'successCount',
      'failureCount'
    ],
    guard: true
  },
  workflows: {
    kind: 'collection',
    label: '工作流',
    volatile: ['updatedAt', 'lastExecution', 'executionCount', 'successCount', 'failureCount'],
    guard: true
  },
  lazyScripts: {
    kind: 'collection',
    label: '懒人脚本',
    key: lazyScriptKey,
    volatile: ['id', 'createdAt', 'updatedAt', 'usageCount'],
    guard: true
  },
  commandHistory: { kind: 'collection', label: '命令历史' },
  connectionStats: { kind: 'collection', label: '连接统计' },
  auditLogs: { kind: 'collection', label: '审计日志' },
  transferRecords: { kind: 'collection', label: '传输记录', volatile: ['updatedAt'] },
  settings: { kind: 'object', label: '应用设置', exclude: ['agentMcp'] },
  lockConfig: { kind: 'object', label: '锁屏配置' },
  aiConfig: { kind: 'object', label: 'AI 配置' },
  aiChatHistory: { kind: 'value', label: 'AI 聊天记录' },
  aiTerminalChatHistory: { kind: 'map', label: '终端 AI 聊天记录' }
}

/** 旧版移动端上传的数据中真实包含的类别 */
export const LEGACY_MOBILE_CATEGORIES = [
  'sessions',
  'sessionGroups',
  'snippets',
  'quickCommands',
  'sshKeys'
]

/** 新版云同步文件格式（支持逐条合并） */
export const SYNC_FORMAT_VERSION = 2

export const MOBILE_APP_VERSION = 'mshell-mobile'

/**
 * 旧版移动端（未写 syncFormat）上传时会把桌面独有数据写成空数组/空对象。
 * 合并前把这些类别视为“未提供”，并把非 SSH 会话从 base 补回来，避免被当成删除。
 */
export function scopeLegacyMobileRemote(
  remote: SyncRecord,
  base: SyncRecord | undefined
): SyncRecord {
  const scoped: SyncRecord = {}
  for (const category of LEGACY_MOBILE_CATEGORIES) {
    if (remote[category] !== undefined) scoped[category] = remote[category]
  }
  if (Array.isArray(scoped.sessions)) {
    const baseNonSsh = (toArray(base?.sessions) || []).filter(isNonSshSession)
    scoped.sessions = [...scoped.sessions.filter((session: SyncRecord) => !isNonSshSession(session)), ...baseNonSsh]
  }
  return scoped
}

export const isLegacyMobileEnvelope = (envelope: SyncRecord | undefined): boolean =>
  !!envelope && envelope.appVersion === MOBILE_APP_VERSION && !envelope.syncFormat

export const isNonSshSession = (session: SyncRecord): boolean =>
  !!session && typeof session.type === 'string' && session.type !== '' && session.type !== 'ssh'

export const formatMergeSummary = (result: Pick<SnapshotMergeResult, 'summary' | 'conflicts'>): string => {
  const { uploaded, downloaded, deleted } = result.summary
  const parts = [`上传 ${uploaded} 项`, `下载 ${downloaded} 项`, `删除 ${deleted} 项`]
  if (result.conflicts.length) {
    parts.push(`冲突 ${result.conflicts.length} 项（已保留修改时间较新的版本）`)
  }
  return parts.join('，')
}
