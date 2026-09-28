import { beforeEach, describe, expect, it, vi } from 'vitest'

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
        Accept: 'text/plain'
      },
      responseType: 'text'
    })
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
})
