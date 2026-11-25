import { describe, expect, it } from 'vitest'
import type { PortEntry } from '../types/ports'
import { closeBlockReason, filterPorts, formatElapsed, stoppableUnitOf } from './port-utils'

const entry = (port: number, extra: Partial<PortEntry> = {}): PortEntry => ({
  key: `tcp/${port}`,
  protocol: 'tcp',
  port,
  addresses: ['0.0.0.0'],
  exposure: 'all',
  processes: [
    { pid: port * 10, ppid: 1, name: `svc${port}`, user: 'root', elapsed: '01:00', cpu: '0.0', memory: '0.1', command: `/usr/bin/svc${port}`, unit: `svc${port}.service` }
  ],
  rootPids: [port * 10],
  connections: 0,
  remoteClients: 0,
  containers: [],
  isSshPort: false,
  processHidden: false,
  ...extra
})

describe('port utils', () => {
  const ports = [
    entry(22, { isSshPort: true }),
    entry(80),
    entry(6379, { exposure: 'local', addresses: ['127.0.0.1'] }),
    entry(8080, { containers: ['web'] }),
    { ...entry(53), key: 'udp/53', protocol: 'udp' as const }
  ]
  const search = (keyword: string, extra: Partial<Parameters<typeof filterPorts>[1]> = {}) =>
    filterPorts(ports, { keyword, protocol: 'all', exposure: 'any', ...extra }).map((p) => p.key)

  it('searches by port, range and process details', () => {
    expect(search('80')).toEqual(['tcp/80'])
    expect(search('8000-9000')).toEqual(['tcp/8080'])
    expect(search('svc63')).toEqual(['tcp/6379'])
    expect(search('web')).toEqual(['tcp/8080'])
    expect(search('', { protocol: 'udp' })).toEqual(['udp/53'])
    expect(search('', { exposure: 'local' })).toEqual(['tcp/6379'])
  })

  it('explains why a port cannot be closed', () => {
    expect(closeBlockReason(ports[0])).toContain('SSH')
    expect(closeBlockReason(ports[3])).toContain('Docker')
    expect(closeBlockReason(entry(1, { processHidden: true, processes: [] }))).toContain('不可见')
    expect(closeBlockReason(ports[1])).toBeUndefined()
    expect(stoppableUnitOf(ports[1])).toBe('svc80.service')
    expect(
      stoppableUnitOf(entry(9, { processes: [{ ...ports[1].processes[0], pid: 90, unit: 'sshd.service' }] }))
    ).toBeUndefined()
  })

  it('formats ps elapsed time', () => {
    expect(formatElapsed('3-04:05:06')).toBe('3 天 4 小时')
    expect(formatElapsed('04:05:06')).toBe('4 小时 5 分')
    expect(formatElapsed('05:06')).toBe('5 分钟')
  })
})
