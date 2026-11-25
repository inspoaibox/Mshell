// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  executeCommandDetailed: vi.fn(),
  executeCommand: vi.fn(),
  getConnection: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: Function) => mocks.handlers.set(name, fn) },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../managers/SFTPManager', () => {
  class TransferPausedError extends Error {}
  class TransferCancelledError extends Error {}
  return {
    sftpManager: { on: vi.fn(), hasSFTP: vi.fn(), closeSFTP: vi.fn(), initSFTP: vi.fn() },
    isReportedTransferError: () => false,
    TransferPausedError,
    TransferCancelledError
  }
})

vi.mock('../../managers/SSHConnectionManager', () => ({
  HostKeyChallengeError: class extends Error {},
  sshConnectionManager: {
    on: vi.fn(),
    getConnection: mocks.getConnection,
    executeCommand: mocks.executeCommand,
    executeCommandDetailed: mocks.executeCommandDetailed
  }
}))

vi.mock('../../managers/AuditLogManager', () => ({
  auditLogManager: { log: vi.fn() },
  AuditAction: {}
}))

vi.mock('../../utils/error-handler', () => ({ AppError: class extends Error {} }))
vi.mock('../../utils/ssh-connect-options', () => ({ prepareSSHConnectionOptions: vi.fn() }))

import {
  buildCompressCommand,
  buildExtractCommand,
  registerSFTPHandlers,
  sanitizeDragFileName
} from '../sftp-handlers'

describe('remote archive commands', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.executeCommandDetailed.mockReset()
    mocks.executeCommand.mockReset().mockResolvedValue('')
    mocks.getConnection.mockReset().mockReturnValue({ client: {}, status: 'connected' })
    registerSFTPHandlers()
  })

  it('quotes dirname/basename computed locally instead of using $(dirname ...)', () => {
    const command = buildCompressCommand(['/home/u/my dir/a b*.txt'], '/home/u/my dir/out.tar.gz')
    expect(command).not.toContain('$(')
    expect(command).toContain("tar -czf '/home/u/my dir/out.tar.gz' -C '/home/u/my dir' 'a b*.txt'")
    expect(command).toMatch(/^if \[ -e '\/home\/u\/my dir\/out\.tar\.gz' \]/)
  })

  it('quotes zip operands and protects names starting with a dash', () => {
    const command = buildCompressCommand(['/srv/x/-rf', "/srv/x/it's"], '/srv/x/a.zip')
    expect(command).toContain("cd '/srv/x' && zip -rq '/srv/x/a.zip' './-rf' 'it'\\''s'")
  })

  it('reports an existing archive instead of overwriting it', async () => {
    mocks.executeCommandDetailed.mockResolvedValue({ stdout: '', stderr: '', exitCode: 17 })
    const result = await mocks.handlers.get('sftp:compress')!({}, 'c', '/data/a', '/data/a.tar.gz')
    expect(result).toEqual({ success: false, error: '压缩文件已存在：a.tar.gz' })
  })

  it('uses a long timeout for compress jobs', async () => {
    mocks.executeCommandDetailed.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 })
    await mocks.handlers.get('sftp:compressMultiple')!({}, 'c', ['/d/a', '/d/b'], '/d/x.tar')
    expect(mocks.executeCommandDetailed.mock.calls[0][2]).toBeGreaterThanOrEqual(60 * 60 * 1000)
  })

  it('strips single-file extensions case-insensitively and never writes onto the archive', () => {
    const plan = buildExtractCommand('/data/BACKUP.SQL.GZ', '/data', 'abcd')
    expect(plan.outputPath).toBe('/data/BACKUP.SQL')
    expect(plan.command).toContain("if [ -e '/data/BACKUP.SQL' ]")
    expect(plan.command).toContain("gunzip -c '/data/BACKUP.SQL.GZ' > '/data/.BACKUP.SQL.mshell-abcd.part'")
    expect(plan.command).toContain("mv -f -- '/data/.BACKUP.SQL.mshell-abcd.part' '/data/BACKUP.SQL'")
    expect(plan.command).not.toContain("> '/data/BACKUP.SQL.GZ'")
  })

  it('refuses an extract whose output name cannot be determined', async () => {
    const result = await mocks.handlers.get('sftp:extract')!({}, 'c', '/data/.gz', '/data')
    expect(result.success).toBe(false)
    expect(mocks.executeCommandDetailed).not.toHaveBeenCalled()
  })

  it('refuses an extract when the output file already exists', async () => {
    mocks.executeCommandDetailed.mockResolvedValue({ stdout: '', stderr: '', exitCode: 17 })
    const result = await mocks.handlers.get('sftp:extract')!({}, 'c', '/data/dump.SQL.Xz', '/data')
    expect(result).toEqual({ success: false, error: '解压目标文件已存在：/data/dump.SQL' })
    expect(mocks.executeCommandDetailed.mock.calls[0][1]).toContain("unxz -c '/data/dump.SQL.Xz'")
  })
})

describe('drag and download path validation', () => {
  it('sanitizes renderer supplied drag file names', () => {
    expect(sanitizeDragFileName('../../evil.txt')).toBe('.._.._evil.txt')
    expect(sanitizeDragFileName('a\\b/c.txt')).toBe('a_b_c.txt')
    expect(sanitizeDragFileName('..')).toBeNull()
    expect(sanitizeDragFileName('')).toBeNull()
  })

  it('rejects download targets with an invalid final segment', async () => {
    mocks.handlers.clear()
    registerSFTPHandlers()
    const handler = mocks.handlers.get('sftp:downloadFile')!
    const result = await handler({}, 'c', '/remote/a', process.platform === 'win32' ? 'C:\\tmp\\a:b' : '/tmp/..')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/本地文件名无效/)
  })
})
