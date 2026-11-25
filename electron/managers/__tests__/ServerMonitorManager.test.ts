// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'
import { ServerMonitorManager } from '../ServerMonitorManager'
import type { ServerMetrics } from '../../../src/types/monitor'

type Kind = 'core' | 'disk' | 'docker'
class TestChannel extends EventEmitter {
  stderr = new EventEmitter()
  close = vi.fn()
  signal = vi.fn()
}
interface Request {
  kind: Kind
  command: string
  channel: TestChannel
  open: () => void
  done: boolean
}
class TestClient extends EventEmitter {
  requests: Request[] = []
  delayOpen = false
  exec(command: string, callback: Function) {
    const channel = new TestChannel()
    const kind: Kind = command.includes('__MSHELL_MONITOR_V1__')
      ? 'core'
      : command.includes('__DOCKER_PS__')
        ? 'docker'
        : 'disk'
    const request = { kind, command, channel, open: () => callback(null, channel), done: false }
    this.requests.push(request)
    if (!this.delayOpen) request.open()
  }
  reply(kind: Kind, text: string, code = 0) {
    const request = this.requests.find((item) => item.kind === kind && !item.done)!
    request.done = true
    request.channel.emit('data', Buffer.from(text))
    request.channel.emit('close', code)
    return request
  }
  asClient() {
    return this as unknown as Client
  }
  count(kind: Kind) {
    return this.requests.filter((item) => item.kind === kind).length
  }
}
const core = (uptime = 100) => `__MSHELL_MONITOR_V1__
CPU|${uptime * 400}|${uptime * 200}
CORES|4
UPTIME|${uptime}
LOAD|0.1|0.2|0.3
MEM|1000|100|400
NET|eth0|${uptime * 100}|${uptime * 200}|10|20
PROC|10|5|${uptime * 100}|100|0|R|worker
HOST|test
PLATFORM|Linux
KERNEL|6.8
__END_MSHELL_MONITOR__`
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe('monitor scheduling and lifecycle', () => {
  let manager: ServerMonitorManager
  let client: TestClient
  let frames: ServerMetrics[]
  const errors = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
    errors.mockClear()
    manager = new ServerMonitorManager()
    client = new TestClient()
    frames = []
    manager.on('metrics', (_id, metrics) => frames.push(metrics))
    manager.on('error', errors)
  })
  afterEach(async () => {
    for (const id of manager.getMonitoredSessions()) manager.stopMonitoring(id)
    await flush()
    vi.useRealTimers()
  })

  it('publishes core frames every second without waiting for slow Docker or disk queries', async () => {
    manager.startMonitoring('a', client.asClient())
    expect(client.requests).toHaveLength(3)
    client.reply('core', core())
    await flush()
    expect(frames).toHaveLength(1)
    expect(frames[0].disk).toBeNull()
    await vi.advanceTimersByTimeAsync(1000)
    client.reply('core', core(101))
    await flush()
    expect(frames.at(-1)?.cpu.usage).toBe(50)
    expect(client.count('docker')).toBe(1)
    expect(client.count('disk')).toBe(1)
    expect(client.count('core')).toBe(2)
  })

  it('runs disk and Docker at independent 10s and 5s cadences', async () => {
    manager.startMonitoring('a', client.asClient())
    client.reply('core', core())
    client.reply('disk', '/dev/a|/|1000|100|900')
    client.reply('docker', '__NO_DOCKER__')
    await flush()
    const firstTimestamp = frames.at(-1)!.timestamp
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.count('docker')).toBe(2)
    expect(client.count('disk')).toBe(1)
    client.reply('docker', '__NO_DOCKER__')
    await flush()
    expect(frames.at(-1)!.timestamp).toBe(firstTimestamp)
    expect(frames.at(-1)!.sources.docker.timestamp).not.toBe(firstTimestamp)
    await vi.advanceTimersByTimeAsync(5000)
    expect(client.count('disk')).toBe(2)
  })

  it('coalesces manual refresh with a running collection instead of opening duplicate channels', async () => {
    manager.startMonitoring('a', client.asClient())
    const refresh = manager.refreshMetrics('a')
    expect(client.requests).toHaveLength(3)
    client.reply('core', core())
    expect((await refresh)?.sessionId).toBe('a')
  })

  it('times out and closes stuck channels, releases the pending promise, and retries', async () => {
    manager.startMonitoring('a', client.asClient())
    const refresh = manager.refreshMetrics('a')
    await vi.advanceTimersByTimeAsync(8000)
    expect(await refresh).toBeUndefined()
    expect(errors).toHaveBeenCalledWith('a', expect.stringContaining('超时'))
    expect(client.requests[0].channel.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(client.count('core')).toBe(2)
  })

  it('aborts a request that has not opened a channel and closes its late callback', async () => {
    client.delayOpen = true
    manager.startMonitoring('a', client.asClient())
    manager.stopMonitoring('a')
    client.requests.forEach((request) => request.open())
    await flush()
    expect(client.requests.every((request) => request.channel.close.mock.calls.length === 1)).toBe(
      true
    )
    expect(
      client.requests.every((request) => request.channel.signal.mock.calls[0]?.[0] === 'TERM')
    ).toBe(true)
    client.requests[0].channel.emit('error', new Error('late channel error'))
    expect(frames).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('prevents results and timers from a stopped generation overwriting a restarted monitor', async () => {
    manager.startMonitoring('a', client.asClient())
    const next = new TestClient()
    manager.startMonitoring('a', next.asClient())
    client.reply('core', core())
    await flush()
    expect(frames).toHaveLength(0)
    next.reply('core', core(200))
    await flush()
    await vi.advanceTimersByTimeAsync(1000)
    expect(next.count('core')).toBe(2)
    expect(client.count('core')).toBe(1)
    expect(manager.getLatestMetrics('a')?.system.uptime).toBe(200)
  })

  it('rebinds after SSH reconnect, resets rate baselines, and respects manual pause', async () => {
    manager.startMonitoring('a', client.asClient())
    client.reply('core', core())
    await flush()
    client.emit('close')
    await flush()
    expect(frames.at(-1)?.connection).toBe('waiting')
    const next = new TestClient()
    manager.resumeMonitoring('a', next.asClient())
    next.reply('core', core(300))
    await flush()
    expect(frames.at(-1)?.cpu.usage).toBeNull()
    expect(frames.at(-1)?.connection).toBe('connected')
    manager.stopMonitoring('a')
    const later = new TestClient()
    manager.resumeMonitoring('a', later.asClient())
    expect(later.requests).toHaveLength(0)
  })

  it('changes the interval without resetting CPU samples and rejects invalid values', async () => {
    manager.startMonitoring('a', client.asClient())
    client.reply('core', core())
    await flush()
    manager.updateConfig('a', { interval: 5000 })
    client.reply('core', core(101))
    await flush()
    expect(frames.at(-1)?.cpu.usage).toBe(50)
    expect(frames.at(-1)?.interval).toBe(5000)
    await vi.advanceTimersByTimeAsync(4999)
    expect(client.count('core')).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.count('core')).toBe(3)
    expect(() => manager.updateConfig('a', { interval: -1 })).toThrow()
  })

  it('keeps valid core data when Docker fails and exposes the section error', async () => {
    manager.startMonitoring('a', client.asClient())
    client.reply('core', core())
    await flush()
    const request = client.requests.find((item) => item.kind === 'docker')!
    request.channel.stderr.emit('data', Buffer.from('Docker permission denied'))
    client.reply('docker', '', 1)
    await flush()
    expect(frames.at(-1)?.memory.usage).toBe(60)
    expect(frames.at(-1)?.sources.docker.error).toContain('permission denied')
    expect(errors).not.toHaveBeenCalled()
  })

  it('bounds output and reports malformed samples as errors rather than zero usage', async () => {
    manager.startMonitoring('a', client.asClient())
    client.reply('core', 'partial output')
    await flush()
    expect(manager.getLatestMetrics('a')).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1000)
    client.reply('core', 'x'.repeat(2 * 1024 * 1024 + 1))
    await flush()
    expect(errors).toHaveBeenLastCalledWith('a', expect.stringContaining('上限'))
    expect(
      client.requests.filter((item) => item.kind === 'core').at(-1)?.channel.close
    ).toHaveBeenCalledOnce()
  })
})
