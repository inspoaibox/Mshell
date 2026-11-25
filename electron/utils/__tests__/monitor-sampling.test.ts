// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  buildCoreMonitorCommand,
  parseCoreSample,
  calculateCoreMetrics,
  parseDiskMetrics,
  parseDockerMetrics
} from '../monitor-sampling'

export const sampleOutput = (
  total = 4000,
  idle = 3000,
  uptime = 100,
  ticks = 100,
  start = '5',
  net = 1000
) => `__MSHELL_MONITOR_V1__
CPU|${total}|${idle}
CORES|4
UPTIME|${uptime}
LOAD|0.1|0.2|0.3
MEM|1000|100|400
NET|eth0|${net}|${net * 2}|10|20
PROC|10|${start}|${ticks}|100|0|R|worker (pool)
HOST|test-server
PLATFORM|Linux
KERNEL|6.8
__END_MSHELL_MONITOR__`

describe('monitor sample calculations', () => {
  it('reports warmup instead of invented CPU and network rates on the first frame', () => {
    const metrics = calculateCoreMetrics(parseCoreSample(sampleOutput()))
    expect(metrics.cpu.usage).toBeNull()
    expect(metrics.network.speedIn).toBeNull()
    expect(metrics.topProcesses[0].cpu).toBeNull()
    expect(metrics.memory).toMatchObject({ used: 600, available: 400, usage: 60 })
  })
  it('uses elapsed samples, including multi-core process percentages above 100%', () => {
    const metrics = calculateCoreMetrics(
      parseCoreSample(sampleOutput(4400, 3200, 101, 220, '5', 2000)),
      parseCoreSample(sampleOutput())
    )
    expect(metrics.cpu.usage).toBe(50)
    expect(metrics.topProcesses[0].cpu).toBe(120)
    expect(metrics.network.speedIn).toBe(1000)
    expect(metrics.network.speedOut).toBe(2000)
    expect(metrics.sampleIntervalMs).toBe(1000)
  })
  it('does not attribute old CPU time to reused PIDs or negative traffic to reset interfaces', () => {
    const metrics = calculateCoreMetrics(
      parseCoreSample(sampleOutput(4400, 3200, 102, 900, '6', 100)),
      parseCoreSample(sampleOutput())
    )
    expect(metrics.topProcesses[0].cpu).toBeNull()
    expect(metrics.network.speedIn).toBe(0)
    const rebooted = calculateCoreMetrics(
      parseCoreSample(sampleOutput(10, 2, 1)),
      parseCoreSample(sampleOutput())
    )
    expect(rebooted.cpu.usage).toBeNull()
    expect(rebooted.network.speedIn).toBeNull()
  })
  it('ignores the initial counters of a newly created interface', () => {
    const output = sampleOutput(4400, 3200, 101, 220, '5', 2000).replace(
      '__END_MSHELL_MONITOR__',
      'NET|veth-new|9000000|9000000|0|0\n__END_MSHELL_MONITOR__'
    )
    const metrics = calculateCoreMetrics(parseCoreSample(output), parseCoreSample(sampleOutput()))
    expect(metrics.network.speedIn).toBe(1000)
  })
  it('rejects incomplete or unsupported snapshots', () => {
    expect(() => parseCoreSample(sampleOutput().replace('__END_MSHELL_MONITOR__', ''))).toThrow(
      /不完整/
    )
    expect(() => parseCoreSample(sampleOutput().replace('MEM|1000', 'MEM|0'))).toThrow(/无法读取/)
  })
  it('does not double-count capacity for bind mounts of the same filesystem', () => {
    const disk = parseDiskMetrics('/dev/a|/|1000|300|700\n/dev/a|/bind mount|1000|300|700')
    expect(disk.total).toBe(1000)
    expect(disk.filesystems).toHaveLength(2)
    expect(() => parseDiskMetrics('')).toThrow()
  })
  it('distinguishes absent Docker from failed or partial Docker sampling', () => {
    expect(parseDockerMetrics('__NO_DOCKER__\n')).toEqual({ available: false, containers: [] })
    expect(() => parseDockerMetrics('__DOCKER_PS__\nweb|Up')).toThrow()
    const result = parseDockerMetrics(
      '__DOCKER_PS__\nweb|Up\nstopped|Exited\n__DOCKER_STATS__\nweb|3%|4%|2kB / 4kB\n__END_DOCKER__'
    )
    expect(result.containers[0].cpu).toBe('3%')
    expect(result.containers[1].cpu).toBe('-')
  })
})

const awk = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/awk.exe' : 'awk'
it.skipIf(process.platform === 'win32' && !existsSync(awk))(
  'executes the actual awk collector against procfs fixtures, including disappearing PIDs',
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'mshell-monitor-'))
    const root = directory.replace(/\\/g, '/')
    const put = (file: string, data: string) => {
      const target = join(directory, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, data)
    }
    try {
      put('stat', 'cpu  100 0 20 200 3 4 5 6 8 9\ncpu0 1\ncpu1 1\n')
      put('uptime', '100.25 0\n')
      put('loadavg', '0.1 0.2 0.3 1/100 123\n')
      put('meminfo', 'MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\n')
      put(
        'net/dev',
        '  eth0: 12345678901 1 0 0 0 0 0 0 22345678901 2 0 0 0 0 0 0\n lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0\n'
      )
      put('sys/kernel/hostname', 'fixture\n')
      put('sys/kernel/ostype', 'Linux\n')
      put('sys/kernel/osrelease', '6.8\n')
      const fields = Array<string>(50).fill('0')
      fields[0] = 'R'
      fields[11] = '110'
      fields[12] = '20'
      fields[19] = '98765'
      put('123/stat', '123 (worker (pool)) ' + fields.join(' ') + '\n')
      put('123/status', 'Name:\tworker\nUid:\t0\t0\t0\t0\nVmRSS:\t100 kB\n')
      const command = buildCoreMonitorCommand(true, true)
      const program = command
        .slice(command.indexOf("'") + 1, command.lastIndexOf("'"))
        .split('/proc/')
        .join(root + '/')
      const run = spawnSync(
        awk,
        [
          '-v',
          'identity=1',
          '-v',
          'processes=1',
          program,
          root + '/123/stat',
          root + '/missing/stat'
        ],
        { encoding: 'utf8' }
      )
      expect(run.status, run.stderr).toBe(0)
      const sample = parseCoreSample(run.stdout)
      expect(sample.totalTicks).toBe(338)
      expect(sample.memory.available).toBe(400 * 1024)
      expect(sample.network.get('eth0')?.bytesIn).toBe(12345678901)
      expect(sample.network.has('lo')).toBe(false)
      expect(sample.processes.get(123)).toMatchObject({
        command: 'worker (pool)',
        ticks: 130,
        rss: 102400,
        started: '98765'
      })
      expect(sample.identity.hostname).toBe('fixture')
    } finally {
      if (resolve(dirname(directory)) === resolve(tmpdir()))
        rmSync(directory, { recursive: true, force: true })
    }
  }
)
