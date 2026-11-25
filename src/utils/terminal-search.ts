import type { IDisposable, Terminal } from 'xterm'
import type { SearchAddon } from 'xterm-addon-search'

export interface TerminalSearchOptions {
  caseSensitive?: boolean
  regex?: boolean
}

export interface TerminalSearchResult {
  scope: 'history' | 'screen'
  found: boolean
  currentMatch: number | null
  matchCount: number | null
  limited: boolean
  row: number | null
  column: number | null
  error: string
}

export const SEARCH_HIGHLIGHT_LIMIT = 1000

export const emptySearchResult = (
  scope: TerminalSearchResult['scope'] = 'history'
): TerminalSearchResult => ({
  scope,
  found: false,
  currentMatch: null,
  matchCount: null,
  limited: false,
  row: null,
  column: null,
  error: ''
})

/** Coordinates xterm's search results and viewport without sending input to the remote shell. */
export class TerminalSearchController {
  private term = ''
  private options: TerminalSearchOptions = {}
  private result = emptySearchResult()
  private searching = false
  private refreshTimer?: ReturnType<typeof setTimeout>
  private subscriptions: IDisposable[]

  constructor(
    private terminal: Terminal,
    private addon: SearchAddon,
    private onResult: (result: TerminalSearchResult) => void
  ) {
    this.result = emptySearchResult(this.scope)
    this.subscriptions = [
      addon.onDidChangeResults(({ resultIndex, resultCount }) => {
        if (!this.term || this.scope === 'screen') return
        this.result.matchCount = resultCount
        this.result.currentMatch = resultIndex >= 0 ? resultIndex + 1 : null
        this.result.limited = resultCount >= SEARCH_HIGHLIGHT_LIMIT
        if (!this.searching) this.publish()
      }),
      terminal.buffer.onBufferChange(() => {
        this.addon.clearDecorations()
        this.terminal.clearSelection()
        this.result = emptySearchResult(this.scope)
        this.publish()
        this.scheduleRefresh()
      }),
      terminal.onWriteParsed(() => {
        // Decorations/markers are unavailable in xterm's alternate buffer.
        // Re-evaluate its current screen after a full-screen application redraws.
        if (this.scope === 'screen') this.scheduleRefresh()
      })
    ]
    this.publish()
  }

  private get scope(): TerminalSearchResult['scope'] {
    return this.terminal.buffer.active.type === 'alternate' ? 'screen' : 'history'
  }

  private publish(): void {
    const selection = this.term ? this.terminal.getSelectionPosition() : undefined
    this.result = {
      ...this.result,
      scope: this.scope,
      found: !!selection,
      row: selection ? selection.start.y + 1 : null,
      column: selection ? selection.start.x + 1 : null
    }
    this.onResult({ ...this.result })
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    if (!this.term) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      this.run(this.term, this.options, 'initial', false)
    }, 200)
  }

  search(term: string, options: TerminalSearchOptions = {}): void {
    this.run(term, options, 'initial')
  }

  next(): void {
    this.run(this.term, this.options, 'next')
  }
  previous(): void {
    this.run(this.term, this.options, 'previous')
  }

  clear(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    this.term = ''
    // Also resets the addon's cached options, so pending output refreshes cannot restore a query.
    this.addon.findNext('')
    this.result = emptySearchResult(this.scope)
    this.publish()
  }

  private run(
    term: string,
    options: TerminalSearchOptions,
    direction: 'initial' | 'next' | 'previous',
    reveal = true
  ): void {
    if (!term) {
      this.clear()
      return
    }
    const changed =
      term !== this.term ||
      options.regex !== this.options.regex ||
      options.caseSensitive !== this.options.caseSensitive
    this.term = term
    this.options = { ...options }
    this.result.error = ''
    this.searching = true
    const previousViewport = this.terminal.buffer.active.viewportY
    try {
      if (options.regex) new RegExp(term)
      if (changed || direction === 'initial') {
        this.addon.clearDecorations()
        this.terminal.clearSelection()
      }
      const searchOptions = {
        ...options,
        decorations:
          this.scope === 'history'
            ? {
                matchBorder: '#38bdf8',
                matchOverviewRuler: '#38bdf8',
                activeMatchBorder: '#f59e0b',
                activeMatchColorOverviewRuler: '#f59e0b'
              }
            : undefined
      }
      const found =
        direction === 'previous'
          ? this.addon.findPrevious(term, searchOptions)
          : this.addon.findNext(term, searchOptions)
      if (this.scope === 'screen') {
        this.result.matchCount = null
        this.result.currentMatch = null
        this.result.limited = false
      }
      const position = found ? this.terminal.getSelectionPosition() : undefined
      if (position && reveal && this.scope === 'history') {
        this.terminal.scrollToLine(
          Math.max(0, position.start.y - Math.floor(this.terminal.rows / 2))
        )
      } else if (!reveal && this.scope === 'history') {
        this.terminal.scrollToLine(previousViewport)
      }
      this.terminal.refresh(0, this.terminal.rows - 1)
    } catch {
      this.addon.clearDecorations()
      this.terminal.clearSelection()
      this.result = {
        ...emptySearchResult(this.scope),
        error: options.regex ? '正则表达式无效，请检查语法' : '搜索失败，请重新输入关键词'
      }
    } finally {
      this.searching = false
      this.publish()
    }
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose())
    this.clear()
  }
}
