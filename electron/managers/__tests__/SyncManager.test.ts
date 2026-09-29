import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'

const mocks = vi.hoisted(() => ({
  axiosGet: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => 'C:\\test-mshell',
    getVersion: () => '0.2.20'
  }
}))

vi.mock('axios', () => ({
  default: {
    get: mocks.axiosGet
  }
}))

vi.mock('../BackupManager', () => ({
  backupManager: {}
}))

vi.mock('../CredentialManager', () => ({
  credentialManager: {
    isEncrypted: vi.fn(() => false),
    decryptLegacyUnprefixed: vi.fn(() => undefined)
  }
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    logError: vi.fn()
  }
}))

import { SyncManager } from '../SyncManager'

const getGist = (
  manager: SyncManager,
  token = 'github-token',
  gistId = 'gist-id'
): Promise<{ content: string; updatedAt: string } | null> =>
  (manager as any).getGist(token, gistId)

describe('SyncManager GitHub Gist downloads', () => {
  beforeEach(() => {
    mocks.axiosGet.mockReset()
  })

  it('uses inline content when GitHub returns the complete Gist file', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        updated_at: '2026-09-28T00:00:00Z',
        files: {
          'mshell-sync.json': {
            truncated: false,
            content: '{"version":"1.0.0","data":"complete"}'
          }
        }
      }
    })

    const result = await getGist(new SyncManager())

    expect(result).toEqual({
      content: '{"version":"1.0.0","data":"complete"}',
      updatedAt: '2026-09-28T00:00:00Z'
    })
    expect(mocks.axiosGet).toHaveBeenCalledOnce()
  })

  it('downloads raw content when GitHub truncates a large Gist file', async () => {
    const rawUrl = 'https://gist.githubusercontent.com/user/gist/raw/hash/mshell-sync.json'
    mocks.axiosGet
      .mockResolvedValueOnce({
        data: {
          updated_at: '2026-09-28T00:00:00Z',
          files: {
            'mshell-sync.json': {
              truncated: true,
              raw_url: rawUrl,
              content: '{"version":"1.0.0","data":"truncated'
            }
          }
        }
      })
      .mockResolvedValueOnce({
        data: '{"version":"1.0.0","data":"complete"}'
      })

    const result = await getGist(new SyncManager())

    expect(result).toEqual({
      content: '{"version":"1.0.0","data":"complete"}',
      updatedAt: '2026-09-28T00:00:00Z'
    })
    expect(mocks.axiosGet).toHaveBeenNthCalledWith(2, rawUrl, {
      headers: {
        Accept: 'text/plain',
        'Accept-Encoding': 'identity',
        Range: 'bytes=0-1048575'
      },
      responseType: 'arraybuffer',
      timeout: 5 * 60 * 1000,
      maxContentLength: 32 * 1024 * 1024,
      maxBodyLength: 32 * 1024 * 1024
    })
  })

  it('assembles a large Raw Gist response from byte ranges', async () => {
    const rawUrl = 'https://gist.githubusercontent.com/user/gist/raw/hash/mshell-sync.json'
    const firstChunk = Buffer.alloc(1024 * 1024, 97)
    const lastChunk = Buffer.from('end')
    mocks.axiosGet
      .mockResolvedValueOnce({
        status: 206,
        headers: { 'content-range': 'bytes 0-1048575/1048579' },
        data: firstChunk
      })
      .mockResolvedValueOnce({
        status: 206,
        headers: { 'content-range': 'bytes 1048576-1048578/1048579' },
        data: lastChunk
      })

    const result = await (new SyncManager() as any).downloadRawGistContent(rawUrl)

    expect(result).toHaveLength(1048579)
    expect(result.endsWith('end')).toBe(true)
    expect(mocks.axiosGet).toHaveBeenCalledTimes(2)
    expect(mocks.axiosGet).toHaveBeenLastCalledWith(
      rawUrl,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=1048576-1048578' }),
        responseType: 'arraybuffer'
      })
    )
  })

  it('reports a clear error when truncated content has no raw URL', async () => {
    mocks.axiosGet.mockResolvedValueOnce({
      data: {
        updated_at: '2026-09-28T00:00:00Z',
        files: {
          'mshell-sync.json': {
            truncated: true,
            content: '{"version":"1.0.0","data":"truncated'
          }
        }
      }
    })

    await expect(getGist(new SyncManager())).rejects.toThrow(
      'GitHub Gist 同步文件内容被截断，且未提供完整文件地址'
    )
  })

  it('recognizes interrupted raw downloads', () => {
    const manager = new SyncManager() as any

    expect(manager.isInterruptedRemoteDownload(new Error('aborted'))).toBe(true)
    expect(manager.isInterruptedRemoteDownload({ code: 'ECONNRESET' })).toBe(true)
    expect(manager.isInterruptedRemoteDownload(new Error('invalid JSON'))).toBe(false)
  })
})
