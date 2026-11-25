import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { completionInput } from './input'
import { getCompletions } from './suggestions'
import { getInlineSuggestion } from './inline-suggest'
import { completionHistory, retainCompletionHistory, loadCompletionHistory } from './history'
import { withCompletionDirectory } from './providers/file-system'

describe('completion sources and context', () => {
  let release: () => void, changed: () => void
  const api = {
    commandHistory: { getRecentUnique: vi.fn(), onChanged: vi.fn() },
    snippet: { getAll: vi.fn(), searchByShortcut: vi.fn() },
    ssh: { completePath: vi.fn(), executeCommand: vi.fn() }
  }
  beforeEach(async () => {
    vi.resetAllMocks()
    api.commandHistory.getRecentUnique.mockResolvedValue({ success: true, data: ['echo old'] })
    api.commandHistory.onChanged.mockImplementation((fn) => {
      changed = fn
      return vi.fn()
    })
    api.snippet.getAll.mockResolvedValue({ success: true, data: [] })
    api.snippet.searchByShortcut.mockResolvedValue({ success: true, data: [] })
    api.ssh.completePath.mockResolvedValue({
      success: true,
      data: [{ name: 'file name.txt', directory: false }]
    })
    api.ssh.executeCommand.mockResolvedValue({ success: true, data: 'main|123abc' })
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: api })
    release = retainCompletionHistory()
    await loadCompletionHistory()
  })
  afterEach(() => release())
  it('parses quoted/escaped words without evaluating them', () => {
    expect(completionInput('cat "space dir/fi').current).toBe('space dir/fi')
    expect(completionInput('cat ./$(id)/fi').current).toBe('./$(id)/fi')
    expect(completionInput('cat space\\ dir/fi').current).toBe('space dir/fi')
  })
  it('uses the generic file provider with the current directory and quotes inserted names', async () => {
    const results = await getCompletions('unknown ./fi', 'session', '/srv/project', api)
    expect(api.ssh.completePath).toHaveBeenCalledWith('session', './fi', '/srv/project')
    expect(results[0].command).toBe("unknown './file name.txt' ")
  })
  it('completes absolute paths even when there is no matching slash shortcut', async () => {
    const results = await getCompletions('/tmp/fi', 'session', undefined, api)
    expect(results[0].command).toBe("'/tmp/file name.txt' ")
    expect(api.ssh.completePath).toHaveBeenCalledWith('session', '/tmp/fi', undefined)
  })
  it('prefixes option-like filenames so completion cannot turn a file into a command flag', async () => {
    api.ssh.completePath.mockResolvedValue({
      success: true,
      data: [{ name: '-rf', directory: false }]
    })
    const results = await getCompletions('cat -r', 'session', '/srv', api)
    expect(results.some((row) => row.command === 'cat ./-rf ')).toBe(true)
  })
  it('replaces the full quoted token while keeping the command prefix', async () => {
    const results = await getCompletions('cat "space dir/fi', 'session', '/srv/project', api)
    expect(results.some((row) => row.command === "cat 'space dir/file name.txt' ")).toBe(true)
  })
  it('keeps the popup and ghost history in sync immediately after a change', async () => {
    expect((await getInlineSuggestion('echo '))?.text).toBe('echo old')
    api.commandHistory.getRecentUnique.mockResolvedValue({ success: true, data: ['echo new'] })
    changed()
    await loadCompletionHistory()
    expect((await getInlineSuggestion('echo '))?.text).toBe('echo new')
    expect(
      (await getCompletions('echo ', 'session', '/srv', api)).some(
        (row) => row.command === 'echo new'
      )
    ).toBe(true)
    expect(completionHistory.value).toEqual(['echo new'])
  })
  it('does not let an old history fetch restore deleted entries', async () => {
    let resolve!: (value: unknown) => void
    api.commandHistory.getRecentUnique.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const old = loadCompletionHistory(true)
    await Promise.resolve()
    api.commandHistory.getRecentUnique.mockResolvedValue({ success: true, data: [] })
    changed()
    await loadCompletionHistory()
    resolve({ success: true, data: ['deleted command'] })
    await old
    expect(completionHistory.value).toEqual([])
  })
  it('scopes dynamic Git/npm queries and refuses unknown working directories', async () => {
    await withCompletionDirectory(api, "/srv/it's safe").ssh!.executeCommand!(
      'session',
      'git branch',
      3000
    )
    expect(api.ssh.executeCommand.mock.calls[0][1]).toBe("cd -- '/srv/it'\\''s safe' && git branch")
    api.ssh.executeCommand.mockClear()
    expect(
      (await withCompletionDirectory(api).ssh!.executeCommand!('session', 'git branch')).success
    ).toBe(false)
    expect(api.ssh.executeCommand).not.toHaveBeenCalled()
  })
})
