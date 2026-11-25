// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildPathCompletionScript, parsePathCompletions } from '../completion-paths'
const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\sh.exe' : '/bin/sh'
describe('path completion command validation', () => {
  it('rejects unknown relative directories and control characters', () => {
    expect(() => buildPathCompletionScript('file')).toThrow('当前目录')
    expect(() => buildPathCompletionScript('/tmp/\ncmd')).toThrow()
    expect(() => buildPathCompletionScript('file', '/srv/\0bad')).toThrow()
  })
  it('ignores malformed and control-bearing names', () => {
    expect(parsePathCompletions('d\0safe dir\0f\0bad\nname\0')).toEqual([
      { name: 'safe dir', directory: true }
    ])
  })
})
describe.skipIf(!existsSync(shell))(
  'literal path completion in an isolated local directory',
  () => {
    it('uses the supplied directory and never evaluates substitutions or quote characters', () => {
      const root = mkdtempSync(join(tmpdir(), 'mshell-completion-'))
      try {
        mkdirSync(join(root, 'space dir'))
        mkdirSync(join(root, '$(printf${IFS}SHOULD_NOT_RUN)'))
        writeFileSync(join(root, 'space dir', "quote'file.txt"), '')
        writeFileSync(join(root, '$(printf${IFS}SHOULD_NOT_RUN)', 'literal.txt'), '')
        const cwd = root
          .replace(/\\/g, '/')
          .replace(/^([A-Za-z]):/, (_match, drive: string) => '/' + drive.toLowerCase())
        for (const input of ['space dir/quo', '$(printf${IFS}SHOULD_NOT_RUN)/lit']) {
          const result = spawnSync(shell, ['-s'], {
            input: 'export PATH=/usr/bin:/bin\n' + buildPathCompletionScript(input, cwd),
            encoding: 'utf8'
          })
          expect(result.status, result.stderr).toBe(0)
          const rows = parsePathCompletions(result.stdout)
          expect(rows).toHaveLength(1)
          expect(rows[0].name).toBe(input.startsWith('space') ? "quote'file.txt" : 'literal.txt')
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
)
