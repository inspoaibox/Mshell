import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type DeviceData = Record<string, any>

const mocks = vi.hoisted(() => ({
  userData: '',
  devices: {} as Record<string, Record<string, any>>,
  current: 'A',
  remote: null as null | { content: string; updatedAt: string; revision: number },
  freshnessHook: null as null | { skip: number; run: () => Promise<void> },
  axiosGet: vi.fn(),
  axiosPatch: vi.fn(),
  axiosPost: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userData,
    getVersion: () => '0.2.21'
  }
}))

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet,
    patch: mocks.axiosPatch,
    post: mocks.axiosPost
  }
}))

vi.mock('../BackupManager', () => {
  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
  const device = () => mocks.devices[mocks.current]
  return {
    backupManager: {
      collectBackupData: vi.fn(async () => clone(device())),
      applyBackup: vi.fn(async (data: Record<string, any>) => {
        // 与真实 applyBackup 一样只新增/覆盖，不删除
        const local = device()
        for (const session of data.sessions || []) {
          local.sessions = local.sessions.filter((item: any) => item.id !== session.id)
          local.sessions.push(clone(session))
        }
        if (data.settings) local.settings = { ...local.settings, ...clone(data.settings) }
      }),
      applySyncChanges: vi.fn(async (changes: Record<string, any>) => {
        const local = device()
        for (const [category, change] of Object.entries(changes)) {
          if (change.kind === 'collection') {
            let records = (local[category] || []).filter(
              (item: any) => !change.deletes.includes(item.id)
            )
            for (const record of change.upserts) {
              const index = records.findIndex((item: any) => item.id === record.id)
              if (index >= 0) records[index] = clone(record)
              else records = [...records, clone(record)]
            }
            local[category] = records
          } else if (change.kind === 'object' || change.kind === 'value') {
            local[category] = clone(change.value)
          }
        }
      })
    }
  }
})

vi.mock('../CredentialManager', () => ({
  credentialManager: {
    encrypt: vi.fn((value: string) => value),
    isEncrypted: vi.fn(() => false),
    decryptLegacyUnprefixed: vi.fn(() => undefined)
  }
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    logError: vi.fn(),
    logInfo: vi.fn()
  }
}))

import { SyncManager } from '../SyncManager'

const GIST_URL = 'https://api.github.com/gists/gist-id'

const session = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: `server-${id}`,
  host: `${id}.example.com`,
  port: 22,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra
})

const deviceData = (sessions: any[]): DeviceData => ({
  version: '1.0.0',
  timestamp: '2026-01-01T00:00:00.000Z',
  sessions,
  settings: { general: { theme: 'dark' }, agentMcp: { port: 1, token: 'local-token' } }
})

const managers: Record<string, SyncManager> = {}
const userDataDirs: Record<string, string> = {}

const useDevice = (name: string, password = 'sync-password'): SyncManager => {
  mocks.current = name
  mocks.userData = userDataDirs[name]
  const manager = managers[name]
  ;(manager as any).config = {
    enabled: true,
    provider: 'github',
    autoSync: false,
    syncInterval: 30,
    encryptionPassword: password,
    github: { token: 'token', gistId: mocks.remote ? 'gist-id' : undefined }
  }
  return manager
}

const runOn = async (name: string, options?: { allowMassDelete?: boolean }, password?: string) =>
  useDevice(name, password).sync(options)

const remoteData = async (): Promise<any> => {
  const envelope = JSON.parse(mocks.remote!.content)
  return {
    envelope,
    data: JSON.parse(await (managers.A as any).decryptData(envelope.data, 'sync-password'))
  }
}

const sessionsOf = (name: string) =>
  [...mocks.devices[name].sessions].sort((a: any, b: any) => a.id.localeCompare(b.id))

const writeRemote = (content: string) => {
  const revision = (mocks.remote?.revision ?? 0) + 1
  mocks.remote = {
    content,
    revision,
    updatedAt: `2026-10-11T00:00:${String(revision).padStart(2, '0')}Z`
  }
}

