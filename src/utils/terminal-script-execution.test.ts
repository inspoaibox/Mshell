import { describe, expect, it, vi } from 'vitest'
import {
  appendScriptOutputBuffer,
  buildInteractiveScriptCommand,
  createScriptRunToken,
  findScriptCompletion
} from './terminal-script-execution'

describe('terminal script execution', () => {
  it('builds a one-line PTY command that always reports the script exit status', () => {
    const token = '12345678-1234-1234-1234-123456789abc'
    const command = buildInteractiveScriptCommand("~/.mshell/scripts/'check.sh'", token)
    expect(command).toContain("bash ~/.mshell/scripts/'check.sh'; mshell_status=$?")
    expect(command).toContain(`mshell-script-done;${token};%s`)
    expect(command).toContain('"$mshell_status"')
    expect(command).not.toContain('\n')
  })

  it('detects an invisible completion marker split across SSH chunks', () => {
    const token = '12345678-1234-1234-1234-123456789abc'
    let buffer = appendScriptOutputBuffer('', 'script output\r\n\x1b]777;mshell-script')
    expect(findScriptCompletion(buffer, token)).toBeNull()
    buffer = appendScriptOutputBuffer(buffer, `-done;${token};17\x07root@server:# `)
    expect(findScriptCompletion(buffer, token)).toBe(17)
  })

  it('ignores markers for another run and malformed status values', () => {
    const token = '12345678-1234-1234-1234-123456789abc'
    expect(findScriptCompletion(`\x1b]777;mshell-script-done;other-token;0\x07`, token)).toBeNull()
    expect(
      findScriptCompletion(`\x1b]777;mshell-script-done;${token};secret\x07`, token)
    ).toBeNull()
  })

  it('keeps only the tail needed for marker detection', () => {
    expect(appendScriptOutputBuffer('a'.repeat(20), 'tail', 8)).toBe('aaaatail')
  })

  it('uses a random UUID token and rejects unsafe values', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '12345678-1234-1234-1234-123456789abc' })
    expect(createScriptRunToken()).toBe('12345678-1234-1234-1234-123456789abc')
    expect(() =>
      buildInteractiveScriptCommand("~/.mshell/scripts/'check.sh'", 'bad;touch')
    ).toThrow()
    expect(() =>
      buildInteractiveScriptCommand("'/tmp/check.sh'", '12345678-1234-1234-1234-123456789abc')
    ).toThrow()
    vi.unstubAllGlobals()
  })
})
