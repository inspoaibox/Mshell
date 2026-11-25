import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
const mocks = vi.hoisted(() => ({
  store: {} as any,
  terminal: {} as any,
  message: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  confirm: vi.fn(async () => {})
}))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.store }))
vi.mock('@/utils/terminal-manager', () => ({ terminalManager: mocks.terminal }))
vi.mock('element-plus', () => ({
  ElMessage: mocks.message,
  ElMessageBox: { confirm: mocks.confirm }
}))
import Panel from './LazyScriptPanel.vue'
const flush = async () => {
  for (let i = 0; i < 18; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const box = defineComponent({ setup: (_, ctx) => () => h('div', ctx.attrs, ctx.slots.default?.()) })
const button = defineComponent({
  setup: (_, ctx) => () => h('button', ctx.attrs, ctx.slots.default?.())
})
const dialog = defineComponent({
  props: ['modelValue'],
  setup: (props, ctx) => () =>
    props.modelValue
      ? h('div', { 'data-dialog': '' }, [ctx.slots.default?.(), ctx.slots.footer?.()])
      : null
})
describe('lazy script panel execution wiring', () => {
  let app: App, host: HTMLElement, output: (data: string) => void, changed: () => void
  let records: any[]
  const api = {
    getAll: vi.fn(),
    incrementUsage: vi.fn(),
    onChanged: vi.fn(),
    deploy: vi.fn(),
    cancelDeployment: vi.fn(),
    getConnection: vi.fn(),
    write: vi.fn(),
    protectInput: vi.fn(),
    onClose: vi.fn()
  }
  const make = (id: string, type = 'shell', mode = 'execute') => ({
    id,
    name: id,
    fileName: id + '.sh',
    type,
    runMode: mode,
    riskLevel: 'low',
    content: 'printf "%s" "{{value}}"',
    variables: [{ name: 'value', label: 'Value', type: 'text', defaultValue: id }],
    category: 'tests',
    tags: [],
    usageCount: 0,
    updatedAt: '2026-10-16',
    description: ''
  })
  const mount = async () => {
    app = createApp(Panel)
    for (const name of [
      'el-tooltip',
      'el-scrollbar',
      'el-tag',
      'el-empty',
      'el-form',
      'el-form-item',
      'el-select',
      'el-option',
      'el-option-group',
      'el-checkbox-group',
      'el-checkbox',
      'el-radio',
      'el-radio-group',
      'el-icon'
    ])
      app.component(name, box)
    app.component('el-button', button)
    app.component('el-dialog', dialog)
    app.component(
      'el-input',
      defineComponent({
        props: ['modelValue'],
        emits: ['update:modelValue'],
        setup:
          (props, { emit }) =>
          () =>
            h('input', {
              value: props.modelValue,
              onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)
            })
      })
    )
    app.component('el-input-number', box)
    app.mount(host)
    await flush()
  }
  const click = (text: string) => {
    const b = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)
    expect(b, text).toBeTruthy()
    b!.click()
  }
  const select = (name: string) => {
    const b = [...host.querySelectorAll<HTMLButtonElement>('.script-item')].find(
      (b) => b.querySelector('.script-name')?.textContent === name
    )
    expect(b).toBeTruthy()
    b!.click()
  }
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.confirm.mockResolvedValue(undefined)
    records = [make('A'), make('B')]
    mocks.store = reactive({
      tabs: [
        {
          id: 'session',
          name: 'test',
          session: { type: 'ssh', username: 'root', host: 'fixture', port: 22 }
        }
      ],
      activeTab: 'session',
      activeView: 'lazy-scripts',
      sessions: [],
      setActiveView: vi.fn(),
      currentSession: null
    })
    Object.assign(mocks.terminal, {
      get: () => ({
        echoEnabled: true,
        bracketedPasteEnabled: true,
        terminal: {
          buffer: {
            active: {
              type: 'normal',
              baseY: 0,
              cursorY: 0,
              getLine: () => ({ translateToString: () => 'root# ' })
            }
          }
        }
      }),
      subscribeOutput: (_: string, callback: typeof output) => {
        output = callback
        return vi.fn()
      },
      requestScrollToBottom: vi.fn(),
      focus: vi.fn()
    })
    api.getAll.mockImplementation(async () => ({ success: true, data: structuredClone(records) }))
    api.incrementUsage.mockResolvedValue({ success: true })
    api.onChanged.mockImplementation((callback) => {
      changed = callback
      return vi.fn()
    })
    api.getConnection.mockResolvedValue({ status: 'connected' })
    api.deploy.mockImplementation(
      async (_id: string, _token: string, fileName: string, _content: string, copyTo?: string) => ({
        success: true,
        data: {
          path: '/home/john/.mshell/scripts/' + fileName,
          ...(copyTo ? { savedPath: '/home/john/.mshell/scripts/' + copyTo } : {})
        }
      })
    )
    api.onClose.mockReturnValue(vi.fn())
    api.protectInput.mockResolvedValue(undefined)
    api.write.mockImplementation((_id: string, command: string) => {
      const token = command.match(/mshell-script-done;([a-f0-9-]+);/)?.[1]
      if (token) output(`\x1b]777;mshell-script-done;${token};0\x07`)
    })
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { lazyScript: api, ssh: api }
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) }
    })
    host = document.createElement('div')
    document.body.append(host)
  })
  afterEach(async () => {
    app?.unmount()
    await flush()
    host.remove()
    vi.useRealTimers()
  })
  it('runs the captured A snapshot even if the user selects B while deployment is pending', async () => {
    let release!: (value: any) => void
    api.deploy.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    await mount()
    click('运行脚本')
    await flush()
    click('确认运行脚本')
    await flush()
    select('B')
    await flush()
    release({
      success: true,
      data: {
        path: '/home/john/.mshell/scripts/' + api.deploy.mock.calls[0][2],
        savedPath: '/home/john/.mshell/scripts/A.sh'
      }
    })
    await flush()
    expect(api.deploy.mock.calls[0][3]).toContain("__mshell_value_value='A'")
    expect(api.write.mock.calls[0][1]).toContain('.run-')
    expect(api.write.mock.calls[0][1]).toContain("bash '/home/john/.mshell/scripts/.run-")
    expect(api.write.mock.calls[0][1]).not.toContain('~/.mshell')
    expect(api.write.mock.calls[0][1]).not.toContain('B.sh')
    expect(api.incrementUsage).toHaveBeenCalledWith('A')
  })
  it('uses the uploaded path in a root terminal and displays the saved script location', async () => {
    await mount()
    click('运行脚本')
    await flush()
    click('确认运行脚本')
    await flush()
    const command = api.write.mock.calls[0][1]
    const path = '/home/john/.mshell/scripts/' + api.deploy.mock.calls[0][2]
    expect(command).toContain("bash '" + path + "'")
    expect(command).toContain("rm -f -- '" + path + "'")
    expect(command).not.toContain('/root/')
    expect(host.textContent).toContain('/home/john/.mshell/scripts/A.sh')
  })
  it.each([
    undefined,
    { path: '~/.mshell/scripts/A.sh' },
    { path: '/home/john/.mshell/scripts/wrong.sh' }
  ])('never guesses a path when deployment returns invalid metadata', async (data) => {
    api.deploy.mockResolvedValueOnce({ success: true, data })
    await mount()
    click('运行脚本')
    await flush()
    click('确认运行脚本')
    await flush()
    expect(api.write).not.toHaveBeenCalled()
    expect(api.incrementUsage).not.toHaveBeenCalled()
    expect(mocks.message.error).toHaveBeenCalled()
  })
  it('never executes after deployment fails or a connection is disconnected', async () => {
    api.deploy.mockResolvedValueOnce({ success: false, error: 'disk full' })
    await mount()
    click('运行脚本')
    await flush()
    click('确认运行脚本')
    await flush()
    expect(api.write).not.toHaveBeenCalled()
    expect(mocks.message.error).toHaveBeenCalledWith('disk full')
    api.getConnection.mockResolvedValueOnce({ status: 'disconnected' })
    click('运行脚本')
    await flush()
    click('确认运行脚本')
    await flush()
    expect(api.deploy).toHaveBeenCalledTimes(1)
  })
  it('implements default copy and keeps manual steps out of the execution path', async () => {
    records = [
      make('A', 'shell', 'copy'),
      { ...make('Steps', 'steps'), content: '检查状态\n确认服务' }
    ]
    await mount()
    click('默认：复制运行命令')
    await flush()
    expect(navigator.clipboard.writeText).toHaveBeenCalled()
    expect(api.deploy).not.toHaveBeenCalled()
    select('Steps')
    await flush()
    expect(host.textContent).toContain('人工操作清单')
    expect(
      [...host.querySelectorAll('button')].some((b) => b.textContent?.trim() === '运行脚本')
    ).toBe(false)
  })
  it('masks legacy password defaults and refreshes external library changes', async () => {
    records = [
      {
        ...make('A'),
        content: 'PASS="{{password}}"',
        variables: [{ name: 'password', type: 'password', defaultValue: 'old-secret' }]
      }
    ]
    await mount()
    expect(host.textContent).not.toContain('old-secret')
    expect(host.textContent).toContain('运行时在终端隐藏输入')
    records.push(make('Imported'))
    changed()
    await new Promise((resolve) => setTimeout(resolve, 200))
    await flush()
    expect(host.textContent).toContain('Imported')
  })
})
