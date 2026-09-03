import { beforeEach, describe, expect, it, vi } from 'vitest'

const transferRecordMocks = vi.hoisted(() => ({
  initialize: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../TransferRecordManager', () => ({
  transferRecordManager: { initialize: transferRecordMocks.initialize }
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

import { SFTPManager } from '../SFTPManager'

describe('SFTPManager client binding', () => {
  beforeEach(() => {
    transferRecordMocks.initialize.mockClear()
  })

  it('reuses a channel only while it belongs to the same SSH client', async () => {
    const manager = new SFTPManager()
    const firstChannel = { end: vi.fn() }
    const secondChannel = { end: vi.fn() }
    const firstClient = { sftp: vi.fn((callback: Function) => callback(null, firstChannel)) }
    const secondClient = { sftp: vi.fn((callback: Function) => callback(null, secondChannel)) }

    await manager.initSFTP('session-1', firstClient as any)
    expect(manager.hasSFTP('session-1', firstClient as any)).toBe(true)
    expect(manager.hasSFTP('session-1', secondClient as any)).toBe(false)

    await manager.initSFTP('session-1', secondClient as any)

    expect(firstChannel.end).toHaveBeenCalledOnce()
    expect(secondClient.sftp).toHaveBeenCalledOnce()
    expect(manager.hasSFTP('session-1', secondClient as any)).toBe(true)
  })

  it('does not open a duplicate channel for the same SSH client', async () => {
    const manager = new SFTPManager()
    const channel = { end: vi.fn() }
    const client = { sftp: vi.fn((callback: Function) => callback(null, channel)) }

    await manager.initSFTP('session-1', client as any)
    await manager.initSFTP('session-1', client as any)

    expect(client.sftp).toHaveBeenCalledOnce()
    expect(channel.end).not.toHaveBeenCalled()
  })

  it('does not let a stale initialization replace a newer client channel', async () => {
    const manager = new SFTPManager()
    let resolveFirst: ((value: [null, { end: ReturnType<typeof vi.fn> }]) => void) | undefined
    const firstChannel = { end: vi.fn() }
    const secondChannel = { end: vi.fn() }
    const firstClient = {
      sftp: vi.fn((callback: Function) => {
        resolveFirst = (value) => callback(...value)
      })
    }
    const secondClient = {
      sftp: vi.fn((callback: Function) => callback(null, secondChannel))
    }

    const firstInit = manager.initSFTP('session-1', firstClient as any)
    const secondInit = manager.initSFTP('session-1', secondClient as any)
    await secondInit
    resolveFirst?.([null, firstChannel])
    await firstInit

    expect(firstChannel.end).toHaveBeenCalledOnce()
    expect(manager.hasSFTP('session-1', secondClient as any)).toBe(true)
    expect(manager.hasSFTP('session-1', firstClient as any)).toBe(false)
  })
})
