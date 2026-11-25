import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, ref, type App } from 'vue'
import AICommandSuggest from './AICommandSuggest.vue'
import CommandExplain from './CommandExplain.vue'

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
describe('AI command UI request isolation', () => {
  let app: App | undefined, host: HTMLElement
  const request = vi.fn()
  const props = reactive({
    visible: true,
    query: '查看文件',
    command: 'ls -la',
    position: { x: 100, y: 100 },
    sessionId: 'a',
    cwd: '/srv/app'
  })
  const panel = ref<any>()
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    Object.assign(props, {
      visible: true,
      query: '查看文件',
      command: 'ls -la',
      sessionId: 'a',
      cwd: '/srv/app'
    })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { ai: { request } } })
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
  const mount = async (component: any) => {
    app = createApp({ render: () => h(component, { ...props, ref: panel }) })
    app.component(
      'el-button',
      defineComponent({ setup: (_, ctx) => () => h('button', ctx.attrs, ctx.slots.default?.()) })
    )
    app.mount(host)
    await flush()
  }
  const explain = () =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('AI 解释'))!.click()

  it('invalidates the old suggestion immediately during the debounce window', async () => {
    request.mockResolvedValue({ success: true, data: '{"command":"ls -lah"}' })
    await mount(AICommandSuggest)
    await vi.advanceTimersByTimeAsync(800)
    await flush()
    expect(panel.value.getSuggestion('查看文件')).toBe('ls -lah')
    props.query = '查看磁盘'
    await flush()
    expect(panel.value.getSuggestion('查看磁盘')).toBe('')
    expect(panel.value.getSuggestion('查看文件')).toBe('')
    expect(panel.value.isLoading()).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('ignores errors and finally blocks belonging to older requests', async () => {
    const pending: Array<{ resolve: Function; reject: Function }> = []
    request.mockImplementation(
      () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
    )
    await mount(AICommandSuggest)
    await vi.advanceTimersByTimeAsync(800)
    props.query = '查看磁盘'
    await flush()
    await vi.advanceTimersByTimeAsync(800)
    pending[0].resolve({ success: true, data: '{"command":"ls"}' })
    await flush()
    expect(panel.value.isLoading()).toBe(true)
    pending[1].resolve({ success: true, data: '{"command":"df -h"}' })
    await flush()
    expect(panel.value.getSuggestion()).toBe('df -h')
    props.query = 'old'
    await flush()
    await vi.advanceTimersByTimeAsync(800)
    props.query = 'new'
    await flush()
    await vi.advanceTimersByTimeAsync(800)
    pending[3].resolve({ success: true, data: '{"command":"pwd"}' })
    await flush()
    pending[2].reject(new Error('old failure'))
    await flush()
    expect(panel.value.getSuggestion()).toBe('pwd')
    expect(host.textContent).not.toContain('old failure')
  })
  it('rejects prose/multiline output and retries without changing the query', async () => {
    request
      .mockResolvedValueOnce({ success: true, data: '中文说明\n# comment' })
      .mockResolvedValueOnce({ success: true, data: '{"command":"pwd"}' })
    await mount(AICommandSuggest)
    await vi.advanceTimersByTimeAsync(800)
    await flush()
    expect(panel.value.getSuggestion()).toBe('')
    host.querySelector('button')!.click()
    await vi.advanceTimersByTimeAsync(800)
    await flush()
    expect(panel.value.getSuggestion()).toBe('pwd')
    expect(request.mock.calls[0][0]).toBe('chat')
  })
  it('cancels pending debounce on hide and does not reuse a result across sessions', async () => {
    request.mockResolvedValue({ success: true, data: '{"command":"pwd"}' })
    await mount(AICommandSuggest)
    props.visible = false
    await flush()
    await vi.advanceTimersByTimeAsync(800)
    expect(request).not.toHaveBeenCalled()
    props.visible = true
    await flush()
    await vi.advanceTimersByTimeAsync(800)
    props.sessionId = 'b'
    await flush()
    expect(panel.value.getSuggestion()).toBe('')
  })
  it('shows detailed AI results above local explanations and renders HTML as text', async () => {
    request.mockResolvedValue({
      success: true,
      data: '**AI详细说明** <img src=x onerror="alert(1)"> `ls`'
    })
    await mount(CommandExplain)
    expect(host.textContent).toContain('显示所有文件')
    explain()
    await flush()
    expect(host.querySelector('.ai-explanation')?.textContent).toContain('AI详细说明')
    expect(host.querySelector('.ai-explanation img')).toBeNull()
    expect(host.querySelector('.ai-explanation strong')?.textContent).toBe('AI详细说明')
    expect(request.mock.calls[0][0]).toBe('chat')
  })
  it('preserves local help on AI error and supports retry and reopening the same command', async () => {
    request
      .mockResolvedValueOnce({ success: false, error: 'network failed' })
      .mockResolvedValueOnce({ success: true, data: 'AI success' })
    await mount(CommandExplain)
    explain()
    await flush()
    expect(host.textContent).toContain('network failed')
    expect(host.textContent).toContain('列出目录内容')
    explain()
    await flush()
    expect(host.textContent).toContain('AI success')
    props.visible = false
    await flush()
    props.visible = true
    await flush()
    expect(host.textContent).toContain('列出目录内容')
    expect(host.textContent).not.toContain('AI success')
  })
})
