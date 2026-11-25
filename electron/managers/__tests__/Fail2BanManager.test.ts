// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
vi.mock('../SSHConnectionManager', () => ({ sshConnectionManager: {} }))
import { Fail2BanManager } from '../Fail2BanManager'
import {
  buildFail2BanDetectCommand,
  buildFail2BanInstallCommand,
  buildFail2BanUnbanCommand,
  FAIL2BAN_DETECT_END,
  FAIL2BAN_DETECT_START,
  FAIL2BAN_OPERATION_DONE
} from '../../utils/fail2ban-commands'

const success = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 })

const overviewOutput = () => `${FAIL2BAN_DETECT_START}
ENV|debian|Debian GNU/Linux 13 (trixie)|13|apt|yes|yes
META|yes|Fail2Ban v1.1.0|active|yes|yes|1000
JAIL|sshd|2|18|3|12|203.0.113.8 198.51.100.14
JAIL|nginx-http-auth|0|4|0|1|
${FAIL2BAN_DETECT_END}
`

const failedOverviewOutput = () =>
  [
    FAIL2BAN_DETECT_START,
    'ENV|debian|Debian GNU/Linux 12 (bookworm)|12|apt|no|yes',
    'META|yes|Fail2Ban v1.0.2|failed|no|yes|0|Have not found any log file for sshd jail',
    FAIL2BAN_DETECT_END
  ].join('\n') + '\n'

describe('Fail2BanManager', () => {
  it.skipIf(process.platform === 'win32' && !existsSync('C:\\Program Files\\Git\\usr\\bin\\sh.exe'))(
    'generates valid POSIX shell scripts',
    () => {
      const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\sh.exe' : '/bin/sh'
      for (const script of [
        buildFail2BanDetectCommand(),
        buildFail2BanInstallCommand(),
        buildFail2BanUnbanCommand('sshd', '203.0.113.8')
      ]) {
        const result = spawnSync(shell, ['-n'], { input: script, encoding: 'utf8' })
        expect(result.status, result.stderr).toBe(0)
      }
    }
  )

  it('parses server environment, service state, jails and banned IPs', async () => {
    const executeCommandDetailed = vi.fn().mockResolvedValue(success(overviewOutput()))
    const manager = new Fail2BanManager({ executeCommandDetailed })

    const overview = await manager.getOverview('connection-1')

    expect(overview).toMatchObject({
      installed: true,
      running: true,
      enabled: true,
      environment: { osId: 'debian', packageManager: 'apt', canSudo: true },
      totalCurrentlyBanned: 3,
      totalBanned: 13,
      totalFailed: 22
    })
    expect(overview.jails[0]).toMatchObject({
      name: 'sshd',
      currentlyFailed: 2,
      bannedIps: ['203.0.113.8', '198.51.100.14']
    })
  })

  it('surfaces the service failure reason instead of reporting a healthy install', async () => {
    const executeCommandDetailed = vi.fn().mockResolvedValue(success(failedOverviewOutput()))
    const manager = new Fail2BanManager({ executeCommandDetailed })

    const overview = await manager.getOverview('connection-1')

    expect(overview.running).toBe(false)
    expect(overview.serviceError).toContain('Have not found any log file')
    expect(overview.warnings.join(' ')).toContain('服务启动原因')
  })

  it('installs and refreshes the verified state', async () => {
    const executeCommandDetailed = vi
      .fn()
      .mockResolvedValueOnce(success(`${FAIL2BAN_OPERATION_DONE}\n安装完成`))
      .mockResolvedValueOnce(success(overviewOutput()))
    const manager = new Fail2BanManager({ executeCommandDetailed })

    const result = await manager.install('connection-1')

    expect(result.overview?.running).toBe(true)
    expect(executeCommandDetailed).toHaveBeenCalledTimes(2)
  })

  it('unbans only valid jail and IP values and refreshes afterward', async () => {
    const executeCommandDetailed = vi
      .fn()
      .mockResolvedValueOnce(success(`${FAIL2BAN_OPERATION_DONE}\nUnbanned`))
      .mockResolvedValueOnce(success(overviewOutput()))
    const manager = new Fail2BanManager({ executeCommandDetailed })

    await manager.unban('connection-1', 'sshd', '203.0.113.8')
    expect(executeCommandDetailed.mock.calls[0][1]).toContain('unbanip')
    await expect(manager.unban('connection-1', 'sshd;rm', '203.0.113.8')).rejects.toThrow('jail')
    await expect(manager.unban('connection-1', 'sshd', 'not-an-ip')).rejects.toThrow('IP')
  })

  it('serializes install and unban operations per connection', async () => {
    let resolve!: (value: any) => void
    const executeCommandDetailed = vi.fn().mockImplementationOnce(
      () => new Promise((done) => (resolve = done))
    )
    const manager = new Fail2BanManager({ executeCommandDetailed })
    const first = manager.install('connection-1')

    await expect(manager.unban('connection-1', 'sshd', '203.0.113.8')).rejects.toThrow('正在进行')
    executeCommandDetailed.mockResolvedValueOnce(success('broken detection'))
    resolve(success(`${FAIL2BAN_OPERATION_DONE}\n安装完成`))
    await expect(first).rejects.toThrow('检测输出不完整')
  })
})
