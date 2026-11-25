import { describe, expect, it, vi } from 'vitest'
import {
  SECTION_DOCKER,
  SECTION_END,
  SECTION_ESTABLISHED,
  SECTION_LISTEN,
  SECTION_META,
  SECTION_PROCESSES,
  SECTION_UNITS,
  buildPortCloseScript,
  parseCloseResult,
  parseDockerPorts,
  parsePortOverview,
  splitHostPort
} from '../port-scripts'
import { planClose } from '../../managers/PortManager'

vi.mock('../../managers/SSHConnectionManager', () => ({ sshConnectionManager: {} }))

const ssOutput = [
  SECTION_META,
  'privileged=yes',
  'tool=ss',
  'ssh=203.0.113.9 51234 10.0.0.5 22',
  'hostname=web-1',
  SECTION_LISTEN,
  'tcp   LISTEN 0      4096         0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=812,fd=3))',
  'tcp   LISTEN 0      4096            [::]:22           [::]:*    users:(("sshd",pid=812,fd=4))',
  'tcp   LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=1201,fd=6),("nginx",pid=1200,fd=6))',
  'tcp   LISTEN 0      128        127.0.0.1:6379      0.0.0.0:*    users:(("redis-server",pid=900,fd=6))',
  'udp   UNCONN 0      0      127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=600,fd=13))',
  'tcp   LISTEN 0      4096         0.0.0.0:8080      0.0.0.0:*    users:(("docker-proxy",pid=3000,fd=4))',
  'tcp   LISTEN 0      100          0.0.0.0:3306      0.0.0.0:*',
  SECTION_ESTABLISHED,
  '10.0.0.5:22 203.0.113.9:51234',
  '10.0.0.5:80 198.51.100.1:40000',
  '10.0.0.5:80 198.51.100.1:40001',
  '[::ffff:10.0.0.5]:80 [::ffff:198.51.100.2]:40002',
  '10.0.0.5:44444 93.184.216.34:443',
  SECTION_PROCESSES,
  '  812     1 root     10-02:03:04  0.0  0.1  7000 sshd: /usr/sbin/sshd -D [listener]',
  ' 1200     1 root        01:02:03  0.0  0.2  9000 nginx: master process /usr/sbin/nginx',
  ' 1201  1200 www-data    01:02:03  0.3  0.5 12000 nginx: worker process',
  '  900     1 redis       05:00  1.0  2.0 30000 /usr/bin/redis-server 127.0.0.1:6379',
  SECTION_UNITS,
  '812 ssh.service',
  '1200 nginx.service',
  '1201 nginx.service',
  '900 redis-server.service',
  SECTION_DOCKER,
  'web|0.0.0.0:8080->80/tcp, :::8080->80/tcp',
  SECTION_END
].join('\n')

describe('port overview parsing', () => {
  const overview = parsePortOverview(ssOutput, new Date('2026-10-20T00:00:00Z'))
  const byKey = (key: string) => overview.ports.find((item) => item.key === key)!

  it('merges sockets per protocol and port', () => {
    expect(overview.ports.map((item) => item.key)).toEqual([
      'tcp/22',
      'udp/53',
      'tcp/80',
      'tcp/3306',
      'tcp/6379',
      'tcp/8080'
    ])
    expect(byKey('tcp/22')).toMatchObject({
      addresses: ['0.0.0.0', '::'],
      exposure: 'all',
      isSshPort: true,
      connections: 1
    })
    expect(byKey('udp/53')).toMatchObject({ addresses: ['127.0.0.53'], exposure: 'local' })
    expect(byKey('tcp/6379').processes[0]).toMatchObject({
      pid: 900,
      user: 'redis',
      unit: 'redis-server.service',
      command: '/usr/bin/redis-server 127.0.0.1:6379'
    })
  })

  it('finds root processes and counts inbound connections', () => {
    const nginx = byKey('tcp/80')
    expect(nginx.processes.map((item) => item.pid)).toEqual([1200, 1201])
    expect(nginx.rootPids).toEqual([1200])
    expect(nginx.connections).toBe(3)
    expect(nginx.remoteClients).toBe(2)
  })

  it('marks docker ports and hidden owners', () => {
    expect(byKey('tcp/8080').containers).toEqual(['web'])
    expect(byKey('tcp/3306').processHidden).toBe(true)
    expect(overview.sshServerPort).toBe(22)
  })

  it('parses netstat output', () => {
    const netstat = parsePortOverview(
      [
        SECTION_META,
        'privileged=no',
        'tool=netstat',
        SECTION_LISTEN,
        'Active Internet connections (only servers)',
        'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
        'tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      812/sshd',
        'tcp6       0      0 :::443                  :::*                    LISTEN      -',
        'udp        0      0 0.0.0.0:68              0.0.0.0:*                           700/dhclient',
        SECTION_END
      ].join('\n')
    )
    expect(netstat.ports.map((item) => [item.key, item.addresses, item.processHidden])).toEqual([
      ['tcp/22', ['0.0.0.0'], false],
      ['udp/68', ['0.0.0.0'], false],
      ['tcp/443', ['::'], true]
    ])
    expect(netstat.warnings[0]).toContain('免密 sudo')
  })

  it('rejects incomplete output and parses helpers', () => {
    expect(() => parsePortOverview('garbage')).toThrow('不完整')
    expect(splitHostPort('[::ffff:127.0.0.1]:80')).toEqual({ host: '::ffff:127.0.0.1', port: 80 })
    expect(splitHostPort('*:80')).toEqual({ host: '*', port: 80 })
    expect(parseDockerPorts(['db|0.0.0.0:5432-5433->5432-5433/tcp']).get('tcp/5433')).toEqual([
      'db'
    ])
  })

  it('guards close requests', () => {
    const request = (key: string, mode: 'term' | 'kill' | 'service', expectedPids: number[]) => {
      const entry = byKey(key)
      return planClose(entry, { protocol: entry.protocol, port: entry.port, mode, expectedPids })
    }
    expect(() => request('tcp/22', 'term', [812])).toThrow('SSH')
    expect(() => request('tcp/8080', 'term', [3000])).toThrow('Docker')
    expect(() => request('tcp/3306', 'term', [])).toThrow('不可见')
    expect(() => request('tcp/80', 'term', [1201])).toThrow('已变化')
    expect(request('tcp/80', 'term', [1200])).toEqual({ pids: [1200] })
    expect(request('tcp/80', 'service', [1200])).toEqual({ pids: [1200], unit: 'nginx.service' })
  })

  it('builds safe close scripts', () => {
    expect(() => buildPortCloseScript('term', [1])).toThrow()
    expect(() => buildPortCloseScript('service', [5], 'x; rm -rf /')).toThrow()
    const script = buildPortCloseScript('kill', [1200, 1300])
    expect(script).toContain('kill -KILL "$p"')
    expect(script).toContain('for p in 1200 1300')
    expect(buildPortCloseScript('service', [1200], 'nginx.service')).toContain(
      "systemctl --no-ask-password stop 'nginx.service'"
    )
    expect(
      parseCloseResult('已向进程 1200 发送 SIGTERM\n__MSHELL_PORTS_CLOSE_RESULT__ status=0 alive=')
    ).toEqual({ status: 0, alive: [], log: '已向进程 1200 发送 SIGTERM' })
  })
})
