// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.mock('../SSHConnectionManager', () => ({ sshConnectionManager: {} }))
import { FirewallManager } from '../FirewallManager'
import {
  firewallOutput,
  firewallOverview,
  zoneLines
} from '../../../src/utils/__tests__/firewall-fixtures'
import type { FirewallRuleDraft } from '../../../src/utils/firewall-model'
const context = (data = firewallOverview()) => ({
  sshClientIp: data.sshClientIp,
  sshServerPort: data.sshServerPort,
  sshZone: data.sshZone
})
const success = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 })
const draft: FirewallRuleDraft = {
  tool: 'iptables',
  ports: '443',
  protocol: 'tcp',
  sourceMode: 'current',
  customSources: '',
  sshClientIp: '203.0.113.8',
  persist: false
}
function setup() {
  const client = {},
    getConnection = vi.fn(() => ({ status: 'connected', client })),
    executeCommandDetailed = vi.fn()
  const manager = new FirewallManager({ getConnection, executeCommandDetailed } as any)
  return { manager, client, getConnection, execute: executeCommandDetailed }
}
afterEach(() => {
  vi.useRealTimers()
})
describe('server-enforced firewall operations', () => {
  it('re-detects before writing and rejects a changed SSH source', async () => {
    const s = setup()
    s.execute.mockResolvedValueOnce(success(firewallOutput()))
    await expect(
      s.manager.apply('a', { type: 'allow', draft }, { ...context(), sshClientIp: '192.0.2.1' })
    ).rejects.toThrow('已变化')
    expect(s.execute).toHaveBeenCalledTimes(1)
  })
  it('blocks deletion of SSH rules even if a renderer submits their key', async () => {
    const output = firewallOutput(
      ['RULE_RAW|ufw|Status: active', 'RULE_RAW|ufw|[ 2] 2222/tcp ALLOW IN 203.0.113.8'],
      'ufw'
    )
    const data = firewallOverview(['RULE_RAW|ufw|[ 2] 2222/tcp ALLOW IN 203.0.113.8'], 'ufw')
    const s = setup()
    s.execute.mockResolvedValueOnce(success(output))
    await expect(
      s.manager.apply('a', { type: 'delete', key: data.rules[0].key }, context(data))
    ).rejects.toThrow('SSH')
    expect(s.execute).toHaveBeenCalledTimes(1)
  })
  it('does not mutate after incomplete/permission-limited detection or native nft conflict', async () => {
    const s = setup()
    s.execute.mockResolvedValueOnce(success(firewallOutput(['ERROR|iptables|denied'])))
    await expect(s.manager.apply('a', { type: 'allow', draft }, context())).rejects.toThrow(
      '检测不完整'
    )
    s.execute.mockResolvedValueOnce(
      success(
        firewallOutput([
          'NFT_JSON|' +
            JSON.stringify({
              nftables: [
                { chain: { family: 'inet', table: 'native', name: 'input', hook: 'input' } }
              ]
            })
        ])
      )
    )
    await expect(s.manager.apply('a', { type: 'allow', draft }, context())).rejects.toThrow(
      'nftables'
    )
    expect(s.execute).toHaveBeenCalledTimes(2)
  })
  it('serializes writes per connection and releases the guard after failure', async () => {
    let resolve!: (value: any) => void
    const s = setup()
    s.execute.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    const first = s.manager.apply('a', { type: 'allow', draft }, context())
    await expect(s.manager.apply('a', { type: 'allow', draft }, context())).rejects.toThrow(
      '正在进行'
    )
    resolve(success('broken'))
    await expect(first).rejects.toThrow('不完整')
    s.execute.mockResolvedValueOnce(success('broken'))
    await expect(s.manager.apply('a', { type: 'allow', draft }, context())).rejects.toThrow(
      '不完整'
    )
  })
  it('verifies actual kernel rules, not just a successful command exit', async () => {
    const s = setup()
    s.execute
      .mockResolvedValueOnce(success(firewallOutput()))
      .mockResolvedValueOnce(success('__MSHELL_FIREWALL_COMMITTED__'))
      .mockResolvedValueOnce(success(firewallOutput(['CONFIG|runtime|4|tcp|443|203.0.113.8'])))
    await expect(s.manager.apply('a', { type: 'allow', draft }, context())).rejects.toThrow(
      '未确认'
    )
  })
  it('returns a verified temporary rule and passes the cancellation signal', async () => {
    const s = setup(),
      controller = new AbortController()
    s.execute
      .mockResolvedValueOnce(success(firewallOutput()))
      .mockResolvedValueOnce(success('__MSHELL_FIREWALL_COMMITTED__'))
      .mockResolvedValueOnce(
        success(
          firewallOutput([
            'CONFIG|runtime|4|tcp|443|203.0.113.8',
            'RULE_RAW|iptables|4|-A MSHELL-INPUT -s 203.0.113.8/32 -p tcp -m tcp --dport 443 -j ACCEPT'
          ])
        )
      )
    const result = await s.manager.apply(
      'a',
      { type: 'allow', draft },
      context(),
      controller.signal
    )
    expect(result.overview.rules[0]).toMatchObject({
      runtime: true,
      persistent: false,
      deletable: true
    })
    expect(s.execute.mock.calls[1][5]).toBe(controller.signal)
  })
  it('refuses stale connections after the SSH client is replaced mid-detection', async () => {
    const s = setup()
    s.execute.mockImplementationOnce(async () => {
      s.getConnection.mockReturnValue({ status: 'connected', client: {} })
      return success(firewallOutput())
    })
    await expect(s.manager.inspect('a')).rejects.toThrow('已变化')
  })
  it('requires a valid, unexpired enable confirmation before accepting more writes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'))
    const s = setup()
    const before = firewallOutput()
      .replace('TOOL|ufw|no|no|inactive', 'TOOL|ufw|yes|no|inactive')
      .replace('TOOL|iptables|yes|yes|active', 'TOOL|iptables|yes|no|inactive')
      .replace(/DROP/g, 'ACCEPT')
    s.execute
      .mockResolvedValueOnce(success(before))
      .mockResolvedValueOnce(success('__MSHELL_FIREWALL_COMMITTED__'))
      .mockResolvedValueOnce(success(firewallOutput([], 'ufw')))
    const result = await s.manager.apply('a', { type: 'enable', tool: 'ufw' }, context())
    expect(result.pending?.token).toBeTruthy()
    await expect(s.manager.apply('a', { type: 'disable', tool: 'ufw' }, context())).rejects.toThrow(
      '确认'
    )
    await expect(s.manager.confirm('a', 'wrong')).rejects.toThrow('过期')
    vi.setSystemTime(Date.now() + 90000)
    await expect(s.manager.confirm('a', result.pending!.token)).rejects.toThrow('过期')
  })
  it('uses the explicitly reviewed zone instead of silently switching to the default', async () => {
    const s = setup(),
      data = firewallOverview(zoneLines('runtime'), 'firewalld')
    s.execute.mockResolvedValueOnce(success(firewallOutput(zoneLines('runtime'), 'firewalld')))
    await expect(
      s.manager.apply(
        'a',
        { type: 'allow', draft: { ...draft, tool: 'firewalld', zone: 'missing' } },
        context(data)
      )
    ).rejects.toThrow('zone')
    expect(s.execute).toHaveBeenCalledTimes(1)
  })
})
