import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import ServerMonitorPanel from './ServerMonitorPanel.vue'
import type { ServerMetrics } from '@/types/monitor'
import type { SecuritySummary } from '@/types/security'
import { saveTrustRules } from '@/utils/security-trust'

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}

const frame = (): ServerMetrics => ({
  sessionId: 'session-a',
  timestamp: new Date().toISOString(),
  interval: 1000,
  sampleIntervalMs: 1000,
  collectionDurationMs: 50,
  connection: 'connected',
  cpu: { usage: 10, cores: 2, loadAverage: [0.1, 0.1, 0.1] },
  memory: { total: 1000, used: 100, available: 900, free: 900, usage: 10 },
  disk: null,
  network: { bytesIn: 1, bytesOut: 1, packetsIn: 1, packetsOut: 1, speedIn: 0, speedOut: 0 },
  processes: { total: 1, running: 1, sleeping: 0, zombie: 0 },
  topProcesses: [],
  dockerContainers: [],
  system: { uptime: 100, hostname: 'web-1', platform: 'Linux', kernel: '6.8' },
  sources: { core: {}, disk: {}, docker: {} }
})

const summary = (): SecuritySummary => ({
  collectedAt: new Date().toISOString(),
  hostname: 'web-1',
  selfIp: '203.0.113.9',
  sshPort: 22,
  privileged: true,
  sessions: [
    { user: 'root', tty: 'pts/0', loginAt: '2026-10-20 10:00', host: '203.0.113.9', ip: '203.0.113.9' },
    { user: 'deploy', tty: 'pts/1', loginAt: '2026-10-20 11:00', host: '198.51.100.7', ip: '198.51.100.7' }
  ],
  connections: [
    { ip: '203.0.113.9', port: 50000, localPort: 22, process: 'sshd' },
    { ip: '198.51.100.7', port: 50001, localPort: 22, process: 'sshd' }
  ],
  failedLastHour: 12,
  warnings: []
})

describe('monitor security card', () => {
  let app: App | undefined
  let host: HTMLElement
  let send: (id: string, data: ServerMetrics) => void
  const api = {
    start: vi.fn(),
    stop: vi.fn(),
    updateConfig: vi.fn(),
    refresh: vi.fn(),
    onMetrics: vi.fn(),
    onError: vi.fn(),
    getSecurity: vi.fn(),
    getSecurityDetails: vi.fn()
  }

  const mount = async (hostKey = 'web-1.example.com:22') => {
    app = createApp({
      render: () => h(ServerMonitorPanel, { sessionId: 'session-a', active: true, hostKey })
    })
    app.mount(host)
    await flush()
    send('session-a', frame())
    await flush()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    localStorage.clear()
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    api.start.mockResolvedValue({ success: true })
    api.stop.mockResolvedValue({ success: true })
    api.onMetrics.mockImplementation((callback) => {
      send = callback
      return vi.fn()
    })
    api.onError.mockReturnValue(vi.fn())
    api.getSecurity.mockResolvedValue({ success: true, data: summary() })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { serverMonitor: api }
    })
    host = document.createElement('div')
    document.body.append(host)
  })

  afterEach(async () => {
    app?.unmount()
    app = undefined
    await flush()
    host.remove()
    vi.useRealTimers()
  })

  it('shows online users and flags untrusted source IPs', async () => {
    await mount()
    const card = host.querySelector('.security-card')!
    expect(api.getSecurity).toHaveBeenCalledWith('session-a')
    expect(card.classList.contains('has-risk')).toBe(true)
    expect(card.textContent).toContain('发现 1 个非信任 IP')
    expect(card.textContent).toContain('在线用户2')
    expect(card.textContent).toContain('12')
    expect(card.querySelector('.source-chip.untrusted')?.textContent).toBe('198.51.100.7')
  })

  it('treats IPs in the per-host trust rules as trusted and polls every 15 seconds', async () => {
    saveTrustRules('web-1.example.com:22', ['198.51.100.0/24'])
    await mount()
    const card = host.querySelector('.security-card')!
    expect(card.classList.contains('has-risk')).toBe(false)
    expect(card.textContent).toContain('来源均可信')

    await vi.advanceTimersByTimeAsync(15000)
    expect(api.getSecurity).toHaveBeenCalledTimes(2)
  })
})
