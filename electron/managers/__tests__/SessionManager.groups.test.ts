// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const storage = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => storage.directory } }))
vi.mock('../CredentialManager', () => ({ credentialManager: {
  encryptFields: (data: any) => ({ ...data }),
  decryptFields: (data: any) => ({ ...data })
} }))
vi.mock('../../utils/app-settings', () => ({ appSettingsManager: {
  getSettings: () => ({ security: { savePasswords: true } })
} }))
import { SessionManager } from '../SessionManager'
import { sortSessions } from '../../../src/utils/session-order'

describe('session group ordering and persistence', () => {
  let manager: SessionManager
  let path: string
  const ids = () => manager.getAllGroups().map(group => group.id)
  const reopen = async () => {
    manager = new SessionManager()
    await manager.initialize()
  }
  const seedSessions = async () => {
    for (const [id, group] of [['s1', 'a'], ['s2', 'a'], ['s3', 'a'], ['u1', undefined], ['u2', undefined]]) {
      await manager.createSession({ id, name: id!, group, host: '127.0.0.1', port: 22,
        username: 'root', authType: 'password', region: 'US' })
    }
  }
  const sessionIds = (group?: string) => sortSessions(manager.getAllSessions()
    .filter(session => session.group === group)).map(session => session.id)
  beforeEach(async () => {
    storage.directory = mkdtempSync(join(tmpdir(), 'mshell-group-test-'))
    path = join(storage.directory, 'sessions.json')
    writeFileSync(path, JSON.stringify({ sessions: [], groups: ['a', 'b', 'c', 'd'].map(id => ({
      id, name: id.toUpperCase(), sessions: []
    })) }))
    await reopen()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (resolve(dirname(storage.directory)) === resolve(tmpdir())) {
      rmSync(storage.directory, { recursive: true, force: true })
    }
  })
  it('preserves legacy ordering and appends newly created groups', async () => {
    expect(ids()).toEqual(['a', 'b', 'c', 'd'])
    await manager.createGroup('E', 'e')
    await reopen()
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  it('moves up/down, retaining the result across a restart', async () => {
    await manager.updateGroupOrder('c', 'up')
    expect(ids()).toEqual(['a', 'c', 'b', 'd'])
    await manager.updateGroupOrder('a', 'down')
    await reopen()
    expect(ids()).toEqual(['c', 'a', 'b', 'd'])
  })
  it('pins at the top, moves within tiers and unpins ahead of ordinary groups', async () => {
    await manager.updateGroupOrder('c', 'pin')
    await manager.updateGroupOrder('d', 'pin')
    expect(ids()).toEqual(['d', 'c', 'a', 'b'])
    await manager.updateGroupOrder('d', 'down')
    expect(ids()).toEqual(['c', 'd', 'a', 'b'])
    await manager.updateGroupOrder('c', 'unpin')
    await reopen()
    expect(ids()).toEqual(['d', 'c', 'a', 'b'])
    expect(manager.getAllGroups().map(group => group.isPinned)).toEqual([true, false, false, false])
  })
  it('does not cross pinned boundaries or move past the start/end', async () => {
    await manager.updateGroupOrder('c', 'pin')
    for (const [id, action] of [['c', 'up'], ['c', 'down'], ['a', 'up'], ['d', 'down']] as const) {
      await manager.updateGroupOrder(id, action)
      expect(ids()).toEqual(['c', 'a', 'b', 'd'])
    }
  })
  it('serializes rapid movements without losing either action', async () => {
    await Promise.all([
      manager.updateGroupOrder('d', 'up'),
      manager.updateGroupOrder('d', 'up'),
      manager.updateGroupOrder('b', 'pin'),
      manager.saveSessions()
    ])
    await reopen()
    expect(ids()).toEqual(['b', 'a', 'd', 'c'])
  })
  it('leaves the visible order and original file intact when replacement fails, then allows retry', async () => {
    const before = readFileSync(path, 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(manager.updateGroupOrder('d', 'pin')).rejects.toThrow('Failed to save')
    expect(ids()).toEqual(['a', 'b', 'c', 'd'])
    expect(manager.getAllGroups().some(group => group.isPinned)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe(before)
    await manager.updateGroupOrder('d', 'pin')
    await reopen()
    expect(ids()[0]).toBe('d')
  })
  it('rejects unknown groups/actions without changing saved data', async () => {
    const before = readFileSync(path, 'utf8')
    await expect(manager.updateGroupOrder('missing', 'pin')).rejects.toThrow('分组不存在')
    await expect(manager.updateGroupOrder('a', 'invalid' as any)).rejects.toThrow('无效')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
  it('retains ordering metadata through sync, rename and deletion', async () => {
    await manager.syncUpsertGroup({ id: 'd', name: 'D', isPinned: true, sortOrder: 8 })
    await manager.syncUpsertGroup({ id: 'c', name: 'C', isPinned: true, sortOrder: 2 })
    await manager.renameGroup('c', 'Renamed')
    await manager.deleteGroup('a')
    await reopen()
    expect(ids()).toEqual(['c', 'd', 'b'])
    expect(manager.getAllGroups()[0].name).toBe('Renamed')
  })
  it('keeps existing ordering when receiving legacy metadata and sanitizes invalid fields', async () => {
    await manager.updateGroupOrder('c', 'pin')
    await manager.syncUpsertGroup({ id: 'c', name: 'Legacy' })
    await manager.syncUpsertGroup({ id: 'e', name: 'E', isPinned: 'false', sortOrder: 'first' })
    await reopen()
    expect(ids()).toEqual(['c', 'a', 'b', 'd', 'e'])
    expect(manager.getAllGroups()[0].isPinned).toBe(true)
    expect(manager.getAllGroups()[4].isPinned).toBe(false)
  })
  it('preserves order, pinning and session membership on export/import with fresh IDs', async () => {
    await manager.updateGroupOrder('c', 'pin')
    await manager.updateGroupOrder('d', 'up')
    await manager.createSession({ name: 'Server', host: '127.0.0.1', port: 22, username: 'root',
      authType: 'password', group: 'c', region: 'US' })
    const exported = join(storage.directory, 'export.json')
    await manager.exportSessions(exported)
    const sessions = await manager.importSessions(exported)
    const groups = manager.getAllGroups().filter(group => !['a', 'b', 'c', 'd'].includes(group.id))
    expect(groups.map(group => group.name)).toEqual(['C', 'A', 'D', 'B'])
    expect(groups[0].isPinned).toBe(true)
    expect(sessions[0].group).toBe(groups[0].id)
    expect(groups[0].sessions).toEqual([sessions[0].id])
  })

  it('pins sessions at the top of their own group and restores them on restart', async () => {
    await seedSessions()
    await manager.updateSessionOrder('s2', { type: 'pin' })
    await manager.updateSessionOrder('s3', { type: 'pin' })
    await manager.updateSessionOrder('u2', { type: 'pin' })
    await reopen()
    expect(sessionIds('a')).toEqual(['s3', 's2', 's1'])
    expect(sessionIds()).toEqual(['u2', 'u1'])
    expect(manager.getSession('s3')?.group).toBe('a')
    await manager.updateSessionOrder('s3', { type: 'unpin' })
    expect(sessionIds('a')).toEqual(['s2', 's3', 's1'])
  })

  it('moves sessions by ID across hidden entries and supports the ungrouped list', async () => {
    await seedSessions()
    await manager.updateSessionOrder('s3', { type: 'move', targetId: 's1' })
    await manager.updateSessionOrder('u2', { type: 'move', targetId: 'u1' })
    await reopen()
    expect(sessionIds('a')).toEqual(['s3', 's1', 's2'])
    expect(sessionIds()).toEqual(['u2', 'u1'])
  })

  it('keeps the pinned boundary while allowing pinned sessions to be reordered', async () => {
    await seedSessions()
    await manager.updateSessionOrder('s2', { type: 'pin' })
    await manager.updateSessionOrder('s3', { type: 'pin' })
    await manager.updateSessionOrder('s2', { type: 'move', targetId: 's3' })
    expect(sessionIds('a')).toEqual(['s2', 's3', 's1'])
    await expect(manager.updateSessionOrder('s1', { type: 'move', targetId: 's2' })).rejects.toThrow('置顶')
    await expect(manager.updateSessionOrder('s1', { type: 'move', targetId: 'u1' })).rejects.toThrow('同一分组')
    expect(sessionIds('a')).toEqual(['s2', 's3', 's1'])
  })

  it('does not publish a failed pin and can retry after the save failure', async () => {
    await seedSessions()
    const before = readFileSync(path, 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(manager.updateSessionOrder('s3', { type: 'pin' })).rejects.toThrow('Failed to save')
    expect(sessionIds('a')).toEqual(['s1', 's2', 's3'])
    expect(manager.getSession('s3')?.isPinned).toBeUndefined()
    expect(readFileSync(path, 'utf8')).toBe(before)
    await manager.updateSessionOrder('s3', { type: 'pin' })
    expect(sessionIds('a')[0]).toBe('s3')
  })

  it('serializes session/group pins without losing either configuration', async () => {
    await seedSessions()
    await Promise.all([
      manager.updateSessionOrder('s2', { type: 'pin' }),
      manager.updateSessionOrder('s3', { type: 'pin' }),
      manager.updateGroupOrder('d', 'pin')
    ])
    await reopen()
    expect(sessionIds('a')).toEqual(['s3', 's2', 's1'])
    expect(ids()[0]).toBe('d')
  })

  it('preserves session pin metadata through sync and export/import', async () => {
    await seedSessions()
    const previous = manager.getSession('s3')!.updatedAt
    await manager.updateSessionOrder('s3', { type: 'pin' })
    expect(manager.getSession('s3')!.updatedAt.getTime()).toBeGreaterThanOrEqual(previous.getTime())
    const exported = join(storage.directory, 'session-pins.json')
    await manager.exportSessions(exported)
    const imported = await manager.importSessions(exported)
    const copied = imported.find(session => session.name === 's3')!
    expect(copied.isPinned).toBe(true)
    await manager.syncUpsertSession({ ...copied, id: 'synced' })
    await reopen()
    expect(manager.getSession('synced')?.isPinned).toBe(true)
    expect(manager.getSession('synced')?.sortOrder).toBe(copied.sortOrder)
  })

  it('rejects invalid session order requests without changing stored data', async () => {
    await seedSessions()
    const before = readFileSync(path, 'utf8')
    await expect(manager.updateSessionOrder('missing', { type: 'pin' })).rejects.toThrow('会话不存在')
    await expect(manager.updateSessionOrder('s1', null as any)).rejects.toThrow('无效')
    await expect(manager.updateSessionOrder('s1', { type: 'move' } as any)).rejects.toThrow('同一分组')
    expect(readFileSync(path, 'utf8')).toBe(before)
  })
})
