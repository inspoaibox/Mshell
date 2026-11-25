// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compileScript } from '../../../src/utils/lazy-script-template'
const storage = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => storage.directory } }))
import { LazyScriptManager } from '../LazyScriptManager'
beforeEach(() => {
  storage.directory = mkdtempSync(join(tmpdir(), 'mshell-library-test-'))
})
afterEach(() => {
  if (resolve(dirname(storage.directory)) === resolve(tmpdir()))
    rmSync(storage.directory, { recursive: true, force: true })
})
describe('lazy script library persistence', () => {
  it('initializes once concurrently and retains deletions across restart', async () => {
    const first = new LazyScriptManager()
    await Promise.all([first.initialize(), first.initialize()])
    expect(first.getAll()).toHaveLength(13)
    const script = first.getAll()[0]
    await first.delete(script.id)
    const reopened = new LazyScriptManager()
    await reopened.initialize()
    expect(reopened.getAll()).toHaveLength(12)
    expect(reopened.get(script.id)).toBeUndefined()
  })
  it('preserves customized templates with old filenames and empty libraries', async () => {
    const path = join(storage.directory, 'lazy-scripts.json')
    writeFileSync(
      path,
      JSON.stringify([
        {
          id: 'custom',
          name: 'custom',
          fileName: '安装常用工具.sh',
          content: 'echo custom',
          variables: []
        }
      ])
    )
    const manager = new LazyScriptManager()
    await manager.initialize()
    expect(manager.getAll()).toHaveLength(1)
    expect(manager.get('custom')?.content).toBe('echo custom')
    await manager.delete('custom')
    const reopened = new LazyScriptManager()
    await reopened.initialize()
    expect(reopened.getAll()).toEqual([])
  })
  it('does not overwrite a corrupt library with defaults', async () => {
    const path = join(storage.directory, 'lazy-scripts.json')
    writeFileSync(path, 'broken {')
    const manager = new LazyScriptManager()
    await expect(manager.initialize()).rejects.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('broken {')
  })
  it('removes password defaults on load/create/sync and emits persisted changes', async () => {
    const path = join(storage.directory, 'lazy-scripts.json')
    const record = {
      id: 'custom',
      name: 'custom',
      fileName: 'custom.sh',
      content: 'echo {{password}}',
      variables: [{ name: 'password', type: 'password', defaultValue: 'legacy-secret' }]
    }
    writeFileSync(path, JSON.stringify([record]))
    const manager = new LazyScriptManager()
    const changed = vi.fn()
    manager.onChanged(changed)
    await manager.initialize()
    expect(readFileSync(path, 'utf8')).not.toContain('legacy-secret')
    await manager.syncPut({ ...record, id: 'synced' })
    expect(readFileSync(path, 'utf8')).not.toContain('legacy-secret')
    expect(changed).toHaveBeenCalled()
    await Promise.all([
      manager.update('custom', { description: 'first' }),
      manager.update('synced', { description: 'second' })
    ])
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(2)
  })
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
  it.skipIf(process.platform === 'win32' && !existsSync(bash))(
    'all builtin templates compile to valid Bash with the safe parameter renderer',
    async () => {
      const manager = new LazyScriptManager()
      await manager.initialize()
      for (const script of manager.getAll()) {
        const values = Object.fromEntries(
          script.variables.map((v) => [v.name, v.defaultValue || 'sample-value'])
        )
        const compiled = compileScript(script.content, values, script.variables)
        const result = spawnSync(bash, ['--noprofile', '--norc', '-n'], {
          input: compiled,
          encoding: 'utf8'
        })
        expect(result.status, script.name + ': ' + result.stderr).toBe(0)
      }
    }
  )
})
