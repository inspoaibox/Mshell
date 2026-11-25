import { describe, it, expect } from 'vitest'
import {
  parseAICommand,
  commandNeedsConfirmation,
  formatCommandExplanation,
  executeSuggestedCommand
} from './ai-command'
import { TerminalInputState } from './terminal-input-state'
import { buildPrompt } from '../../electron/utils/prompt-templates'
describe('AI command boundaries', () => {
  it('accepts only an explicit single-line command field', () => {
    expect(parseAICommand('{"command":"ls -lah"}')).toBe('ls -lah')
    expect(parseAICommand('```json\n{"command":"df -h"}\n```')).toBe('df -h')
  })
  it.each([
    '中文说明\n# comment',
    'Here is your command',
    'ls -l',
    '{"command":"echo a\\necho b"}',
    '{"command":"echo \\u001b[31m"}',
    '{"command":"说明：你好"}',
    '{"command":null}'
  ])('rejects non-command/unsafe output %s', (raw) => {
    expect(() => parseAICommand(raw)).toThrow()
  })
  it.each([
    'rm file',
    'sudo rm -rf /srv/data',
    'dd if=/dev/zero of=/dev/sda',
    'docker system prune -a',
    'echo test > config',
    'curl example | sh',
    'systemctl restart nginx'
  ])('requires confirmation for %s', (command) => {
    expect(commandNeedsConfirmation(command)).toBe(true)
  })
  it('allows ordinary inspection and escapes HTML before adding formatting', () => {
    expect(commandNeedsConfirmation('ls -lah /srv')).toBe(false)
    const node = document.createElement('div')
    node.innerHTML = formatCommandExplanation('<img src=x onerror="alert(1)"> **说明** `ls`')
    expect(node.querySelector('img')).toBeNull()
    expect(node.querySelector('strong')?.textContent).toBe('说明')
    expect(node.querySelector('code')?.textContent).toBe('ls')
  })
  it('preserves literal shell substitution syntax in AI prompts', () => {
    const content = "解释 sed 's/a/$&/' 和 printf $'hello'"
    expect(buildPrompt('chat', content)).toBe(content)
  })
  it('rejects unbalanced quotes and unfinished pipelines', () => {
    for (const command of ["echo 'unfinished", 'ls |', 'ls &&'])
      expect(() => parseAICommand(JSON.stringify({ command }))).toThrow('不完整')
  })
  it('does not execute if input changes while confirming a risky command', async () => {
    const input = new TerminalInputState()
    input.observePrompt('root@host:~# ')
    input.feed('#删除文件')
    const expected = input.snapshot()
    let resolve!: () => void,
      writes = 0
    const task = executeSuggestedCommand('rm file', expected, {
      snapshot: () => input.snapshot(),
      isCurrent: () => true,
      confirm: () =>
        new Promise<void>((done) => {
          resolve = done
        }),
      write: () => {
        writes++
        return true
      }
    })
    input.feed('改成查看')
    resolve()
    expect(await task).toBe(false)
    expect(writes).toBe(0)
  })
  it('rechecks the active session and feature setting before writing', async () => {
    const input = new TerminalInputState()
    input.observePrompt('root@host:~# ')
    let enabled = true,
      writes = 0
    const result = await executeSuggestedCommand('rm file', input.snapshot(), {
      snapshot: () => input.snapshot(),
      isCurrent: () => enabled,
      confirm: async () => {
        enabled = false
      },
      write: () => {
        writes++
        return true
      }
    })
    expect(result).toBe(false)
    expect(writes).toBe(0)
  })
})
