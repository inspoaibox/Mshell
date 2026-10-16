// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  connect: vi.fn(),
  destroy: vi.fn(),
  processKeys: vi.fn(async config => config)
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: any) => mocks.handlers.set(name, handler), on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../../managers/SSHConnectionManager', () => ({
  sshConnectionManager: { on: vi.fn() }, HostKeyChallengeError: class extends Error {}
}))
vi.mock('../../managers/PortForwardManager', () => ({ portForwardManager: {} }))
vi.mock('../../managers/AuditLogManager', () => ({ auditLogManager: {}, AuditAction: {} }))
vi.mock('../../utils/logger', () => ({ logger: { logError: vi.fn() } }))
vi.mock('../../utils/known-hosts', () => ({ knownHostsManager: {} }))
vi.mock('../../utils/ssh-connect-options', () => ({
  processProxyJumpPrivateKeys: mocks.processKeys, prepareSSHConnectionOptions: vi.fn()
}))
vi.mock('../../utils/proxy-jump', () => ({ ProxyJumpHelper: {
  validateProxyConfig: () => ({ valid: true }),
  connectThroughProxy: mocks.connect,
  getProxyChainDescription: () => 'jump:22'
} }))
import { registerSSHHandlers } from '../ssh-handlers'

describe('jump connection test IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerSSHHandlers()
    mocks.connect.mockResolvedValue({ destroy: mocks.destroy })
  })
  const invoke = (...args: any[]) => mocks.handlers.get('ssh:testProxyJump')!({}, ...args)

  it('tests forwarding to the supplied target through the supplied network proxy', async () => {
    const jump = { enabled: true, host: 'jump', port: 22 }
    const proxy = { enabled: true, host: 'proxy', port: 1080, type: 'socks5' }
    const result = await invoke(jump, proxy, { host: 'target', port: 21800 })
    expect(result.success).toBe(true)
    expect(mocks.connect).toHaveBeenCalledWith(jump, 'target', 21800, proxy)
    expect(mocks.destroy).toHaveBeenCalledOnce()
    expect(result.message).toContain('target:21800')
    expect(result.message).toContain('目标账号认证请连接终端验证')
  })

  it('does not silently test the jump itself if the target is missing', async () => {
    expect((await invoke({ host: 'jump', port: 22 })).success).toBe(false)
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('returns forwarding failures to the renderer', async () => {
    mocks.connect.mockRejectedValueOnce(new Error('forward denied'))
    expect(await invoke({ host: 'jump', port: 22 }, undefined, { host: 'target', port: 21800 }))
      .toMatchObject({ success: false, error: 'forward denied' })
  })
})
