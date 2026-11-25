import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createApp, h, nextTick, ref, reactive, type App } from 'vue'
import { TerminalInputState } from '@/utils/terminal-input-state'
const mocks = vi.hoisted(() => ({
  instance: null as any,
  line: 'root@host:/srv# ',
  store: { activeTab: 'ssh', activeView: 'sessions' }
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.store }))
vi.mock('@/stores/ai', () => ({
  useAIStore: () => ({ loadConfig: async () => {}, hasDefaultModel: false })
}))
vi.mock('@/utils/terminal-search', () => ({
  TerminalSearchController: class {
    dispose() {}
    clear() {}
  }
}))
vi.mock('@/utils/terminal-manager', () => ({
  isSensitiveInputPrompt: (text: string) => text.includes('Password:'),
  terminalManager: {
    get: () => mocks.instance,
    getOrCreate: () => mocks.instance,
    setRendererMode: () => {},
    setSearchActive: () => {},
    fit: () => {},
    reveal: () => {},
    setInputCallback: (_id: string, fn: any) => {
      mocks.instance.inputCallback = fn
    },
    setCursorCallback: (_id: string, fn: any) => {
      mocks.instance.cursorCallback = fn
    },
    setDataCallback: (_id: string, fn: any) => {
      mocks.instance.dataCallback = fn
    },
    setOutputCallback: (_id: string, fn: any) => {
      mocks.instance.outputCallback = fn
    }
  }
}))
import TerminalView from './TerminalView.vue'

describe('terminal intelligence boundaries', () => {
  let app: App | undefined, host: HTMLElement, send: (data: string) => void
  const view = ref<any>(),
    input = vi.fn(),
    write = vi.fn(),
    add = vi.fn()
  const flush = async () => {
    await Promise.resolve()
    await nextTick()
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    mocks.line = 'root@host:/srv# '
    mocks.store = reactive({ activeTab: 'ssh', activeView: 'sessions' })
    mocks.instance = {
      inputState: new TerminalInputState(),
      echoEnabled: true,
      bracketedPasteEnabled: true,
      handlersRegistered: false,
      terminal: {
        options: {},
        cols: 80,
        rows: 24,
        focus: vi.fn(),
        buffer: {
          active: {
            type: 'normal',
            baseY: 0,
            cursorX: 0,
            cursorY: 0,
            getLine: () => ({ translateToString: () => mocks.line })
          }
        },
        onData: vi.fn((fn) => {
          send = fn
        }),
        onResize: vi.fn()
      }
    }
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { ssh: { write, resize: vi.fn() }, commandHistory: { add }, connectionStats: {} }
    })
    host = document.createElement('div')
    document.body.append(host)
  })
  afterEach(() => {
    app?.unmount()
    app = undefined
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const mount = async () => {
    app = createApp({
      render: () =>
        h(TerminalView, {
          ref: view,
          connectionId: 'ssh',
          intelligence: { commandExplain: true, aiCommandSuggest: true },
          onInput: input
        })
    })
    app.mount(host)
    await flush()
  }
  it('tracks edits before the cursor, hides suggestions there, and records the actual submitted draft', async () => {
    await mount()
    send('abc')
    send('\x1b[D')
    send('X')
    expect(view.value.getCurrentCommand()).toBe('abXc')
    expect(input).toHaveBeenLastCalledWith('')
    send('\x05')
    expect(input).toHaveBeenLastCalledWith('abXc')
    send('\r')
    await flush()
    expect(add.mock.calls[0][0].command).toBe('abXc')
  })
  it('forwards editor keystrokes without offering suggestions or recording editor contents', async () => {
    await mount()
    mocks.instance.terminal.buffer.active.type = 'alternate'
    send('?rm')
    send('\r')
    await flush()
    expect(input.mock.calls.every(([line]) => line === '')).toBe(true)
    expect(add).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith('ssh', '\r', false)
    expect(view.value.replaceIntelligenceInput('ls', '')).toBe(false)
  })
  it('clears intelligence in password prompts without recording sensitive input', async () => {
    await mount()
    send('ls')
    mocks.line = 'Password: '
    send('secret')
    send('\r')
    expect(view.value.getCurrentCommand()).toBe('')
    expect(add).not.toHaveBeenCalled()
    expect(write).toHaveBeenLastCalledWith('ssh', '\r', true)
  })
  it('consumes explanation Enter and clears the query without submitting it', async () => {
    await mount()
    send('?ls -la')
    write.mockClear()
    send('\r')
    await flush()
    expect(write).toHaveBeenCalledWith('ssh', '\x15\x0b')
    expect(write.mock.calls.some((call) => call[1].includes('\r'))).toBe(false)
    expect(add).not.toHaveBeenCalled()
    expect(view.value.getCurrentCommand()).toBe('')
  })
  it('blocks query submission and executes an accepted command only once', async () => {
    await mount()
    send('#查看目录')
    write.mockClear()
    send('\r')
    expect(write).not.toHaveBeenCalled()
    expect(view.value.replaceIntelligenceInput('ls -lah', '#查看目录', true)).toBe(true)
    await flush()
    expect(write.mock.calls[0][1]).toBe('\x15\x0b\x1b[200~ls -lah\x1b[201~\r')
    expect(add).toHaveBeenCalledTimes(1)
    expect(view.value.replaceIntelligenceInput('ls -lah', '#查看目录', true)).toBe(false)
  })
  it('rejects stale suggestions, hidden views, and multiline insertions', async () => {
    await mount()
    send('ls')
    send('x')
    write.mockClear()
    expect(view.value.replaceIntelligenceInput('ls -la', 'ls')).toBe(false)
    expect(view.value.replaceIntelligenceInput('ls\nwhoami', 'lsx')).toBe(false)
    mocks.store.activeView = 'settings'
    expect(view.value.replaceIntelligenceInput('ls -la', 'lsx')).toBe(false)
    expect(write).not.toHaveBeenCalled()
  })
  it('rebinds the persistent terminal to the newly mounted view', async () => {
    await mount()
    send('abc')
    app!.unmount()
    app = undefined
    input.mockClear()
    await mount()
    send('d')
    expect(view.value.getCurrentCommand()).toBe('abcd')
    expect(input).toHaveBeenLastCalledWith('abcd')
    expect(mocks.instance.terminal.onData).toHaveBeenCalledTimes(1)
  })
})
