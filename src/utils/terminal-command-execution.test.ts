import { describe, expect, it } from 'vitest'
import { buildTerminalExecutePayload, buildTerminalInsertPayload } from './terminal-command-execution'

describe('terminal-command-execution', () => {
  it('keeps single-line commands as a direct enter payload', () => {
    expect(buildTerminalExecutePayload('npm run build')).toBe('npm run build\r')
  })

  it('uses bracketed paste plus enter for multiline execution when supported', () => {
    const payload = buildTerminalExecutePayload([
      'cd /root/Nextshop',
      'npx prisma generate',
      'npm run build &&',
      'pm2 restart nextshop'
    ].join('\n'), true)

    expect(payload.startsWith('\x1b[200~')).toBe(true)
    expect(payload).toContain('npx prisma generate\r')
    expect(payload).toContain('npm run build &&\rpm2 restart nextshop\x1b[201~\r')
    expect(payload.endsWith('\x1b[201~\r')).toBe(true)
    expect(payload).not.toContain('\n')
  })

  it('falls back to plain carriage returns for multiline execution without bracketed paste', () => {
    const payload = buildTerminalExecutePayload('echo before\necho after', false)

    expect(payload).toBe('echo before\recho after\r')
  })

  it('uses bracketed paste for multiline inserts when supported', () => {
    expect(buildTerminalInsertPayload('echo a\nprintf b', true)).toBe('\x1b[200~echo a\rprintf b\x1b[201~')
  })
})
