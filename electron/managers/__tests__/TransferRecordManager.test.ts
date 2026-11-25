// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() }
}))

import { TransferRecordManager } from '../TransferRecordManager'

const baseRecord = {
  type: 'upload' as const,
  localPath: '/tmp/a',
  remotePath: '/remote/a',
  totalSize: 100,
  transferred: 0,
  status: 'active' as const,
  connectionId: 'conn'
}

describe('TransferRecordManager persistence', () => {
  let tempDir: string
  let recordsPath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-records-test-'))
    recordsPath = path.join(tempDir, 'transfer-records.json')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('serializes concurrent saves and writes atomically through a tmp file', async () => {
    const manager = new TransferRecordManager(recordsPath)
    await manager.initialize()

    let inFlight = 0
    let maxInFlight = 0
    const originalWriteFile = fs.promises.writeFile
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args: any[]) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      try {
        return await (originalWriteFile as any)(...args)
      } finally {
        inFlight--
      }
    })
    const renameSpy = vi.spyOn(fs.promises, 'rename')

    await Promise.all(
      Array.from({ length: 30 }, (_, i) => manager.createRecord({ ...baseRecord, id: `r${i}` }))
    )
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => manager.updateRecord(`r${i}`, { transferred: i }))
    )
    await manager.flush()

    expect(maxInFlight).toBe(1)
    // 合并：60 次修改远少于 60 次写盘
    expect(writeSpy.mock.calls.length).toBeLessThan(10)
    expect(writeSpy.mock.calls.every(([target]) => String(target).endsWith('.tmp'))).toBe(true)
    expect(renameSpy).toHaveBeenCalledWith(`${recordsPath}.tmp`, recordsPath)

    const saved = JSON.parse(fs.readFileSync(recordsPath, 'utf-8'))
    expect(saved).toHaveLength(30)
    expect(saved.find((record: any) => record.id === 'r29').transferred).toBe(29)
  })

  it('backs up a corrupt file instead of silently dropping it', async () => {
    fs.writeFileSync(recordsPath, '{"broken": ')
    const manager = new TransferRecordManager(recordsPath)
    await manager.initialize()

    expect(manager.getAllRecords()).toEqual([])
    const backups = fs.readdirSync(tempDir).filter((name) => name.includes('.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(tempDir, backups[0]), 'utf-8')).toBe('{"broken": ')
  })

  it('waits for loading before writing so existing records are not overwritten', async () => {
    fs.writeFileSync(
      recordsPath,
      JSON.stringify([
        { ...baseRecord, id: 'old', status: 'paused', createdAt: 'x', updatedAt: 'x' }
      ])
    )
    const manager = new TransferRecordManager(recordsPath)
    // 未先调用 initialize：createRecord 必须先等待加载
    await manager.createRecord({ ...baseRecord, id: 'new' })
    await manager.flush()

    const saved = JSON.parse(fs.readFileSync(recordsPath, 'utf-8'))
    expect(saved.map((record: any) => record.id).sort()).toEqual(['new', 'old'])
  })

  it('cleans up cancelled records together with completed ones', async () => {
    const manager = new TransferRecordManager(recordsPath)
    await manager.initialize()
    for (let i = 0; i < 120; i++) {
      await manager.createRecord({
        ...baseRecord,
        id: `c${i}`,
        status: i % 2 === 0 ? 'completed' : 'cancelled'
      })
    }
    await manager.createRecord({ ...baseRecord, id: 'paused', status: 'paused' })

    await manager.cleanupCompletedRecords()

    const remaining = manager.getAllRecords()
    expect(remaining.filter((record) => record.status !== 'paused')).toHaveLength(100)
    expect(remaining.some((record) => record.id === 'paused')).toBe(true)
  })
})
