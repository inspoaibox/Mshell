import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  snapshotScript,
  terminalReadinessError,
  waitForScriptCompletion
} from './lazy-script-execution'

const token = '12345678-1234-1234-1234-123456789abc'
const marker = `\x1b]777;mshell-script-done;${token};0\x07`
afterEach(() => {
  vi.useRealTimers()
})
it('retains the exact script/values and drops password inputs after UI changes', () => {
  const script = {
    id: 'A',
    name: 'A',
    fileName: 'a.sh',
    content: 'echo {{value}}',
    type: 'shell' as const,
    riskLevel: 'low',
    runMode: 'execute',
    variables: [{ name: 'value' }, { name: 'password', type: 'password', defaultValue: 'secret' }]
  }
  const values = { value: 'before', password: 'secret' }
  const snapshot = snapshotScript(script, values)
  script.id = 'B'
  script.fileName = 'b.sh'
  values.value = 'after'
  expect(snapshot.script.id).toBe('A')
  expect(snapshot.script.fileName).toBe('a.sh')
  expect(snapshot.content).toContain("'before'")
  expect(JSON.stringify(snapshot)).not.toContain('secret')
})
it('rejects missing terminals, full-screen editors, hidden input and busy/nonempty lines', () => {
  const instance = (type: string, line: string, echoEnabled = true) => ({
    echoEnabled,
    terminal: {
      buffer: {
        active: { type, baseY: 0, cursorY: 0, getLine: () => ({ translateToString: () => line }) }
      }
    }
  })
  expect(terminalReadinessError(undefined)).toBeTruthy()
  expect(terminalReadinessError(instance('alternate', 'root# '))).toContain('全屏')
  expect(terminalReadinessError(instance('normal', 'root# ', false))).toContain('隐藏')
  expect(terminalReadinessError(instance('normal', 'root# typed'))).toContain('空闲')
  expect(terminalReadinessError(instance('normal', 'root@host:~# '))).toBeNull()
})
describe('execution completion lifecycle', () => {
  const setup = () => {
    let output!: (text: string) => void
    let disconnect!: () => void
    const releaseOutput = vi.fn(),
      releaseDisconnect = vi.fn(),
      controller = new AbortController(),
      start = vi.fn(async () => {})
    const promise = waitForScriptCompletion({
      token,
      timeout: 1000,
      signal: controller.signal,
      subscribe: (fn) => {
        output = fn
        return releaseOutput
      },
      onDisconnect: (fn) => {
        disconnect = fn
        return releaseDisconnect
      },
      start
    })
    return {
      promise,
      controller,
      start,
      releaseOutput,
      releaseDisconnect,
      output: (text: string) => output(text),
      disconnect: () => disconnect()
    }
  }
  it('finds a marker before a large tail in the same SSH chunk', async () => {
    const run = setup()
    run.output(marker + 'x'.repeat(5000))
    expect(await run.promise).toBe(0)
    expect(run.releaseOutput).toHaveBeenCalledOnce()
    expect(run.releaseDisconnect).toHaveBeenCalledOnce()
  })
  it('detects split markers and ignores unrelated execution IDs', async () => {
    const run = setup()
    run.output(marker.replace(token, 'other'))
    run.output(marker.slice(0, 20))
    run.output(marker.slice(20))
    expect(await run.promise).toBe(0)
  })
  it('ends immediately on disconnect and cleans listeners', async () => {
    const run = setup()
    run.disconnect()
    await expect(run.promise).rejects.toThrow('SSH 已断开')
    expect(run.releaseDisconnect).toHaveBeenCalledOnce()
  })
  it('does not send commands after cancellation before start', async () => {
    const run = setup()
    run.controller.abort()
    await expect(run.promise).rejects.toThrow('停止等待')
    expect(run.start).not.toHaveBeenCalled()
  })
  it('times out with explicit unknown remote status, without retaining listeners', async () => {
    vi.useFakeTimers()
    const run = setup()
    const assertion = expect(run.promise).rejects.toThrow('可能仍在运行')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(run.releaseOutput).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
