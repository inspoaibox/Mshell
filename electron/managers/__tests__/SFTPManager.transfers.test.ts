// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Readable, Writable } from 'node:stream'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const records = vi.hoisted(() => new Map<string, any>())

vi.mock('../TransferRecordManager', () => ({
  transferRecordManager: {
    initialize: vi.fn(async () => {}),
    getRecord: (id: string) => records.get(id),
    createRecord: vi.fn(async (record: any) => {
      const now = new Date().toISOString()
      const full = { ...record, createdAt: now, updatedAt: now }
      records.set(record.id, full)
      return full
    }),
    updateRecord: vi.fn(async (id: string, updates: any) => {
      const record = records.get(id)
      if (!record) throw new Error(`Transfer record not found: ${id}`)
      records.set(id, { ...record, ...updates, updatedAt: new Date().toISOString() })
    }),
    deleteRecord: vi.fn(async (id: string) => {
      records.delete(id)
    }),
    getIncompleteTransfers: () => [],
    getIncompleteTransfersByConnection: () => []
  }
}))

vi.mock('../../utils/error-handler', () => ({
  ErrorHandler: {
    createSFTPError: (message: string) => new Error(message),
    handle: (error: Error) => error
  }
}))

vi.mock('../../utils/app-settings', () => ({
  appSettingsManager: {
    getSettings: () => ({ sftp: { maxConcurrentTransfers: 3 } })
  }
}))

import { SFTPManager, TransferCancelledError, TransferPausedError } from '../SFTPManager'

const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

/** 远端读流：异步 emit 'open'；hang 为 true 时永不产生数据 */
class FakeRemoteReadStream extends Readable {
  private sent = false
  constructor(
    private readonly data: Buffer,
    private readonly hang = false
  ) {
    super()
    setImmediate(() => this.emit('open', Buffer.from('handle')))
  }
  _read() {
    if (this.hang || this.sent) {
      if (this.sent) this.push(null)
      return
    }
    this.sent = true
    this.push(this.data)
  }
}

/** 远端写流：failAfter 模拟 ssh2 吞掉写入错误（destroy 而不 emit 'error'） */
class FakeRemoteWriteStream extends Writable {
  bytesWritten = 0
  constructor(
    private readonly store: Map<string, Buffer>,
    private readonly target: string,
    flags: string,
    private readonly failAfter?: number
  ) {
    super()
    if (flags !== 'a') store.set(target, Buffer.alloc(0))
  }
  _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void) {
    if (this.failAfter !== undefined && this.bytesWritten + chunk.length > this.failAfter) {
      // ssh2: destroy() 后才 cb(er)，因此不会触发 'error'
      this.destroy()
      return
    }
    this.store.set(this.target, Buffer.concat([this.store.get(this.target) || Buffer.alloc(0), chunk]))
    this.bytesWritten += chunk.length
    callback()
  }
}

function createFakeSftp(options: {
  remoteFiles?: Map<string, Buffer>
  hangReads?: boolean
  failWriteAfter?: number
}) {
  const store = options.remoteFiles || new Map<string, Buffer>()
  const sftp = {
    store,
    end: vi.fn(),
    on: vi.fn(),
    stat: vi.fn((target: string, cb: Function) => {
      const data = store.get(target)
      if (!data) {
        cb(Object.assign(new Error('No such file'), { code: 2 }))
        return
      }
      cb(null, { size: data.length, mode: 0o100644, mtime: 1 })
    }),
    unlink: vi.fn((target: string, cb: Function) => {
      store.delete(target)
      cb(null)
    }),
    createReadStream: vi.fn(
      (target: string) => new FakeRemoteReadStream(store.get(target) || Buffer.alloc(0), options.hangReads)
    ),
    createWriteStream: vi.fn(
      (target: string, streamOptions: any) =>
        new FakeRemoteWriteStream(store, target, streamOptions?.flags, options.failWriteAfter)
    )
  }
  return sftp
}