describe('SyncManager three-way merge sync', () => {
  beforeEach(() => {
    mocks.remote = null
    mocks.freshnessHook = null
    mocks.devices = {}
    for (const name of ['A', 'B']) {
      userDataDirs[name] = mkdtempSync(join(tmpdir(), `mshell-sync-${name}-`))
      mocks.userData = userDataDirs[name]
      managers[name] = new SyncManager()
    }

    mocks.axiosGet.mockReset().mockImplementation(async (url: string) => {
      if (url !== GIST_URL || !mocks.remote) {
        throw Object.assign(new Error('not found'), { response: { status: 404 } })
      }
      // 模拟在某次读取之前，其它设备写入了云端
      const hook = mocks.freshnessHook
      if (hook) {
        if (hook.skip > 0) {
          hook.skip--
        } else {
          mocks.freshnessHook = null
          await hook.run()
        }
      }
      return {
        data: {
          updated_at: mocks.remote.updatedAt,
          files: { 'mshell-sync.json': { truncated: false, content: mocks.remote.content } }
        }
      }
    })
    mocks.axiosPatch.mockReset().mockImplementation(async (_url: string, body: any) => {
      writeRemote(body.files['mshell-sync.json'].content)
      return { data: {} }
    })
    mocks.axiosPost.mockReset().mockImplementation(async (_url: string, body: any) => {
      writeRemote(body.files['mshell-sync.json'].content)
      return { data: { id: 'gist-id', html_url: 'https://gist.github.com/gist-id' } }
    })
  })

  const connectBothDevices = async (sessions: any[]) => {
    mocks.devices.A = deviceData(sessions)
    mocks.devices.B = deviceData([])
    expect((await runOn('A')).action).toBe('uploaded')
    const first = await runOn('B')
    expect(first.action).toBe('merged')
    expect(sessionsOf('B')).toEqual(sessionsOf('A'))
    // A 在 B 首次合并后再同步一次，建立基准
    await runOn('A')
  }

  it('keeps independent edits from two devices', async () => {
    await connectBothDevices([session('s1'), session('s2')])

    mocks.devices.A.sessions = [
      session('s1', { port: 2201, updatedAt: '2026-02-01T00:00:00.000Z' }),
      session('s2'),
      session('a-new')
    ]
    mocks.devices.B.sessions = [
      session('s1'),
      session('s2', { port: 2202, updatedAt: '2026-02-02T00:00:00.000Z' }),
      session('b-new')
    ]

    expect((await runOn('A')).action).toBe('merged')
    const resultB = await runOn('B')
    expect(resultB).toEqual(
      expect.objectContaining({ success: true, action: 'merged', conflicts: [] })
    )
    expect((await runOn('A')).action).toBe('merged')
    expect((await runOn('B')).action).toBe('no-change')

    expect(sessionsOf('A')).toEqual(sessionsOf('B'))
    expect(sessionsOf('A').map((item: any) => [item.id, item.port])).toEqual([
      ['a-new', 22],
      ['b-new', 22],
      ['s1', 2201],
      ['s2', 2202]
    ])
  })

  it('propagates deletions and does not upload local MCP settings', async () => {
    await connectBothDevices([session('s1'), session('s2')])

    mocks.devices.A.sessions = [session('s2')]
    await runOn('A')
    await runOn('B')

    expect(sessionsOf('B').map((item: any) => item.id)).toEqual(['s2'])
    const { envelope, data } = await remoteData()
    expect(envelope.syncFormat).toBe(2)
    expect(data.settings.agentMcp).toBeUndefined()
    expect(mocks.devices.B.settings.agentMcp).toEqual({ port: 1, token: 'local-token' })
  })

  it('keeps the newer version when both devices edit the same session', async () => {
    await connectBothDevices([session('s1')])

    mocks.devices.A.sessions = [session('s1', { port: 1000, updatedAt: '2026-03-01T00:00:00.000Z' })]
    mocks.devices.B.sessions = [session('s1', { port: 2000, updatedAt: '2026-04-01T00:00:00.000Z' })]

    await runOn('B')
    const result = await runOn('A')

    expect(result.conflicts).toEqual([
      expect.objectContaining({ key: 's1', kept: 'remote', reason: 'both-modified' })
    ])
    expect(sessionsOf('A')[0].port).toBe(2000)
  })

  it('re-merges when another device uploads during a sync', async () => {
    await connectBothDevices([session('s1')])

    mocks.devices.A.sessions = [session('s1'), session('a-new')]
    mocks.devices.B.sessions = [session('s1'), session('b-new')]

    // A 读取云端之后、上传之前，B 抢先上传了自己的修改
    mocks.freshnessHook = {
      skip: 1,
      run: async () => {
        const { envelope, data } = await remoteData()
        data.sessions.push(session('b-new'))
        envelope.data = await (managers.A as any).encryptData(JSON.stringify(data), 'sync-password')
        writeRemote(JSON.stringify(envelope))
      }
    }

    const result = await runOn('A')
    expect(result).toEqual(expect.objectContaining({ success: true, action: 'merged' }))
    expect(sessionsOf('A').map((item: any) => item.id)).toEqual(['a-new', 'b-new', 's1'])
    const { data } = await remoteData()
    expect(data.sessions.map((item: any) => item.id).sort()).toEqual(['a-new', 'b-new', 's1'])
  })

  it('treats an unreadable base as a first sync without deleting local data', async () => {
    await connectBothDevices([session('s1')])

    mocks.devices.B.sessions = [session('s1'), session('b-only')]
    mocks.devices.A.sessions = []
    // A 换了同步密码（重新上传），B 上旧的基准无法解密
    expect((await useDevice('A', 'new-password').uploadToGitHub()).success).toBe(true)

    const result = await runOn('B', undefined, 'new-password')
    expect(result.action).toBe('merged')
    expect(sessionsOf('B').map((item: any) => item.id)).toEqual(['b-only', 's1'])
  })

  it('asks for confirmation before deleting most local records', async () => {
    const sessions = Array.from({ length: 10 }, (_, index) => session(`s${index}`))
    await connectBothDevices(sessions)

    mocks.devices.A.sessions = sessions.slice(0, 2)
    await runOn('A')

    const pending = await runOn('B')
    expect(pending.action).toBe('needs-confirm')
    expect(pending.massDeletes).toEqual([
      expect.objectContaining({ category: 'sessions', deleteCount: 8, localCount: 10 })
    ])
    expect(mocks.devices.B.sessions).toHaveLength(10)

    const confirmed = await runOn('B', { allowMassDelete: true })
    expect(confirmed.action).toBe('merged')
    expect(mocks.devices.B.sessions).toHaveLength(2)
  })
})
