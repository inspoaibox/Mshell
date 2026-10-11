import { describe, expect, it } from 'vitest'
import {
  DESKTOP_SYNC_SCHEMA,
  mergeCollection,
  mergeObject,
  mergeSnapshot,
  scopeLegacyMobileRemote,
  stableStringify,
  type CollectionSchema
} from '../merge'

const sessionSchema = DESKTOP_SYNC_SCHEMA.sessions as CollectionSchema

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `server-${id}`,
  host: `${id}.example.com`,
  port: 22,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

describe('sync three-way merge', () => {
  it('serializes objects with stable key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(
      stableStringify({ a: { d: 2 }, b: 1 })
    )
  })

  it('keeps independent changes from both devices', () => {
    const base = [session('a'), session('b'), session('c')]
    const local = [session('a', { port: 2201 }), session('b'), session('c'), session('local-new')]
    const remote = [session('a'), session('b', { port: 2202 }), session('remote-new')]

    const result = mergeCollection('sessions', sessionSchema, base, local, remote)

    expect(result.merged.map((item) => item.id)).toEqual(['a', 'b', 'local-new', 'remote-new'])
    expect(result.merged.find((item) => item.id === 'a')?.port).toBe(2201)
    expect(result.merged.find((item) => item.id === 'b')?.port).toBe(2202)
    expect(result.upserts.map((item) => item.id).sort()).toEqual(['b', 'remote-new'])
    expect(result.deletes).toEqual(['c'])
    expect(result.conflicts).toEqual([])
    expect(result.remoteChanged).toBe(true)
  })

  it('propagates a local deletion when the remote record is unchanged', () => {
    const base = [session('a'), session('b')]
    const result = mergeCollection('sessions', sessionSchema, base, [session('a')], base)
    expect(result.merged.map((item) => item.id)).toEqual(['a'])
    expect(result.deletes).toEqual([])
    expect(result.remoteChanged).toBe(true)
  })

  it('keeps the newer version when both devices edit the same record', () => {
    const base = [session('a')]
    const local = [session('a', { port: 1, updatedAt: '2026-02-01T00:00:00.000Z' })]
    const remote = [session('a', { port: 2, updatedAt: '2026-03-01T00:00:00.000Z' })]

    const remoteWins = mergeCollection('sessions', sessionSchema, base, local, remote)
    expect(remoteWins.merged[0].port).toBe(2)
    expect(remoteWins.conflicts).toEqual([
      expect.objectContaining({ key: 'a', kept: 'remote', reason: 'both-modified' })
    ])

    const localWins = mergeCollection('sessions', sessionSchema, base, remote, local)
    expect(localWins.merged[0].port).toBe(2)
    expect(localWins.conflicts[0].kept).toBe('local')
    expect(localWins.upserts).toEqual([])
  })

  it('keeps the edited record when the other device deleted it', () => {
    const base = [session('a')]
    const edited = [session('a', { port: 2022 })]

    const remoteDeleted = mergeCollection('sessions', sessionSchema, base, edited, [])
    expect(remoteDeleted.merged).toHaveLength(1)
    expect(remoteDeleted.deletes).toEqual([])
    expect(remoteDeleted.conflicts[0]).toEqual(
      expect.objectContaining({ kept: 'local', reason: 'modified-deleted' })
    )

    const localDeleted = mergeCollection('sessions', sessionSchema, base, [], edited)
    expect(localDeleted.upserts.map((item) => item.id)).toEqual(['a'])
    expect(localDeleted.conflicts[0].kept).toBe('remote')
  })

  it('ignores volatile fields and preserves local runtime values', () => {
    const base = [session('a', { usageCount: 1 })]
    const local = [session('a', { usageCount: 9, lastConnected: '2026-05-01T00:00:00.000Z' })]
    const remote = [session('a', { usageCount: 3, updatedAt: '2026-04-01T00:00:00.000Z' })]

    const unchanged = mergeCollection('sessions', sessionSchema, base, local, remote)
    expect(unchanged.upserts).toEqual([])
    expect(unchanged.remoteChanged).toBe(false)

    const remoteEdit = [session('a', { usageCount: 3, port: 2200 })]
    const result = mergeCollection('sessions', sessionSchema, base, local, remoteEdit)
    expect(result.upserts[0]).toEqual(
      expect.objectContaining({ port: 2200, usageCount: 9, lastConnected: '2026-05-01T00:00:00.000Z' })
    )
  })

  it('treats a missing category as not provided instead of deleted', () => {
    const base = [session('a')]
    const result = mergeCollection('sessions', sessionSchema, base, base, undefined)
    expect(result.merged).toHaveLength(1)
    expect(result.deletes).toEqual([])
    expect(result.remoteChanged).toBe(false)
  })

  it('merges object fields independently and excludes local-only settings', () => {
    const base = { general: { theme: 'dark', language: 'zh' }, agentMcp: { port: 1 } }
    const local = { general: { theme: 'light', language: 'zh' }, agentMcp: { port: 2 } }
    const remote = { general: { theme: 'dark', language: 'en' }, agentMcp: { port: 3 } }

    const result = mergeObject(
      'settings',
      { kind: 'object', label: '应用设置', exclude: ['agentMcp'] },
      base,
      local,
      remote
    )

    expect(result.merged).toEqual({ general: { theme: 'light', language: 'en' }, agentMcp: { port: 2 } })
    expect(result.conflicts).toEqual([])
  })

  it('merges complete snapshots and reports summaries', () => {
    const base = { sessions: [session('a')], settings: { general: { theme: 'dark' } } }
    const local = {
      sessions: [session('a'), session('b')],
      settings: { general: { theme: 'dark' } },
      aiChatHistory: [{ id: 1 }]
    }
    const remote = {
      sessions: [session('a', { port: 2222 })],
      settings: { general: { theme: 'light' } },
      aiChatHistory: [{ id: 1 }]
    }

    const result = mergeSnapshot(base, local, remote, DESKTOP_SYNC_SCHEMA)

    expect(result.merged.sessions.map((item: any) => item.id)).toEqual(['a', 'b'])
    expect(result.merged.settings.general.theme).toBe('light')
    expect(result.localChanges.sessions).toEqual(
      expect.objectContaining({ upserts: [expect.objectContaining({ id: 'a', port: 2222 })] })
    )
    expect(result.localChanges.settings).toEqual({
      kind: 'object',
      value: { general: { theme: 'light' } }
    })
    expect(result.remoteChanged).toBe(true)
    expect(result.summary).toEqual({ uploaded: 1, downloaded: 2, deleted: 0 })
  })

  it('requires confirmation before deleting most local records', () => {
    const records = Array.from({ length: 10 }, (_, index) => session(String(index)))
    const result = mergeSnapshot(
      { sessions: records },
      { sessions: records },
      { sessions: records.slice(0, 2) },
      DESKTOP_SYNC_SCHEMA
    )
    expect(result.massDeletes).toEqual([
      expect.objectContaining({ category: 'sessions', deleteCount: 8, localCount: 10 })
    ])

    const replaced = mergeSnapshot(
      { sessions: records },
      { sessions: records },
      { sessions: records.map((item) => ({ ...item, id: `new-${item.id}` })) },
      DESKTOP_SYNC_SCHEMA
    )
    expect(replaced.massDeletes).toEqual([])
  })

  it('matches lazy scripts by file name across devices', () => {
    const local = [{ id: 'local-id', fileName: 'a.sh', name: 'A', content: 'echo 1', createdAt: '1' }]
    const remote = [{ id: 'remote-id', fileName: 'a.sh', name: 'A', content: 'echo 1', createdAt: '2' }]
    const result = mergeSnapshot({}, { lazyScripts: local }, { lazyScripts: remote }, DESKTOP_SYNC_SCHEMA)
    expect(result.merged.lazyScripts).toEqual(local)
    expect(result.localChanges.lazyScripts).toBeUndefined()
    expect(result.remoteChanged).toBe(false)
  })

  it('limits a legacy mobile upload to the categories it manages', () => {
    const base = {
      sessions: [session('ssh'), session('rdp', { type: 'rdp' })],
      portForwards: [{ id: 'pf' }]
    }
    const scoped = scopeLegacyMobileRemote(
      { sessions: [session('ssh')], portForwards: [], settings: {} },
      base
    )
    expect(scoped.portForwards).toBeUndefined()
    expect(scoped.settings).toBeUndefined()
    expect(scoped.sessions.map((item: any) => item.id)).toEqual(['ssh', 'rdp'])

    const result = mergeSnapshot(base, base, scoped, DESKTOP_SYNC_SCHEMA)
    expect(result.localChanges).toEqual({})
    expect(result.remoteChanged).toBe(false)
  })
})
