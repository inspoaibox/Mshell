import { describe, it, expect } from 'vitest'
import { TerminalInputState, matchesInputSnapshot } from './terminal-input-state'

const state = () => {
  const input = new TerminalInputState()
  input.observePrompt('root@host:/srv/app# ')
  return input
}
describe('shell draft tracking', () => {
  it('inserts and deletes at the cursor with Unicode-safe offsets', () => {
    const input = state()
    input.feed('abc')
    input.feed('\x1b[D')
    input.feed('中')
    expect(input.snapshot().text).toBe('ab中c')
    expect(input.canSuggest).toBe(false)
    input.feed('\x7f')
    input.feed('\x1b[3~')
    expect(input.snapshot().text).toBe('ab')
    expect(input.canSuggest).toBe(true)
  })
  it('models Home/End and Ctrl+U/K without corrupting the remaining text', () => {
    const input = state()
    input.feed('echo test')
    input.feed('\x01')
    input.feed('sudo ')
    expect(input.snapshot().text).toBe('sudo echo test')
    input.feed('\x15')
    expect(input.snapshot().text).toBe('echo test')
    input.feed('\x0b')
    expect(input.snapshot().text).toBe('')
    input.feed('echo 😀')
    input.feed('\x7f')
    expect(input.snapshot().text).toBe('echo ')
  })
  it('stops suggesting and recording while a command or editor is running', () => {
    const input = state()
    input.feed('vim file')
    expect(input.feed('\r')).toBe('vim file')
    input.feed('?search')
    expect(input.canSuggest).toBe(false)
    expect(input.feed('\r')).toBeUndefined()
    input.observePrompt('root@host:/srv/new# ')
    expect(input.cwd).toBe('/srv/new')
    expect(input.canSuggest).toBe(true)
  })
  it('invalidates unknown history edits and multiline paste instead of guessing', () => {
    for (const edit of [
      '\x1b[A',
      '\x12',
      '\t',
      'echo first\necho second',
      '\x1b[200~test\x1b[201~'
    ]) {
      const input = state()
      input.feed('echo')
      input.feed(edit)
      expect(input.canSuggest).toBe(false)
      expect(input.feed('\r')).toBeUndefined()
    }
  })
  it('rejects old input snapshots and does not guess a relative directory from a short prompt', () => {
    const input = state(),
      old = input.snapshot()
    input.feed('ls')
    expect(matchesInputSnapshot(input.snapshot(), old)).toBe(false)
    input.feed('\r')
    input.observePrompt('work# ')
    expect(input.cwd).toBe('')
    input.setDirectory('/srv/with space')
    expect(input.cwd).toBe('/srv/with space')
  })
  it('does not enable command intelligence for continuation/REPL prompts', () => {
    for (const prompt of ['>>> ', '> ', 'Password: ', '(gdb) ']) {
      const input = new TerminalInputState()
      input.observePrompt(prompt)
      expect(input.canSuggest).toBe(false)
    }
  })
})
