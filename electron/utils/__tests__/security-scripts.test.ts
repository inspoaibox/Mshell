import { describe, expect, it } from 'vitest'
import {
  SEC_AUTH,
  SEC_CONN,
  SEC_END,
  SEC_FAILED,
  SEC_LAST,
  SEC_META,
  SEC_WHO,
  parseAuthLine,
  parseSecurityDetails,
  parseSecuritySummary
} from '../security-scripts'
import {
  collectSourceIps,
  ipMatchesRule,
  isValidTrustRule,
  trustLevelOf
} from '../../../src/utils/security-trust'

const output = [
  SEC_META,
  'self=203.0.113.9 51234 10.0.0.5 22',
  'privileged=yes',
  'sshport=22',
  'hostname=web-1',
  SEC_WHO,
  'root     pts/0        2026-10-20 10:00   .          4321 (203.0.113.9)',
  'deploy   pts/1        2026-10-20 11:30 00:05        5555 (198.51.100.7)',
  'admin    tty1         2026-10-19 08:00  old         777',
  SEC_CONN,
  'ss ESTAB 0 0 10.0.0.5:22 203.0.113.9:51234 users:(("sshd",pid=4320,fd=4))',
  'ss ESTAB 0 0 [::ffff:10.0.0.5]:22 [::ffff:198.51.100.7]:40000 users:(("sshd",pid=5554,fd=4))',
  'ss ESTAB 0 0 10.0.0.5:3389 192.0.2.50:50000 users:(("xrdp",pid=900,fd=12))',
  'netstat tcp 0 0 10.0.0.5:22 192.0.2.60:41000 ESTABLISHED 6000/sshd: deploy',
  SEC_FAILED,
  '17',
  SEC_LAST,
  'deploy   pts/1        198.51.100.7     Mon Oct 20 11:30:01 2026   still logged in',
  'root     pts/0        203.0.113.9      Mon Oct 20 08:00:00 2026 - Mon Oct 20 09:15:00 2026  (01:15)',
  'reboot   system boot  6.8.0-45-generic Sun Oct 19 07:59:00 2026   still running',
  SEC_AUTH,
  'source=journal',
  '2026-10-20T11:30:01+0800 web-1 sshd[5554]: Accepted publickey for deploy from 198.51.100.7 port 40000 ssh2: ED25519 SHA256:abc',
  '2026-10-20T11:31:00+0800 web-1 sshd[6100]: Failed password for invalid user admin from 45.0.0.1 port 1111 ssh2',
  '2026-10-20T11:31:02+0800 web-1 sshd[6101]: Invalid user test from 45.0.0.1 port 1112',
  '2026-10-20T11:31:05+0800 web-1 sshd[6102]: Failed password for root from 45.0.0.2 port 1113 ssh2',
  SEC_END
].join('\n')

describe('security parsing', () => {
  it('parses sessions, connections and failure count', () => {
    const summary = parseSecuritySummary(output)
    expect(summary.selfIp).toBe('203.0.113.9')
    expect(summary.failedLastHour).toBe(17)
    expect(summary.sessions.map((s) => [s.user, s.tty, s.ip, s.pid])).toEqual([
      ['root', 'pts/0', '203.0.113.9', 4321],
      ['deploy', 'pts/1', '198.51.100.7', 5555],
      ['admin', 'tty1', undefined, 777]
    ])
    expect(summary.connections.map((c) => [c.ip, c.localPort, c.process])).toEqual([
      ['203.0.113.9', 22, 'sshd'],
      ['198.51.100.7', 22, 'sshd'],
      ['192.0.2.50', 3389, 'xrdp'],
      ['192.0.2.60', 22, 'sshd:']
    ])
  })

  it('parses login history and auth log', () => {
    const details = parseSecurityDetails(output)
    expect(details.logins).toEqual([
      expect.objectContaining({ user: 'deploy', ip: '198.51.100.7', active: true }),
      expect.objectContaining({
        user: 'root',
        start: 'Mon Oct 20 08:00:00 2026',
        end: 'Mon Oct 20 09:15:00 2026',
        duration: '01:15',
        active: false
      })
    ])
    expect(details.authSource).toBe('journal')
    expect(details.authEvents[0]).toMatchObject({ type: 'failed', user: 'root', ip: '45.0.0.2' })
    expect(details.authEvents.at(-1)).toMatchObject({
      type: 'accepted',
      user: 'deploy',
      method: 'publickey',
      port: 40000
    })
    expect(details.failedSources).toEqual([
      expect.objectContaining({
        ip: '45.0.0.1',
        count: 2,
        users: ['admin', 'test'],
        lastTime: '2026-10-20T11:31:02+0800'
      }),
      expect.objectContaining({ ip: '45.0.0.2', count: 1 })
    ])
  })

  it('parses syslog lines and unknown failure counts', () => {
    expect(
      parseAuthLine('Oct 20 11:31:00 web-1 sshd[6100]: Failed publickey for git from 10.1.1.1 port 22 ssh2')
    ).toMatchObject({ time: 'Oct 20 11:31:00', type: 'failed', user: 'git', ip: '10.1.1.1' })
    const unknown = parseSecuritySummary(output.replace(`${SEC_FAILED}\n17`, `${SEC_FAILED}\n-`))
    expect(unknown.failedLastHour).toBeNull()
    expect(() => parseSecuritySummary('broken')).toThrow('不完整')
  })

  it('classifies trusted and untrusted sources', () => {
    expect(isValidTrustRule('10.0.0.0/8')).toBe(true)
    expect(isValidTrustRule('10.0.0.0/33')).toBe(false)
    expect(isValidTrustRule('not-an-ip')).toBe(false)
    expect(ipMatchesRule('10.20.30.40', '10.0.0.0/8')).toBe(true)
    expect(ipMatchesRule('11.0.0.1', '10.0.0.0/8')).toBe(false)
    expect(trustLevelOf('203.0.113.9', [], '203.0.113.9')).toBe('self')
    expect(trustLevelOf('127.0.0.1', [])).toBe('local')

    const sources = collectSourceIps(parseSecuritySummary(output), ['192.0.2.0/24'])
    expect(sources.map((s) => [s.ip, s.level])).toEqual([
      ['198.51.100.7', 'untrusted'],
      ['192.0.2.50', 'trusted'],
      ['192.0.2.60', 'trusted'],
      ['203.0.113.9', 'self']
    ])
    expect(sources[0]).toMatchObject({ connections: 1, sessions: 1, users: ['deploy'] })
  })
})
