import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileStore } from './mobile-store'
import {
  RemoteReadError,
  forceUploadMobile,
  loadMobileSyncBase,
  runMobileMergeSync,
  saveMobileSyncBase,
  type MobileSyncDeps
} from './mobile-sync'
import { createSyncPayload } from './sync-export'
import { parseBackupOrSyncPayload } from './sync-import'

const PASSWORD = 'sync-password'
const REMOTE_URL = 'https://gist.github.com/abcdef1234567890abcdef'

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `server-${id}`,
  host: `${id}.example.com`,
  port: 22,
  username: 'root',
  authType: 'password',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const desktopData = (sessions: any[]): Record<string, any> => ({
  version: '0.2.20',
  timestamp: '2026-01-01T00:00:00.000Z',
  sessions: [...sessions, session('rdp-1', { type: 'rdp' })],
  sessionGroups: [{ id: 'g1', name: '生产', sessions: ['s1'], color: '#f00', order: 1 }],
  quickCommands: [{ id: 'q1', name: '磁盘', command: 'df -h' }],
  portForwards: [{ id: 'pf-1', localPort: 8080 }],
  settings: { general: { theme: 'dark' } }
})

describe('mobile three-way merge sync', () => {
  let store: MobileStore
  let remote: string | undefined
  let upload: ReturnType<typeof vi.fn<[string], Promise<{ remoteUrl: string; created: boolean }>>>

  const writeRemote = async (data: Record<string, any>) => {
    remote = await createSyncPayload(data as any, PASSWORD, { syncFormat: 2 })
  }

  const readRemote = async (): Promise<Record<string, any>> =>
    (await parseBackupOrSyncPayload(remote!, PASSWORD)) as Record<string, any>

  const deps = (): MobileSyncDeps => ({
    store,
    password: PASSWORD,
    loadRemote: async () => remote,
    upload: upload as any,
    loadBase: () => loadMobileSyncBase('github', REMOTE_URL, PASSWORD),
    saveBase: (data) => saveMobileSyncBase('github', REMOTE_URL, PASSWORD, data)
  })

  const ids = (records: any[] | undefined) => (records || []).map((item) => item.id).sort()

  beforeEach(async () => {
    localStorage.clear()
    store = new MobileStore()
    remote = undefined
    upload = vi.fn(async (content: string) => {
      remote = content
      return { remoteUrl: REMOTE_URL, created: false }
    })
    await writeRemote(desktopData([session('s1'), session('s2'), session('s3')]))
    // 首次同步：没有基准，只合并不删除
    const first = await runMobileMergeSync(deps())
    expect(first.action).toBe('merged')
    upload.mockClear()
  })

  it('does not upload when nothing changed', async () => {
    const result = await runMobileMergeSync(deps())
    expect(result.action).toBe('no-change')
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps edits from both sides and preserves desktop-only data', async () => {
    const data = await readRemote()
    data.sessions = data.sessions.map((item: any) =>
      item.id === 's1' ? { ...item, port: 2201, updatedAt: '2026-02-01T00:00:00.000Z' } : item
    )
    data.sessions.push(session('desk-new'))
    await writeRemote(data)

    store.upsertSession({ ...(store.getState().sessions.find((item) => item.id === 's2') as any), port: 2202 })
    store.upsertSession(session('mobile-new') as any)

    const result = await runMobileMergeSync(deps())
    expect(result.action).toBe('merged')
    expect(result.conflicts).toEqual([])

    const local = store.getState().sessions
    expect(ids(local)).toEqual(['desk-new', 'mobile-new', 's1', 's2', 's3'])
    expect(local.find((item) => item.id === 's1')?.port).toBe(2201)
    expect(local.find((item) => item.id === 's2')?.port).toBe(2202)

    const uploaded = await readRemote()
    expect(ids(uploaded.sessions)).toEqual(['desk-new', 'mobile-new', 'rdp-1', 's1', 's2', 's3'])
    expect(uploaded.sessions.find((item: any) => item.id === 's2').port).toBe(2202)
    expect(uploaded.portForwards).toEqual([{ id: 'pf-1', localPort: 8080 }])
    expect(uploaded.settings).toEqual({ general: { theme: 'dark' } })
    expect(uploaded.sessionGroups[0]).toMatchObject({ id: 'g1', color: '#f00', order: 1 })
    expect(uploaded.quickCommands).toEqual([{ id: 'q1', name: '磁盘', command: 'df -h' }])
    expect(JSON.parse(remote!).syncFormat).toBe(2)
  })

  it('propagates deletions in both directions', async () => {
    const data = await readRemote()
    data.sessions = data.sessions.filter((item: any) => item.id !== 's2')
    data.quickCommands = []
    await writeRemote(data)
    store.deleteSession('s3')

    await runMobileMergeSync(deps())

    expect(ids(store.getState().sessions)).toEqual(['s1'])
    expect(store.getState().snippets).toEqual([])
    const uploaded = await readRemote()
    expect(ids(uploaded.sessions)).toEqual(['rdp-1', 's1'])
  })

  it('keeps the newer version when both sides edit the same record', async () => {
    const data = await readRemote()
    data.sessions = data.sessions.map((item: any) =>
      item.id === 's1' ? { ...item, port: 1000, updatedAt: '2000-01-01T00:00:00.000Z' } : item
    )
    await writeRemote(data)
    store.upsertSession({ ...(store.getState().sessions.find((item) => item.id === 's1') as any), port: 2000 })

    const result = await runMobileMergeSync(deps())

    expect(result.conflicts).toEqual([
      expect.objectContaining({ key: 's1', kept: 'local', reason: 'both-modified' })
    ])
    expect(store.getState().sessions.find((item) => item.id === 's1')?.port).toBe(2000)
    const uploaded = await readRemote()
    expect(uploaded.sessions.find((item: any) => item.id === 's1').port).toBe(2000)
  })

  it('force upload keeps desktop data and refuses unreadable remote data', async () => {
    store.deleteSession('s1')
    await forceUploadMobile(deps())
    const uploaded = await readRemote()
    expect(ids(uploaded.sessions)).toEqual(['rdp-1', 's2', 's3'])
    expect(uploaded.portForwards).toHaveLength(1)

    remote = await createSyncPayload(desktopData([]) as any, 'other-password', { syncFormat: 2 })
    await expect(forceUploadMobile(deps())).rejects.toBeInstanceOf(RemoteReadError)
  })
})
