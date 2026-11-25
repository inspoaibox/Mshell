import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, isProxy, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessage } from 'element-plus'
import { useAppStore } from '@/stores/app'
import SessionList from './SessionList.vue'

describe('session group context menu', () => {
  let app: App
  let host: HTMLElement
  let store: ReturnType<typeof useAppStore>
  const showContextMenu = vi.fn()
  const updateGroupOrder = vi.fn()
  const updateOrder = vi.fn()
  const updateSession = vi.fn()
  const headers = () => Array.from(host.querySelectorAll('.group-header'))
  const openMenu = async (index: number, action?: string) => {
    showContextMenu.mockResolvedValueOnce(action)
    headers()[index].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await vi.waitFor(() => expect(showContextMenu).toHaveBeenCalled())
    await nextTick()
    return showContextMenu.mock.calls.at(-1)![0] as any[]
  }
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.stubGlobal('electronAPI', { dialog: { showContextMenu }, session: { updateGroupOrder, updateOrder, update: updateSession } })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const pinia = createPinia()
    setActivePinia(pinia)
    store = useAppStore()
    store.groups = [
      { id: 'p', name: 'Pinned', sessions: [], isPinned: true, sortOrder: 0 },
      { id: 'a', name: 'Alpha', sessions: [], sortOrder: 1 },
      { id: 'b', name: 'Beta', sessions: [], sortOrder: 2 }
    ]
    host = document.createElement('div')
    document.body.append(host)
    app = createApp(SessionList)
    app.use(pinia).use(ElementPlus).mount(host)
    await nextTick()
  })
  afterEach(() => {
    app.unmount()
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('offers pin/unpin and disables movement at each tier boundary', async () => {
    const pinned = await openMenu(0)
    expect(pinned).toEqual(expect.arrayContaining([
      { label: '取消置顶', action: 'unpin' },
      { label: '上移', action: 'up', enabled: false },
      { label: '下移', action: 'down', enabled: false },
      { label: '重命名', action: 'rename' },
      { label: '删除', action: 'delete' }
    ]))
    const first = await openMenu(1)
    expect(first[0]).toEqual({ label: '置顶', action: 'pin' })
    expect(first.find(item => item.action === 'up').enabled).toBe(false)
    expect(first.find(item => item.action === 'down').enabled).toBe(true)
    const last = await openMenu(2)
    expect(last.find(item => item.action === 'up').enabled).toBe(true)
    expect(last.find(item => item.action === 'down').enabled).toBe(false)
  })
  it.each(['pin', 'unpin', 'up', 'down'] as const)('sends %s and immediately renders the saved ordering', async action => {
    const saved = [
      { ...store.groups[2], isPinned: true, sortOrder: 0 },
      { ...store.groups[0], sortOrder: 1 },
      { ...store.groups[1], sortOrder: 2 }
    ]
    updateGroupOrder.mockResolvedValueOnce({ success: true, data: saved })
    await openMenu(2, action)
    await vi.waitFor(() => expect(headers()[0].textContent).toContain('Beta'))
    expect(updateGroupOrder).toHaveBeenCalledWith('b', action)
    expect(headers()[0].querySelector('[aria-label="已置顶"]')).not.toBeNull()
  })
  it('keeps the visible order and reports a rejected save', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: vi.fn() }))
    updateGroupOrder.mockResolvedValueOnce({ success: false, error: '磁盘写入失败' })
    await openMenu(2, 'pin')
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('磁盘写入失败'))
    expect(headers()[0].textContent).toContain('Pinned')
    expect(headers()[2].querySelector('.group-pin')).toBeNull()
  })
  it('does nothing when the menu is dismissed', async () => {
    await openMenu(1)
    expect(updateGroupOrder).not.toHaveBeenCalled()
  })

  const seedSessions = async (group?: string) => {
    store.sessions = ['One', 'Two', 'Three'].map((name, index) => ({
      id: name, name, group, sortOrder: index, host: '127.0.0.1', port: 22,
      username: 'root', authType: 'password', createdAt: new Date(), updatedAt: new Date()
    }))
    if (group) store.groups.find(item => item.id === group)!.sessions = store.sessions.map(item => item.id)
    await nextTick()
  }
  const cards = () => Array.from(host.querySelectorAll('.session-card'))
  const names = () => cards().map(card => card.querySelector('.session-name')!.textContent)
  const sessionMenu = async (name: string, action?: string) => {
    showContextMenu.mockResolvedValueOnce(action)
    cards().find(card => card.querySelector('.session-name')!.textContent === name)!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
    await nextTick()
    return showContextMenu.mock.calls.at(-1)![0] as any[]
  }

  it.each(['a', undefined])('pins and unpins a session in group %s with immediate feedback', async group => {
    await seedSessions(group)
    updateOrder.mockResolvedValueOnce({ success: true, data: store.sessions.map(session =>
      session.id === 'Three' ? { ...session, isPinned: true } : { ...session }) })
    const menu = await sessionMenu('Three', 'pin')
    expect(menu).toContainEqual({ label: '置顶', action: 'pin' })
    await vi.waitFor(() => expect(names()[0]).toBe('Three'))
    expect(updateOrder).toHaveBeenCalledWith('Three', { type: 'pin' })
    expect(cards()[0].querySelector('[aria-label="会话已置顶"]')).not.toBeNull()
    updateOrder.mockResolvedValueOnce({ success: true, data: store.sessions.map(session =>
      ({ ...session, isPinned: false })) })
    const pinnedMenu = await sessionMenu('Three', 'unpin')
    expect(pinnedMenu).toContainEqual({ label: '取消置顶', action: 'unpin' })
    await vi.waitFor(() => expect(names()).toEqual(['One', 'Two', 'Three']))
  })

  it('reports a failed session pin and keeps the old position', async () => {
    await seedSessions()
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => ({ close: vi.fn() }))
    updateOrder.mockResolvedValueOnce({ success: false, error: '无法保存置顶状态' })
    await sessionMenu('Three', 'pin')
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('无法保存置顶状态'))
    expect(names()).toEqual(['One', 'Two', 'Three'])
    expect(host.querySelector('.session-pin')).toBeNull()
  })

  it('deep-clones nested session settings before copying through IPC', async () => {
    await seedSessions()
    store.sessions[0] = {
      ...store.sessions[0],
      terminalBackground: {
        enabled: true,
        source: 'local',
        image: 'C:/background.png',
        opacity: 42,
        fit: 'cover'
      },
      proxyJump: {
        enabled: true,
        host: 'jump.example.com',
        port: 22,
        username: 'root',
        authType: 'privateKey',
        privateKeyPath: 'C:/keys/jump.pem',
        nextJump: {
          enabled: false,
          host: 'nested.example.com',
          port: 22,
          username: 'root',
          authType: 'password'
        }
      }
    }
    await nextTick()

    const createSession = vi.spyOn(store, 'createSession').mockResolvedValue({ id: 'copy' } as any)
    await sessionMenu('One', 'copy')

    await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
    const [copied] = createSession.mock.calls[0]

    expect(isProxy(copied)).toBe(false)
    expect(isProxy(copied.terminalBackground)).toBe(false)
    expect(isProxy(copied.proxyJump)).toBe(false)
    expect(isProxy(copied.proxyJump?.nextJump)).toBe(false)
    expect(copied).toMatchObject({
      name: 'One (副本)',
      terminalBackground: store.sessions[0].terminalBackground,
      proxyJump: store.sessions[0].proxyJump
    })
    expect(copied).not.toHaveProperty('id')
    expect(copied).not.toHaveProperty('createdAt')
    expect(copied).not.toHaveProperty('updatedAt')
  })

  it.each(['a', undefined])('uses stable IDs for dragging in group %s and does not also move groups', async group => {
    await seedSessions(group)
    updateOrder.mockResolvedValueOnce({ success: true, data: store.sessions.map(session =>
      ({ ...session, sortOrder: ['Three', 'One', 'Two'].indexOf(session.id) })) })
    const rows = Array.from(host.querySelectorAll('.draggable-session-item'))
    rows[2].dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }))
    rows[0].dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(updateOrder).toHaveBeenCalledWith('Three', { type: 'move', targetId: 'One' }))
    await vi.waitFor(() => expect(names()).toEqual(['Three', 'One', 'Two']))
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('keeps saved ordering when search hides other sessions', async () => {
    await seedSessions()
    store.sessions[0].sortOrder = 10
    store.sessions[2].isPinned = true
    store.sessions.forEach(session => { session.username = 'user' })
    await nextTick()
    expect(names()).toEqual(['Three', 'Two', 'One'])
    const input = host.querySelector('input[placeholder="搜索会话..."]') as HTMLInputElement
    input.value = 'o'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(names()).toEqual(['Two', 'One'])
  })
})
