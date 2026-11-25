import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import ServerMonitorPanel from './ServerMonitorPanel.vue'
import type { ServerMetrics } from '@/types/monitor'

describe('monitor panel controls and lifecycle', () => {
  let app: App | undefined
  let host: HTMLElement
  let send: (id: string, frame: ServerMetrics) => void
  const props = reactive({ sessionId: 'session-a', active: true })
  const api = {
    start: vi.fn(),
    stop: vi.fn(),
    updateConfig: vi.fn(),
    refresh: vi.fn(),
    onMetrics: vi.fn(),
    onError: vi.fn()
  }
  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
      await nextTick()
    }
  }
  const frame = (cpu = 25): ServerMetrics => ({
    sessionId: 'session-a',
    timestamp: new Date().toISOString(),
    interval: 1000,
    sampleIntervalMs: 1000,
    collectionDurationMs: 80,
    connection: 'connected',
    cpu: { usage: cpu, cores: 4, loadAverage: [0.3, 0.2, 0.1] },
    memory: { total: 1000, used: 400, available: 600, free: 100, usage: 40 },
    disk: null,
    network: {
      bytesIn: 1000,
      bytesOut: 2000,
      packetsIn: 1,
      packetsOut: 2,
      speedIn: 100,
      speedOut: 200
    },
    processes: { total: 2, running: 1, sleeping: 1, zombie: 0 },
    topProcesses: [
      { pid: 10, user: 'root', command: 'worker', cpu: 80, memory: 2 },
      { pid: 20, user: 'root', command: 'database', cpu: 20, memory: 30 }
    ],
    dockerContainers: [],
    system: { uptime: 400, hostname: 'fixture', platform: 'Linux', kernel: '6.8' },
    sources: { core: {}, disk: {}, docker: {} }
  })
  const mount = async () => {
    app = createApp({ render: () => h(ServerMonitorPanel, props) })
    app.mount(host)
    await flush()
  }
  const click = (label: string) =>
    (host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'))
    vi.clearAllMocks()
    props.active = true
    props.sessionId = 'session-a'
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    localStorage.clear()
    api.start.mockResolvedValue({ success: true })
    api.stop.mockResolvedValue({ success: true })
    api.updateConfig.mockResolvedValue({ success: true })
    api.onMetrics.mockImplementation((callback) => {
      send = callback
      return vi.fn()
    })
    api.onError.mockReturnValue(vi.fn())
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

  it('starts at 1 second and applies/persists the selected interval', async () => {
    await mount()
    expect(api.start).toHaveBeenCalledWith('session-a', { interval: 1000 })
    const select = host.querySelector('[aria-label="监控刷新间隔"]') as HTMLSelectElement
    select.value = '5000'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(api.updateConfig).toHaveBeenCalledWith('session-a', { interval: 5000 })
    expect(localStorage.getItem('mshell-monitor-interval')).toBe('5000')
  })
  it('preserves the last frame on pause and ignores subsequent updates', async () => {
    await mount()
    send('session-a', frame())
    await flush()
    click('暂停监控')
    await flush()
    send('session-a', frame(70))
    await flush()
    expect(host.textContent).toContain('已暂停')
    expect(host.textContent).toContain('25.0%')
    expect(host.textContent).not.toContain('70.0%')
    expect(api.stop).toHaveBeenCalledWith('session-a')
  })
  it('shows stale core data even when a slow source sends a newer update', async () => {
    await mount()
    const value = frame()
    send('session-a', value)
    await flush()
    await vi.advanceTimersByTimeAsync(7000)
    send('session-a', {
      ...value,
      sources: { ...value.sources, disk: { timestamp: new Date().toISOString() } }
    })
    await flush()
    expect(host.textContent).toContain('数据延迟')
    expect(host.textContent).toContain('7 秒前更新')
  })
  it('pauses when hidden and resumes only when the user still wants monitoring', async () => {
    await mount()
    props.active = false
    await flush()
    expect(api.stop).toHaveBeenCalledTimes(1)
    props.active = true
    await flush()
    expect(api.start).toHaveBeenCalledTimes(2)
    click('暂停监控')
    await flush()
    props.active = false
    await flush()
    props.active = true
    await flush()
    expect(api.start).toHaveBeenCalledTimes(2)
  })
  it('stops a late successful start response after the component was unmounted', async () => {
    let resolve!: (value: { success: boolean }) => void
    api.start.mockImplementationOnce(() => new Promise((done) => (resolve = done)))
    await mount()
    app!.unmount()
    app = undefined
    resolve({ success: true })
    await flush()
    expect(api.stop).toHaveBeenCalledWith('session-a')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('finishes the previous panel cleanup before restarting the same session', async () => {
    let resolve!: (value: { success: boolean }) => void
    const operations: string[] = []
    api.start.mockImplementationOnce(() => {
      operations.push('old start')
      return new Promise((done) => (resolve = done))
    })
    await mount()
    app!.unmount()
    api.stop.mockImplementationOnce(async () => {
      operations.push('old stop')
      return { success: true }
    })
    api.start.mockImplementationOnce(async () => {
      operations.push('new start')
      return { success: true }
    })
    await mount()
    expect(operations).toEqual(['old start'])
    resolve({ success: true })
    await flush()
    expect(operations).toEqual(['old start', 'old stop', 'new start'])
    expect(host.querySelector('[aria-label="暂停监控"]')).not.toBeNull()
  })
  it('filters by process name or PID and sorts by current interval CPU or memory', async () => {
    await mount()
    send('session-a', frame())
    await flush()
    expect(host.querySelector('tbody tr')?.textContent).toContain('worker')
    const sort = host.querySelector('[aria-label="进程排序"]') as HTMLSelectElement
    sort.value = 'memory'
    sort.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect(host.querySelector('tbody tr')?.textContent).toContain('database')
    const query = host.querySelector('[aria-label="筛选监控进程"]') as HTMLInputElement
    query.value = '10'
    query.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1)
    expect(host.querySelector('tbody tr')?.textContent).toContain('worker')
  })
  it('reports startup errors and ignores other sessions', async () => {
    api.start.mockResolvedValueOnce({ success: false, error: 'Connection not active' })
    await mount()
    send('other-session', { ...frame(), sessionId: 'other-session' })
    await flush()
    expect(host.textContent).toContain('Connection not active')
    expect(host.querySelector('.monitor-content')).toBeNull()
    expect(host.querySelector('[aria-label="开始监控"]')).not.toBeNull()
  })
})
