import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import ElementPlus from 'element-plus'
import Fail2BanPanel from './Fail2BanPanel.vue'
import type { Fail2BanOverview } from '@/types/fail2ban'

const overview = (overrides: Partial<Fail2BanOverview> = {}): Fail2BanOverview => ({
  installed: false,
  version: '',
  serviceStatus: 'not-installed',
  running: false,
  enabled: false,
  environment: {
    osId: 'debian',
    osName: 'Debian GNU/Linux 13',
    versionId: '13',
    packageManager: 'apt',
    needsPrivilege: false,
    canSudo: true
  },
  jails: [],
  totalCurrentlyBanned: 0,
  totalBanned: 0,
  totalFailed: 0,
  warnings: ['当前服务器未安装 Fail2Ban'],
  capturedAt: Date.now(),
  ...overrides
})

describe('Fail2BanPanel', () => {
  let app: App
  let host: HTMLElement
  const getOverview = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    getOverview.mockResolvedValue({ success: true, data: overview() })
    vi.stubGlobal('electronAPI', { fail2ban: { getOverview } })
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(Fail2BanPanel, { connectionId: 'connection-1' })
    app.use(ElementPlus).mount(host)
  })

  afterEach(() => {
    app.unmount()
    host.remove()
    vi.unstubAllGlobals()
  })

  it('detects the server environment and presents one-click installation', async () => {
    await vi.waitFor(() => expect(getOverview).toHaveBeenCalledWith('connection-1'))
    await nextTick()

    expect(host.textContent).toContain('Debian GNU/Linux 13')
    expect(host.textContent).toContain('当前服务器未安装 Fail2Ban')
    expect(host.textContent).toContain('一键安装')
    expect(host.querySelector('.jail-search')).not.toBeNull()
  })

  it('renders jail statistics and searchable banned IP details', async () => {
    getOverview.mockResolvedValueOnce({
      success: true,
      data: overview({
        installed: true,
        running: true,
        version: 'Fail2Ban v1.1.0',
        serviceStatus: 'active',
        jails: [
          {
            name: 'sshd',
            currentlyFailed: 2,
            totalFailed: 10,
            currentlyBanned: 1,
            totalBanned: 4,
            bannedIps: ['203.0.113.8']
          }
        ],
        totalCurrentlyBanned: 1,
        totalBanned: 4,
        totalFailed: 10,
        warnings: []
      })
    })
    app.unmount()
    host.innerHTML = ''
    app = createApp(Fail2BanPanel, { connectionId: 'connection-2' })
    app.use(ElementPlus).mount(host)
    await vi.waitFor(() => expect(host.textContent).toContain('sshd'))

    expect(host.textContent).toContain('203.0.113.8')
    expect(host.textContent).toContain('1 个封禁')
  })
})
