import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive, type App } from 'vue'
import { firewallOverview, zoneLines } from '@/utils/__tests__/firewall-fixtures'
const messages = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  confirm: vi.fn(async () => {})
}))
vi.mock('element-plus', () => ({
  ElMessage: messages,
  ElMessageBox: { confirm: messages.confirm }
}))
import FirewallPanel from './FirewallPanel.vue'
const flush = async () => {
  for (let i = 0; i < 16; i++) {
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
      ? h('section', { 'data-dialog': '' }, [ctx.slots.default?.(), ctx.slots.footer?.()])
      : null
})
describe('firewall UI state and feedback', () => {
  let app: App, host: HTMLElement, closed: (id: string) => void, reconnected: (id: string) => void
  const props = reactive({ connectionId: 'a', active: true })
  const api = { inspect: vi.fn(), apply: vi.fn(), confirm: vi.fn(), onChanged: vi.fn() }
  const click = (label: string) => {
    const target = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
    expect(target, label).toBeTruthy()
    target!.click()
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'))
    vi.resetAllMocks()
    messages.confirm.mockResolvedValue(undefined)
    props.connectionId = 'a'
    props.active = true
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    api.inspect.mockResolvedValue({
      success: true,
      data: firewallOverview([...zoneLines('runtime'), ...zoneLines('permanent')], 'firewalld')
    })
    api.onChanged.mockReturnValue(vi.fn())
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        firewall: api,
        ssh: {
          onClose: (fn: any) => {
            closed = fn
            return vi.fn()
          },
          onReconnected: (fn: any) => {
            reconnected = fn
            return vi.fn()
          }
        }
      }
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
  const mount = async () => {
    app = createApp({ render: () => h(FirewallPanel, props) })
    app.directive('loading', {})
    for (const name of [
      'el-tooltip',
      'el-tabs',
      'el-tab-pane',
      'el-tag',
      'el-icon',
      'el-collapse',
      'el-collapse-item',
      'el-radio-group',
      'el-radio-button',
      'el-switch'
    ])
      app.component(name, box)
    app.component('el-button', button)
    app.component('el-dialog', dialog)
    app.component(
      'el-alert',
      defineComponent({
        props: ['title'],
        setup: (p, ctx) => () => h('aside', { role: 'alert' }, [p.title, ctx.slots.default?.()])
      })
    )
    app.component(
      'el-select',
      defineComponent({
        props: ['modelValue'],
        emits: ['update:modelValue', 'change'],
        setup:
          (p, { attrs, emit, slots }) =>
          () =>
            h(
              'select',
              {
                ...attrs,
                value: p.modelValue,
                onChange: (e: Event) => {
                  const value = (e.target as HTMLSelectElement).value
                  emit('update:modelValue', value)
                  emit('change', value)
                }
              },
              slots.default?.()
            )
      })
    )
    app.component(
      'el-option',
      defineComponent({
        props: ['value', 'label'],
        setup: (p) => () => h('option', { value: p.value }, p.label)
      })
    )
    app.component(
      'el-input',
      defineComponent({
        props: ['modelValue'],
        emits: ['update:modelValue', 'input'],
        setup:
          (p, { attrs, emit }) =>
          () =>
            h('input', {
              ...attrs,
              value: p.modelValue,
              onInput: (e: Event) => {
                const value = (e.target as HTMLInputElement).value
                emit('update:modelValue', value)
                emit('input', value)
              }
            })
      })
    )
    app.mount(host)
    await flush()
  }
  it('shows mutation failures inside the confirmation step and sends the reviewed zone', async () => {
    api.apply.mockResolvedValueOnce({ success: false, error: '模拟写入失败' })
    await mount()
    click('添加规则')
    await flush()
    const input = host.querySelector('#firewall-ports') as HTMLInputElement
    input.value = '5432'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
    click('检查并继续')
    await flush()
    click('确认添加')
    await flush()
    expect(host.querySelector('[data-dialog] [role="alert"]')?.textContent).toContain(
      '模拟写入失败'
    )
    expect(api.apply.mock.calls[0][1].draft.zone).toBe('external')
  })
  it('uses the actual SSH port preset and blocks actions after a failed detection', async () => {
    await mount()
    click('添加规则')
    await flush()
    const select = host.querySelector('#firewall-preset') as HTMLSelectElement
    select.value = 'ssh'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await flush()
    expect((host.querySelector('#firewall-ports') as HTMLInputElement).value).toBe('2222')
    api.inspect.mockResolvedValueOnce({ success: false, error: 'permission denied' })
    ;(host.querySelector('[aria-label="重新检测防火墙"]') as HTMLButtonElement).click()
    await flush()
    expect(host.textContent).toContain('状态未知')
    expect(
      [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === '添加规则')
        ?.disabled
    ).toBe(true)
  })
  it('refreshes periodically only while visible and re-detects on reconnect', async () => {
    await mount()
    expect(api.inspect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15000)
    await flush()
    expect(api.inspect.mock.calls.length).toBeGreaterThan(1)
    props.active = false
    await flush()
    const count = api.inspect.mock.calls.length
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.inspect).toHaveBeenCalledTimes(count)
    closed('a')
    await flush()
    expect(host.textContent).toContain('SSH 已断开')
    reconnected('a')
    await flush()
    expect(api.inspect).toHaveBeenCalledTimes(count + 1)
  })
  it('ignores late results from a previous SSH session', async () => {
    let release!: (value: any) => void
    api.inspect.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    await mount()
    props.connectionId = 'b'
    await flush()
    release({ success: true, data: { ...firewallOverview(), osName: 'obsolete-server' } })
    await flush()
    expect(host.textContent).not.toContain('obsolete-server')
    expect(host.textContent).toContain('Debian Linux')
  })
})