async function createManager(sftp: any, connectionId = 'conn-a') {
  const manager = new SFTPManager()
  const client = { sftp: vi.fn((callback: Function) => callback(null, sftp)) }
  await manager.initSFTP(connectionId, client as any)
  const events: Array<[string, string, ...any[]]> = []
  for (const name of ['started', 'complete', 'error', 'paused', 'cancelled']) {
    manager.on(name, (taskId: string, ...args: any[]) => events.push([name, taskId, ...args]))
  }
  return { manager, events }
}

describe('SFTPManager transfers', () => {
  let tempDir: string

  beforeEach(() => {
    records.clear()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sftp-manager-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('completes an upload only after verifying the remote size', async () => {
    const localPath = path.join(tempDir, 'ok.bin')
    fs.writeFileSync(localPath, Buffer.alloc(4096, 1))
    const sftp = createFakeSftp({})
    const { manager, events } = await createManager(sftp)

    await manager.uploadFile('conn-a', localPath, '/remote/ok.bin', 'task-ok')

    expect(sftp.store.get('/remote/ok.bin')?.length).toBe(4096)
    expect(records.get('task-ok').status).toBe('completed')
    expect(events.map(([name]) => name)).toEqual(['started', 'complete'])
  })

  it('fails (not completes) when the remote write stream closes early without an error', async () => {
    const localPath = path.join(tempDir, 'big.bin')
    fs.writeFileSync(localPath, Buffer.alloc(1024 * 1024, 7))
    const sftp = createFakeSftp({ failWriteAfter: 300 * 1024 })
    const { manager, events } = await createManager(sftp)

    await expect(
      manager.uploadFile('conn-a', localPath, '/remote/big.bin', 'task-quota')
    ).rejects.toThrow(/传输不完整/)

    await flush()
    expect(records.get('task-quota').status).toBe('failed')
    expect(events.some(([name]) => name === 'complete')).toBe(false)
    expect(events.filter(([name]) => name === 'error')).toHaveLength(1)
  })

  it('stays failed when the source errors and the destination closes afterwards', async () => {
    const sftp = createFakeSftp({ remoteFiles: new Map([['/remote/a.txt', Buffer.from('abc')]]) })
    sftp.createReadStream.mockImplementation((): any => {
      const stream = new Readable({ read() {} })
      setImmediate(() => {
        stream.emit('open', Buffer.from('h'))
        setImmediate(() => stream.destroy(new Error('read failed')))
      })
      return stream
    })
    const { manager, events } = await createManager(sftp)
    const localPath = path.join(tempDir, 'a.txt')

    await expect(manager.downloadFile('conn-a', '/remote/a.txt', localPath, 'task-src')).rejects.toThrow(
      'read failed'
    )
    await flush(50)

    expect(records.get('task-src').status).toBe('failed')
    expect(events.some(([name]) => name === 'complete')).toBe(false)
    expect(events.find(([name]) => name === 'error')?.[2]).toBe('read failed')
  })

  it('rejects uploading a directory before touching the remote file', async () => {
    const sftp = createFakeSftp({ remoteFiles: new Map([['/remote/keep', Buffer.from('keep')]]) })
    const { manager } = await createManager(sftp)

    await expect(manager.uploadFile('conn-a', tempDir, '/remote/keep', 'task-dir')).rejects.toThrow(
      /不支持上传文件夹/
    )
    expect(sftp.createWriteStream).not.toHaveBeenCalled()
    expect(sftp.store.get('/remote/keep')?.toString()).toBe('keep')
  })

  it('applies maxConcurrentTransfers globally across single-file transfers', async () => {
    const remoteFiles = new Map<string, Buffer>()
    for (let i = 0; i < 5; i++) remoteFiles.set(`/remote/${i}`, Buffer.from('data'))
    const sftp = createFakeSftp({ remoteFiles, hangReads: true })
    const { manager, events } = await createManager(sftp)

    const transfers = Array.from({ length: 5 }, (_, i) =>
      manager
        .downloadFile('conn-a', `/remote/${i}`, path.join(tempDir, `f${i}`), `task-${i}`)
        .catch((error) => error)
    )
    await flush()

    expect(events.filter(([name]) => name === 'started')).toHaveLength(3)
    expect(manager.getQueuedTaskIds()).toEqual(['task-3', 'task-4'])

    await manager.cancelTask('task-0')
    await flush()
    expect(events.filter(([name]) => name === 'started')).toHaveLength(4)
    expect(manager.getQueuedTaskIds()).toEqual(['task-4'])

    for (const id of ['task-1', 'task-2', 'task-3', 'task-4']) {
      await manager.cancelTask(id)
    }
    const results = await Promise.all(transfers)
    expect(results.every((result) => result instanceof TransferCancelledError)).toBe(true)
  })

  it('cancels a queued task without starting it', async () => {
    const remoteFiles = new Map<string, Buffer>()
    for (let i = 0; i < 4; i++) remoteFiles.set(`/remote/${i}`, Buffer.from('data'))
    const sftp = createFakeSftp({ remoteFiles, hangReads: true })
    const { manager, events } = await createManager(sftp)

    const running = [0, 1, 2].map((i) =>
      manager
        .downloadFile('conn-a', `/remote/${i}`, path.join(tempDir, `f${i}`), `run-${i}`)
        .catch((error) => error)
    )
    const queued = manager
      .downloadFile('conn-a', '/remote/3', path.join(tempDir, 'f3'), 'queued')
      .catch((error) => error)
    await flush()

    await manager.cancelTask('queued')
    expect(await queued).toBeInstanceOf(TransferCancelledError)
    expect(events.some(([name, id]) => name === 'started' && id === 'queued')).toBe(false)
    expect(events.some(([name, id]) => name === 'cancelled' && id === 'queued')).toBe(true)

    for (const i of [0, 1, 2]) await manager.cancelTask(`run-${i}`)
    await Promise.all(running)
  })

  it('applies a cancel that arrives before the task is registered', async () => {
    const sftp = createFakeSftp({ remoteFiles: new Map([['/remote/x', Buffer.from('x')]]) })
    const { manager, events } = await createManager(sftp)

    await manager.cancelTask('early')
    await expect(
      manager.downloadFile('conn-a', '/remote/x', path.join(tempDir, 'x'), 'early')
    ).rejects.toBeInstanceOf(TransferCancelledError)
    expect(sftp.createReadStream).not.toHaveBeenCalled()
    expect(events).toEqual([['cancelled', 'early']])
  })

  it('pauses a queued task by writing a paused record that can be resumed later', async () => {
    const remoteFiles = new Map<string, Buffer>()
    for (let i = 0; i < 4; i++) remoteFiles.set(`/remote/${i}`, Buffer.from('data'))
    const sftp = createFakeSftp({ remoteFiles, hangReads: true })
    const { manager } = await createManager(sftp)

    const running = [0, 1, 2].map((i) =>
      manager
        .downloadFile('conn-a', `/remote/${i}`, path.join(tempDir, `f${i}`), `run-${i}`)
        .catch((error) => error)
    )
    const queued = manager
      .downloadFile('conn-a', '/remote/3', path.join(tempDir, 'f3'), 'queued-pause')
      .catch((error) => error)
    await flush()

    await manager.pauseTask('queued-pause')
    expect(await queued).toBeInstanceOf(TransferPausedError)
    expect(records.get('queued-pause')).toMatchObject({ status: 'paused', connectionId: 'conn-a' })

    for (const i of [0, 1, 2]) await manager.cancelTask(`run-${i}`)
    await Promise.all(running)
  })

  it('deletes the partial local file when an active download is cancelled', async () => {
    const sftp = createFakeSftp({
      remoteFiles: new Map([['/remote/big', Buffer.from('data')]]),
      hangReads: true
    })
    const { manager } = await createManager(sftp)
    const localPath = path.join(tempDir, 'partial')

    const transfer = manager
      .downloadFile('conn-a', '/remote/big', localPath, 'cancel-active')
      .catch((error) => error)
    await flush()
    expect(fs.existsSync(localPath)).toBe(true)

    await manager.cancelTask('cancel-active')
    expect(await transfer).toBeInstanceOf(TransferCancelledError)
    expect(fs.existsSync(localPath)).toBe(false)
    expect(records.get('cancel-active').status).toBe('cancelled')
  })

  it('refuses to cancel a finished task', async () => {
    const sftp = createFakeSftp({ remoteFiles: new Map([['/remote/a', Buffer.from('abc')]]) })
    const { manager } = await createManager(sftp)
    await manager.downloadFile('conn-a', '/remote/a', path.join(tempDir, 'a'), 'done')

    await expect(manager.cancelTask('done')).rejects.toThrow('任务已结束')
    expect(records.get('done').status).toBe('completed')
  })

  it('refuses to resume a task that belongs to another connection', async () => {
    const sftp = createFakeSftp({})
    const { manager } = await createManager(sftp, 'conn-b')
    records.set('foreign', {
      id: 'foreign',
      type: 'upload',
      localPath: '/tmp/x',
      remotePath: '/remote/x',
      totalSize: 10,
      transferred: 5,
      status: 'paused',
      connectionId: 'conn-a',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    await expect(manager.resumeTask('conn-b', 'foreign')).rejects.toThrow(
      '该任务属于其它连接，请先连接原服务器'
    )
    expect(sftp.createWriteStream).not.toHaveBeenCalled()
  })

  it('fails active transfers with 连接已断开 when the channel is closed', async () => {
    const sftp = createFakeSftp({
      remoteFiles: new Map([['/remote/big', Buffer.from('data')]]),
      hangReads: true
    })
    const { manager, events } = await createManager(sftp)

    const transfer = manager
      .downloadFile('conn-a', '/remote/big', path.join(tempDir, 'big'), 'lost')
      .catch((error) => error)
    await flush()
    manager.closeSFTP('conn-a')

    const error = await transfer
    expect(error.message).toBe('连接已断开')
    expect(records.get('lost').status).toBe('failed')
    expect(events.find(([name]) => name === 'error')?.[2]).toBe('连接已断开')
  })

  it('fails a stalled transfer through the watchdog', async () => {
    const sftp = createFakeSftp({
      remoteFiles: new Map([['/remote/big', Buffer.from('data')]]),
      hangReads: true
    })
    const { manager } = await createManager(sftp)
    manager.stallTimeoutMs = 100

    const error = await manager
      .downloadFile('conn-a', '/remote/big', path.join(tempDir, 'stall'), 'stall')
      .catch((reason) => reason)
    expect(error.message).toMatch(/传输超时/)
    expect(records.get('stall').status).toBe('failed')
  })

  it('reports symlink target types and special permission bits', async () => {
    const sftp: any = createFakeSftp({})
    sftp.readdir = vi.fn((_dir: string, cb: Function) =>
      cb(null, [
        { filename: 'link-dir', attrs: { mode: 0o120777, size: 1, mtime: 1, atime: 1 } },
        { filename: 'broken', attrs: { mode: 0o120777, size: 1, mtime: 1, atime: 1 } },
        { filename: 'sticky', attrs: { mode: 0o041777, size: 1, mtime: 1, atime: 1 } }
      ])
    )
    sftp.stat = vi.fn((target: string, cb: Function) => {
      if (target === '/base/link-dir') cb(null, { mode: 0o040755, size: 0 })
      else cb(new Error('No such file'))
    })
    const { manager } = await createManager(sftp)

    const files = await manager.listDirectory('conn-a', '/base')
    expect(files[0]).toMatchObject({ type: 'symlink', targetType: 'directory' })
    expect(files[1].type).toBe('symlink')
    expect(files[1].targetType).toBeUndefined()
    expect(files[2]).toMatchObject({ type: 'directory', permissions: 0o777, specialBits: 0o1000 })
  })
})
