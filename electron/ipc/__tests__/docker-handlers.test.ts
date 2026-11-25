// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  manager: {
    getOverview: vi.fn(),
    install: vi.fn(),
    cleanupUnused: vi.fn(),
    executeContainerAction: vi.fn(),
    executeContainerBatchAction: vi.fn()
  }
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: Function) => mocks.handlers.set(name, fn) }
}))
vi.mock('../../managers/DockerManager', () => ({ dockerManager: mocks.manager }))
import { registerDockerHandlers } from '../docker-handlers'
describe('Docker IPC results', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.handlers.clear()
    registerDockerHandlers()
  })
  it.each([
    ['docker:install', 'install', []],
    ['docker:cleanupUnused', 'cleanupUnused', []],
    ['docker:containerAction', 'executeContainerAction', ['remove', 'a'.repeat(64)]],
    ['docker:containerBatchAction', 'executeContainerBatchAction', ['remove', ['a'.repeat(64)]]]
  ] as const)(
    'preserves partial outcomes on %s without claiming success',
    async (channel, method, args) => {
      const data = {
        status: 'partial',
        items: [{ status: 'failed', target: 'image' }],
        output: 'image in use'
      }
      mocks.manager[method].mockResolvedValue(data)
      const response = await mocks.handlers.get(channel)!({}, 'ssh', ...args)
      expect(response.success).toBe(false)
      expect(response.data).toEqual(data)
      expect(response.error).toContain('部分')
    }
  )
  it('does not enable optional deletion for truthy non-boolean arguments', async () => {
    mocks.manager.executeContainerAction.mockResolvedValue({
      status: 'success',
      items: [],
      output: ''
    })
    await mocks.handlers.get('docker:containerAction')!({}, 'ssh', 'remove', 'a'.repeat(64), {
      removeImage: 'false',
      removeNetworks: 1
    })
    expect(mocks.manager.executeContainerAction).toHaveBeenCalledWith(
      'ssh',
      'remove',
      'a'.repeat(64),
      { removeImage: false, removeNetworks: false }
    )
  })
  it('rejects malformed operations before invoking the manager', async () => {
    expect(
      (await mocks.handlers.get('docker:containerAction')!({}, 'ssh', 'remove', 'bad;id')).success
    ).toBe(false)
    expect(
      (await mocks.handlers.get('docker:containerBatchAction')!({}, 'ssh', 'remove', [])).success
    ).toBe(false)
    expect(mocks.manager.executeContainerAction).not.toHaveBeenCalled()
    expect(mocks.manager.executeContainerBatchAction).not.toHaveBeenCalled()
  })
})
