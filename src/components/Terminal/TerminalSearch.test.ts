import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import ElementPlus from 'element-plus'
import TerminalSearch from './TerminalSearch.vue'
import { emptySearchResult } from '@/utils/terminal-search'

describe('terminal search controls', () => {
  let app: App
  let host: HTMLElement
  const next = vi.fn()
  const previous = vi.fn()
  const search = vi.fn()
  const closed = vi.fn()
  const state = reactive({ visible: true, result: emptySearchResult() })
  const input = () => host.querySelector('input.el-input__inner') as HTMLInputElement
  const type = async (text: string) => {
    input().value = text
    input().dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    state.visible = true
    state.result = emptySearchResult()
    host = document.createElement('div')
    document.body.append(host)
    app = createApp({
      render: () =>
        h(TerminalSearch, {
          visible: state.visible,
          result: state.result,
          'onUpdate:visible': (visible: boolean) => {
            state.visible = visible
          },
          onFindNext: next,
          onFindPrevious: previous,
          onSearch: search,
          onClose: closed
        })
    })
    app.use(ElementPlus).mount(host)
    await nextTick()
  })
  afterEach(() => {
    app.unmount()
    host.remove()
  })

  it('focuses the input when opened and clears the query when closed', async () => {
    expect(document.activeElement).toBe(input())
    await type('needle')
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(state.visible).toBe(false)
    expect(closed).toHaveBeenCalledOnce()
    state.visible = true
    await nextTick()
    await nextTick()
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
  })

  it('Shift+Enter moves only backwards and Enter only forwards', async () => {
    await type('needle')
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    )
    expect(previous).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(next).toHaveBeenCalledOnce()
    expect(previous).toHaveBeenCalledOnce()
  })

  it('does not navigate on IME composition confirmation', async () => {
    await type('查询')
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
    )
    expect(next).not.toHaveBeenCalled()
    expect(previous).not.toHaveBeenCalled()
  })

  it('emits an empty search so clearing input clears highlights', async () => {
    await type('needle')
    await type('')
    expect(search).toHaveBeenLastCalledWith('', { caseSensitive: false, regex: false })
  })

  it('shows alternate-screen limitations and actual coordinates without a false zero count', async () => {
    await type('needle')
    state.result = { ...emptySearchResult('screen'), found: true, row: 2, column: 3 }
    await nextTick()
    expect(host.textContent).toContain('已定位')
    expect(host.textContent).toContain('画面第 2 行，第 3 列')
    expect(host.textContent).toContain('全屏程序当前画面')
    expect(host.textContent).toContain('Ctrl+W')
    expect(host.textContent).not.toContain('0 / 0')
  })
})
