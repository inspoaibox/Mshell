import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, inject, nextTick, provide, reactive, type App } from 'vue'
import type { DockerContainer, DockerOverview } from '@/types/docker'
const messages = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn()
}))
vi.mock('element-plus', () => ({
  ElCheckbox: { render: () => null },
  ElMessage: messages,
  ElMessageBox: Object.assign((...args: unknown[]) => messages.confirm(...args), {
    confirm: messages.confirm
  })
}))
import DockerPanel from './DockerPanel.vue'
const container = (
  letter: string,
  name: string,
  state = 'running',
  project = 'demo'
): DockerContainer => ({
  id: letter.repeat(64),
  name,
  state,
  image: 'app:latest',
  status: state,
  ports: '',
  createdAt: '',
  cpu: '1.00%',
  memory: '1MiB',
  netIO: '-',
  composeProject: project,
  composeService: name,
  composeWorkingDir: '',
  composeConfigFiles: ''
})
const overview = (containers = [container('a', 'web'), container('b', 'db')]): DockerOverview => ({
  environment: {
    installed: true,
    dockerVersion: 'fixture',
    composeInstalled: true,
    composeVersion: 'fixture',
    serviceStatus: 'active',
    socketAccessible: true,
    needsSudo: false,
    accessError: '',
    accessStatus: 'ready',
    os: { id: 'debian', versionId: '12', prettyName: 'Debian', packageManager: 'apt-get' }
  },
  containers,
  warnings: []
})
const success = () => ({
  success: true,
  data: {
    status: 'success',
    output: 'done',
    items: [{ kind: 'container', target: 'a', status: 'success', message: 'done' }]
  }
})
const flush = async () => {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const box = defineComponent({ setup: (_, ctx) => () => h('div', ctx.attrs, ctx.slots.default?.()) })
const button = defineComponent({
  props: ['loading', 'icon', 'type'],
  setup: (_, ctx) => () => h('button', ctx.attrs, ctx.slots.default?.())
})

describe('Docker panel operations and refresh lifecycle', () => {
  let app: App | undefined,
    host: HTMLElement,
    closed: (id: string) => void,
    reconnected: (id: string) => void
  const listenersRemoved = vi.fn()
  const props = reactive({ connectionId: 'ssh-a', active: true })
  const api = {
    getOverview: vi.fn(),
    containerAction: vi.fn(),
    containerBatchAction: vi.fn(),
    install: vi.fn(),
    cleanupUnused: vi.fn()
  }
  const click = (text: string) => {
    const el = [...host.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text
    )
    expect(el, text).toBeTruthy()
    el!.click()
  }
  const command = (name: string) => {
    const el = host.querySelector('[data-command="' + name + '"]') as HTMLButtonElement
    expect(el, name).toBeTruthy()
    el.click()
  }
  const search = async (value: string) => {
    const input = host.querySelector('input')!
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flush()
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    props.connectionId = 'ssh-a'
    props.active = true
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    messages.confirm.mockResolvedValue(undefined)
    api.getOverview.mockResolvedValue({ success: true, data: overview() })
    for (const method of [
      api.containerAction,
      api.containerBatchAction,
      api.install,
      api.cleanupUnused
    ])
      method.mockResolvedValue(success())
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        docker: api,
        ssh: {
          onClose: (fn: typeof closed) => {
            closed = fn
            return listenersRemoved
          },
          onReconnected: (fn: typeof reconnected) => {
            reconnected = fn
            return listenersRemoved
          }
        }
      }
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
  const mount = async () => {
    app = createApp({ render: () => h(DockerPanel, props) })
    app.directive('loading', {})
    for (const name of ['el-icon', 'el-scrollbar', 'el-dropdown-menu']) app.component(name, box)
    app.component('el-button', button)
    app.component(
      'el-alert',
      defineComponent({
        props: ['title'],
        setup: (p) => () => h('aside', { role: 'alert' }, p.title)
      })
    )
    app.component(
      'el-empty',
      defineComponent({ props: ['description'], setup: (p) => () => h('p', p.description) })
    )
    app.component(
      'el-input',
      defineComponent({
        props: ['modelValue', 'size'],
        emits: ['update:modelValue'],
        setup:
          (p, { emit, attrs }) =>
          () =>
            h('input', {
              ...attrs,
              value: p.modelValue,
              onInput: (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)
            })
      })
    )
    app.component(
      'el-dropdown',
      defineComponent({
        emits: ['command'],
        setup: (_, { emit, slots }) => {
          provide('command', (value: string) => emit('command', value))
          return () => h('div', [slots.default?.(), slots.dropdown?.()])
        }
      })
    )
    app.component(
      'el-dropdown-item',
      defineComponent({
        props: ['command'],
        setup: (p, { slots }) => {
          const emit = inject<(value: string) => void>('command')!
          return () =>
            h(
              'button',
              { 'data-command': p.command, onClick: () => emit(p.command) },
              slots.default?.()
            )
        }
      })
    )
    app.mount(host)
    await flush()
  }

  it('refreshes at 5 seconds, pauses in the background, resumes and cleans up', async () => {
    await mount()
    expect(api.getOverview).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.getOverview).toHaveBeenCalledTimes(2)
    props.active = false
    await flush()
    await vi.advanceTimersByTimeAsync(20000)
    expect(api.getOverview).toHaveBeenCalledTimes(2)
    props.active = true
    await flush()
    expect(api.getOverview).toHaveBeenCalledTimes(3)
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    await vi.advanceTimersByTimeAsync(10000)
    expect(api.getOverview).toHaveBeenCalledTimes(3)
    app!.unmount()
    app = undefined
    expect(listenersRemoved).toHaveBeenCalledTimes(2)
  })
  it('allows automatic refresh to be turned off without disabling manual refresh', async () => {
    await mount()
    const select = host.querySelector('select')!
    select.value = '0'
    select.dispatchEvent(new Event('change'))
    await flush()
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.getOverview).toHaveBeenCalledTimes(1)
    click('刷新')
    await flush()
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it('does not overlap slow requests or apply data from a previous connection', async () => {
    let resolve!: (value: unknown) => void
    api.getOverview.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    await mount()
    await vi.advanceTimersByTimeAsync(30000)
    expect(api.getOverview).toHaveBeenCalledTimes(1)
    props.connectionId = 'ssh-b'
    await flush()
    resolve({ success: true, data: overview([container('c', 'OLD-SERVER', 'running', '')]) })
    await flush()
    expect(host.textContent).not.toContain('OLD-SERVER')
    expect(api.getOverview).toHaveBeenLastCalledWith('ssh-b')
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it('operates on the entire project after search and explains hidden targets', async () => {
    await mount()
    await search('web')
    command('restart')
    await flush()
    expect(messages.confirm.mock.calls[0][0]).toContain('db')
    expect(api.containerBatchAction).toHaveBeenCalledWith(
      'ssh-a',
      'restart',
      ['b'.repeat(64), 'a'.repeat(64)],
      {}
    )
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it('keeps the entire project when filtering by state', async () => {
    api.getOverview.mockResolvedValue({
      success: true,
      data: overview([container('a', 'web'), container('b', 'db', 'exited')])
    })
    await mount()
    click('停止 1')
    await flush()
    command('restart')
    await flush()
    expect(api.containerBatchAction.mock.calls[0][2]).toHaveLength(2)
  })
  it('allows stopping restart loops and does not classify them as stopped', async () => {
    api.getOverview.mockResolvedValue({
      success: true,
      data: overview([container('a', 'loop', 'restarting', '')])
    })
    await mount()
    expect(host.textContent).toContain('停止 0')
    expect(host.querySelector('[data-command="start"]')).toBeNull()
    command('stop')
    await flush()
    expect(api.containerAction).toHaveBeenCalledWith('ssh-a', 'stop', 'a'.repeat(64), {})
  })
  it('reports partial success and refreshes even when IPC success is false', async () => {
    api.containerBatchAction.mockResolvedValue({
      success: false,
      data: {
        status: 'partial',
        output: 'image still in use',
        items: [
          { kind: 'container', target: 'a', status: 'success', message: 'removed' },
          { kind: 'image', target: 'sha256:old', status: 'failed', message: 'in use' }
        ]
      }
    })
    await mount()
    command('remove')
    await flush()
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.warning).toHaveBeenCalled()
    expect(host.textContent).toContain('成功 1 项，失败 1 项')
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it('refreshes after an uncertain transport failure', async () => {
    api.containerBatchAction.mockRejectedValue(new Error('SSH closed'))
    await mount()
    command('restart')
    await flush()
    expect(host.textContent).toContain('结果未确认')
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it.each(['cancel', 'close'])(
    'handles confirmation %s without errors or a mutation',
    async (reason) => {
      messages.confirm.mockRejectedValue(reason)
      await mount()
      command('remove')
      await flush()
      expect(api.containerBatchAction).not.toHaveBeenCalled()
      expect(messages.error).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5000)
      expect(api.getOverview).toHaveBeenCalledTimes(2)
    }
  )
  it('does not mutate when the connection changes during confirmation', async () => {
    let resolve!: () => void
    messages.confirm.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    await mount()
    command('remove')
    await flush()
    props.connectionId = 'ssh-b'
    await flush()
    resolve()
    await flush()
    expect(api.containerBatchAction).not.toHaveBeenCalled()
  })
  it('retains data and pauses on disconnect, then refreshes after reconnect', async () => {
    await mount()
    closed('ssh-a')
    await flush()
    await vi.advanceTimersByTimeAsync(20000)
    expect(api.getOverview).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('连接已断开')
    command('remove')
    await flush()
    expect(api.containerBatchAction).not.toHaveBeenCalled()
    reconnected('ssh-a')
    await flush()
    expect(api.getOverview).toHaveBeenCalledTimes(2)
  })
  it('preserves stale rows and blocks mutations after refresh failure', async () => {
    await mount()
    await search('web')
    api.getOverview.mockResolvedValueOnce({ success: false, error: 'list failed' })
    click('刷新')
    await flush()
    expect(host.textContent).toContain('web')
    expect(host.textContent).toContain('显示上次数据')
    command('remove')
    await flush()
    expect(api.containerBatchAction).not.toHaveBeenCalled()
  })
  it('recovers after a synchronous IPC error instead of leaving refresh stuck', async () => {
    api.getOverview.mockImplementationOnce(() => {
      throw new Error('IPC unavailable')
    })
    await mount()
    expect(host.textContent).toContain('IPC unavailable')
    await vi.advanceTimersByTimeAsync(5000)
    expect(api.getOverview).toHaveBeenCalledTimes(2)
    expect(host.textContent).not.toContain('IPC unavailable')
  })
  it('does not display service failures as permission problems or an empty list', async () => {
    const data = overview([])
    data.environment.accessStatus = 'unavailable'
    data.environment.socketAccessible = false
    data.environment.accessError = 'Cannot connect to the Docker daemon'
    api.getOverview.mockResolvedValue({ success: true, data })
    await mount()
    expect(host.textContent).toContain('请检查服务是否启动')
    expect(host.textContent).not.toContain('暂无匹配容器')
    expect(host.textContent).not.toContain('用户没有 Docker 访问权限')
  })
  it('discards a pre-operation sample and requests fresh state after mutation', async () => {
    await mount()
    let resolve!: (value: unknown) => void
    api.getOverview.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    click('刷新')
    await flush()
    command('restart')
    await flush()
    expect(api.containerBatchAction).toHaveBeenCalledTimes(1)
    resolve({ success: true, data: overview([container('c', 'STALE-SAMPLE', 'running', '')]) })
    await flush()
    expect(host.textContent).not.toContain('STALE-SAMPLE')
    expect(api.getOverview).toHaveBeenCalledTimes(3)
  })
})
