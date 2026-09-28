import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'

const { testDataPath } = vi.hoisted(() => ({
  testDataPath: `${process.env.TEMP || '/tmp'}/mshell-snippet-manager-test-${process.pid}`
}))

vi.mock('electron', () => ({
  app: { getPath: () => testDataPath }
}))

import { SnippetManager } from '../SnippetManager'

describe('SnippetManager pinning', () => {
  beforeEach(async () => {
    await fs.rm(testDataPath, { recursive: true, force: true })
  })

  afterEach(async () => {
    await fs.rm(testDataPath, { recursive: true, force: true })
  })

  it('persists and removes the pinned timestamp without affecting older snippets', async () => {
    const manager = new SnippetManager()
    await manager.initialize()
    const older = await manager.create({ name: '旧片段', command: 'uptime', category: '运维' })
    const common = await manager.create({ name: '常用片段', command: 'df -h', category: '运维' })

    await manager.setPinned(common.id, true)
    expect(manager.get(common.id)?.pinnedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(manager.get(older.id)?.pinnedAt).toBeUndefined()

    const saved = JSON.parse(await fs.readFile(`${testDataPath}/snippets.json`, 'utf8'))
    expect(saved.find((snippet: { id: string }) => snippet.id === common.id).pinnedAt).toBeTruthy()

    await manager.setPinned(common.id, false)
    expect(manager.get(common.id)?.pinnedAt).toBeUndefined()
    const savedAfterUnpin = JSON.parse(await fs.readFile(`${testDataPath}/snippets.json`, 'utf8'))
    expect(savedAfterUnpin.find((snippet: { id: string }) => snippet.id === common.id).pinnedAt).toBeUndefined()
  })
})
