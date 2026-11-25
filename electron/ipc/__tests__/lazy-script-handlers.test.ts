// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  execute: vi.fn(),
  connection: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, fn: Function) => mocks.handlers.set(name, fn) },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../../managers/LazyScriptManager', () => ({
  lazyScriptManager: { initialize: async () => {}, onChanged: () => () => {} }
}))
vi.mock('../../managers/SSHConnectionManager', () => ({
  sshConnectionManager: { getConnection: mocks.connection, executeCommandDetailed: mocks.execute }
}))
import { registerLazyScriptHandlers } from '../lazy-script-handlers'
import { SCRIPT_DEPLOYMENT_PATH_MARKER } from '../../../src/utils/lazy-script-template'
const token = '12345678-1234-1234-1234-123456789abc'
describe('isolated script deployment IPC', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.handlers.clear()
    mocks.connection.mockReturnValue({ status: 'connected' })
    registerLazyScriptHandlers()
  })
  const sender = (id: number) => Object.assign(new EventEmitter(), { id })
  it('rejects disconnected sessions and invalid paths before opening an SSH channel', async () => {
    const event = { sender: sender(1) },
      deploy = mocks.handlers.get('lazyScript:deploy')!
    expect((await deploy(event, 'ssh', token, '../other.sh', 'true')).success).toBe(false)
    mocks.connection.mockReturnValue({ status: 'reconnecting' })
    expect((await deploy(event, 'ssh', token, 'test.sh', 'true')).success).toBe(false)
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(event.sender.listenerCount('destroyed')).toBe(0)
  })
  it('reports remote errors rather than success, with a deadline and bounded output', async () => {
    mocks.execute.mockResolvedValue({ exitCode: 1, stderr: 'disk full', stdout: '' })
    const result = await mocks.handlers.get('lazyScript:deploy')!(
      { sender: sender(1) },
      'ssh',
      token,
      'test.sh',
      'printf test'
    )
    expect(result).toEqual({ success: false, error: 'disk full' })
    expect(mocks.execute.mock.calls[0][2]).toBe(30000)
    expect(mocks.execute.mock.calls[0][3]).toBe(1024 * 1024)
  })
  it('returns the server-resolved absolute path and the saved copy path', async () => {
    const fileName = '.run-' + token + '.sh'
    const path = '/home/john/.mshell/scripts/' + fileName
    mocks.execute.mockResolvedValue({
      exitCode: 0,
      stderr: '',
      stdout: 'login banner\n' + SCRIPT_DEPLOYMENT_PATH_MARKER + path + '\n'
    })
    const result = await mocks.handlers.get('lazyScript:deploy')!(
      { sender: sender(1) },
      'ssh',
      token,
      fileName,
      'true',
      'add-key.sh'
    )
    expect(result).toEqual({
      success: true,
      data: { path, savedPath: '/home/john/.mshell/scripts/add-key.sh' }
    })
  })
  it.each(['no path', SCRIPT_DEPLOYMENT_PATH_MARKER + '/home/john/.mshell/scripts/wrong.sh'])(
    'rejects incomplete or mismatched deployment output %s',
    (stdout) => {
      mocks.execute.mockResolvedValue({ exitCode: 0, stderr: '', stdout })
      return expect(
        mocks.handlers.get('lazyScript:deploy')!(
          { sender: sender(1) },
          'ssh',
          token,
          'test.sh',
          'true'
        )
      ).resolves.toMatchObject({ success: false })
    }
  )
  it('scopes cancellation to the requesting window and cancels when that window closes', async () => {
    let signal!: AbortSignal
    mocks.execute.mockImplementation(
      (...args: any[]) =>
        new Promise((_resolve, reject) => {
          signal = args[5]
          signal.addEventListener('abort', () => reject(new Error('cancelled')))
        })
    )
    const owner = sender(1),
      event = { sender: owner }
    const pending = mocks.handlers.get('lazyScript:deploy')!(event, 'ssh', token, 'test.sh', 'true')
    mocks.handlers.get('lazyScript:cancelDeployment')!({ sender: sender(2) }, token)
    expect(signal.aborted).toBe(false)
    owner.emit('destroyed')
    expect((await pending).success).toBe(false)
    expect(signal.aborted).toBe(true)
    expect(owner.listenerCount('destroyed')).toBe(0)
  })
})
