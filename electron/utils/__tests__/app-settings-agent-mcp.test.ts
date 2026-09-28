import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'downloads' ? 'C:\\Users\\test\\Downloads' : 'C:\\nonexistent-mshell-test'
  }
}))

import { appSettingsManager } from '../app-settings'

describe('Agent MCP permission settings', () => {
  const normalize = (value: Record<string, unknown>) =>
    (appSettingsManager as any).normalizeAgentMcpSettings(value)

  it('migrates the legacy write switch to query or execute mode', () => {
    expect(normalize({ allowWriteEnabled: false }).permissionMode).toBe('query')
    expect(normalize({ allowWriteEnabled: true }).permissionMode).toBe('execute')
  })

  it('keeps an explicit confirm mode and derives the compatibility flag', () => {
    expect(normalize({ permissionMode: 'confirm', allowWriteEnabled: true })).toMatchObject({
      permissionMode: 'confirm',
      allowWriteEnabled: false
    })
  })
})
