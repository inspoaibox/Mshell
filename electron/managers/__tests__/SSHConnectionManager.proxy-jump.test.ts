// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as net from 'node:net'
import { generateKeyPairSync } from 'node:crypto'
import { Server, utils, type Connection, type ParsedKey } from 'ssh2'
import { SSHConnectionManager } from '../SSHConnectionManager'
import { ProxyJumpHelper } from '../../utils/proxy-jump'
import { ProxyHelper } from '../../utils/proxy'
import {
  prepareSSHConnectionOptions,
  processProxyJumpPrivateKeys
} from '../../utils/ssh-connect-options'
import type { ProxyJumpConfig } from '../../../src/types/session'

vi.mock('../../utils/app-settings', () => ({
  appSettingsManager: {
    getSettings: () => ({
      ssh: { timeout: 2, keepalive: false },
      security: { verifyHostKey: true, sessionTimeout: 0 }
    })
  }
}))
vi.mock('../../utils/logger', () => ({ logger: { logError: vi.fn(), logInfo: vi.fn() } }))
vi.mock('../../utils/known-hosts', () => ({
  verifySshHostKey: () => true,
  knownHostsManager: { isTrustedHostKey: () => false, verifyHost: () => 'trusted' }
}))

describe('real SSH jump connections (loopback only)', () => {
  let manager: SSHConnectionManager
  let hostKey: string
  let targetKey: { private: string; public: string }
  let targetPublic: ParsedKey
  const keyPassphrase = 'ephemeral-test-only'
  let servers: Array<net.Server | Server>
  let serverConnections: Set<Connection>
  let sockets: Set<net.Socket>
  let authenticated: string[]

  beforeAll(() => {
    hostKey = utils.generateKeyPairSync('ed25519').private
    targetKey = utils.generateKeyPairSync('ed25519', {
      passphrase: keyPassphrase,
      cipher: 'aes256-cbc',
      rounds: 16
    })
    targetPublic = utils.parseKey(targetKey.public) as ParsedKey
  })
  beforeEach(() => {
    manager = new SSHConnectionManager()
    manager.on('error', () => {})
    servers = []
    serverConnections = new Set()
    sockets = new Set()
    authenticated = []
  })
  afterEach(async () => {
    for (const connection of manager.getAllConnections()) await manager.disconnect(connection.id)
    for (const client of serverConnections) client.end()
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
  })

  const listen = async (server: net.Server | Server) => {
    servers.push(server)
    if (server instanceof net.Server) {
      server.on('connection', (socket: net.Socket) => {
        sockets.add(socket)
        socket.on('error', () => {})
      })
    }
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as net.AddressInfo).port
  }

  const sshServer = async (
    name: string,
    opts: {
      keyOnly?: boolean
      forwarding?: 'deny' | 'stall'
      closeEarly?: boolean
      stallShell?: boolean
    } = {}
  ) => {
    const server = new Server({ hostKeys: [hostKey] }, (client) => {
      serverConnections.add(client)
      client.on('error', () => {})
      client.on('close', () => serverConnections.delete(client))
      if (opts.closeEarly) {
        client.end()
        return
      }
      client.on('authentication', (ctx) => {
        if (!opts.keyOnly && ctx.method === 'password' && ctx.password === 'jump-password') {
          ctx.accept()
        } else if (
          opts.keyOnly &&
          ctx.method === 'publickey' &&
          ctx.key.data.equals(targetPublic.getPublicSSH()) &&
          (!ctx.signature ||
            (ctx.blob && targetPublic.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true))
        ) {
          ctx.accept()
        } else {
          ctx.reject(opts.keyOnly ? ['publickey'] : ['password'])
        }
      })
      client.on('ready', () => authenticated.push(name))
      client.on('tcpip', (accept, reject, info) => {
        if (opts.forwarding === 'stall') return
        if (opts.forwarding === 'deny' || info.destIP !== '127.0.0.1') {
          reject()
          return
        }
        const socket = net.connect(info.destPort, info.destIP)
        sockets.add(socket)
        socket.on('error', () => reject())
        socket.once('connect', () => {
          const channel = accept()
          channel.on('error', () => socket.destroy())
          channel.on('close', () => socket.destroy())
          channel.pipe(socket).pipe(channel)
        })
      })
      client.on('session', (accept) => {
        const session = accept()
        session.on('pty', (acceptPty) => acceptPty?.())
        session.on('env', (acceptEnv) => acceptEnv?.())
        session.on('shell', (acceptShell) => {
          if (opts.stallShell) return
          const channel = acceptShell()
          channel.on('error', () => {})
          channel.write('ready-from-test-server\n')
          channel.on('data', (data: Buffer) => channel.write(data))
        })
        session.on('exec', (acceptExec) => {
          const channel = acceptExec()
          channel.on('error', () => {})
          channel.write('123\n')
          channel.exit(0)
          channel.end()
        })
      })
    })
    return listen(server)
  }

  const jumpConfig = (port: number): ProxyJumpConfig => ({
    enabled: true,
    host: '127.0.0.1',
    port,
    username: 'jump',
    authType: 'password',
    password: 'jump-password'
  })
  const targetOptions = async (port: number, proxyJump?: ProxyJumpConfig) =>
    prepareSSHConnectionOptions({
      host: '127.0.0.1',
      port,
      username: 'target',
      authType: 'privateKey',
      privateKey: targetKey.private,
      passphrase: keyPassphrase,
      password: 'must-not-be-used',
      proxyJump,
      autoReconnect: false,
      readyTimeout: 2000
    })
  const expectReleased = () =>
    vi.waitFor(() => expect(serverConnections.size).toBe(0), { timeout: 2500 })

  it('opens a terminal using a password jump and a separate encrypted target key, then closes every hop', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    const options = await targetOptions(target, jumpConfig(first))
    expect(options.password).toBeUndefined()
    const data: string[] = []
    manager.on('data', (_id, chunk) => data.push(chunk.toString()))
    await manager.connect('terminal', options)
    expect(manager.getConnection('terminal')?.status).toBe('connected')
    expect(authenticated).toEqual(['jump', 'target'])
    manager.write('terminal', 'echo-test\n')
    await vi.waitFor(() => expect(data.join('')).toContain('echo-test'))
    await manager.disconnect('terminal')
    await expectReleased()
  })

  it('keeps direct key authentication working', async () => {
    const target = await sshServer('target', { keyOnly: true })
    await manager.connect('direct', await targetOptions(target))
    expect(manager.getConnection('direct')?.status).toBe('connected')
    await manager.disconnect('direct')
    await expectReleased()
  })

  it('authenticates multiple hops in UI order and supports a private key on the second hop', async () => {
    const first = await sshServer('first')
    const second = await sshServer('second', { keyOnly: true })
    const target = await sshServer('target', { keyOnly: true })
    const jump = {
      ...jumpConfig(first),
      nextJump: {
        ...jumpConfig(second),
        authType: 'privateKey' as const,
        privateKey: targetKey.private,
        passphrase: keyPassphrase
      }
    }
    await manager.connect('chain', await targetOptions(target, jump))
    expect(authenticated).toEqual(['first', 'second', 'target'])
    await manager.disconnect('chain')
    await expectReleased()
  })

  it('ignores disabled downstream hops including their missing key files', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    const jump = {
      ...jumpConfig(first),
      nextJump: {
        ...jumpConfig(1),
        enabled: false,
        authType: 'privateKey' as const,
        privateKeyPath: 'does-not-exist'
      }
    }
    await manager.connect('enabled-only', await targetOptions(target, jump))
    expect(authenticated).toEqual(['jump', 'target'])
  })

  it('rejects invalid private keys instead of leaving the connection promise pending', async () => {
    const target = await sshServer('target', { keyOnly: true })
    await expect(
      manager.connect('invalid-key', {
        ...(await targetOptions(target)),
        privateKey: Buffer.from('invalid')
      })
    ).rejects.toThrow()
    expect(manager.getConnection('invalid-key')).toBeUndefined()
    await expectReleased()
  })

  it('returns jump authentication errors and releases the failed attempt', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    await expect(
      manager.connect(
        'bad-password',
        await targetOptions(target, { ...jumpConfig(first), password: 'wrong' })
      )
    ).rejects.toThrow(/跳板连接失败/)
    expect(manager.getAllConnections()).toHaveLength(0)
    await expectReleased()
  })

  it('returns target authentication errors and releases the jump as well', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    const wrong = utils.generateKeyPairSync('ed25519')
    const options = {
      ...(await targetOptions(target, jumpConfig(first))),
      privateKey: Buffer.from(wrong.private),
      passphrase: undefined
    }
    await expect(manager.connect('bad-target', options)).rejects.toThrow()
    await expectReleased()
  })

  it('reports refused forwarding rather than claiming the target is reachable', async () => {
    const first = await sshServer('jump', { forwarding: 'deny' })
    await expect(
      ProxyJumpHelper.connectThroughProxy(jumpConfig(first), '127.0.0.1', 21800)
    ).rejects.toThrow(/跳板转发失败/)
    await expectReleased()
  })

  it('times out a jump that never answers forwardOut', async () => {
    const first = await sshServer('jump', { forwarding: 'stall' })
    await expect(
      ProxyJumpHelper.connectThroughProxy(jumpConfig(first), '127.0.0.1', 21800, undefined, {
        timeoutMs: 600
      })
    ).rejects.toThrow(/超时/)
    await expectReleased()
  })

  it('rejects a transport closed before SSH is ready', async () => {
    const port = await listen(net.createServer((socket) => socket.end()))
    await expect(manager.connect('closed-early', await targetOptions(port))).rejects.toThrow()
    expect(manager.getAllConnections()).toHaveLength(0)
  })

  it('bounds a target that authenticates but never opens its shell', async () => {
    const target = await sshServer('target', { keyOnly: true, stallShell: true })
    await expect(
      manager.connect('stalled-shell', { ...(await targetOptions(target)), readyTimeout: 600 })
    ).rejects.toThrow(/超时/)
    await expectReleased()
  })

  it('cancels during jump setup without resurrecting a connection', async () => {
    const first = await sshServer('jump', { forwarding: 'stall' })
    const pending = manager.connect('cancel', await targetOptions(21800, jumpConfig(first)))
    const rejection = expect(pending).rejects.toThrow(/取消/)
    await vi.waitFor(() => expect(authenticated).toContain('jump'))
    await manager.disconnect('cancel')
    await rejection
    expect(manager.getAllConnections()).toHaveLength(0)
    await expectReleased()
  })

  it('rebuilds the jump chain after a dropped connection', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    await manager.connect('reconnect', {
      ...(await targetOptions(target, jumpConfig(first))),
      autoReconnect: true,
      maxReconnectAttempts: 1,
      reconnectInterval: 30
    })
    const reconnected = new Promise<void>((resolve) => manager.once('reconnected', () => resolve()))
    const initialConnections = [...serverConnections]
    initialConnections[0].end()
    await reconnected
    expect(authenticated).toEqual(['jump', 'target', 'jump', 'target'])
    await manager.disconnect('reconnect')
    await expectReleased()
  })

  it('can cancel an automatic reconnect while its jump is still forwarding', async () => {
    const behavior: { forwarding?: 'stall' } = {}
    const first = await sshServer('jump', behavior)
    const target = await sshServer('target', { keyOnly: true })
    await manager.connect('cancel-reconnect', {
      ...(await targetOptions(target, jumpConfig(first))),
      autoReconnect: true,
      maxReconnectAttempts: 3,
      reconnectInterval: 20
    })
    behavior.forwarding = 'stall'
    const failed = vi.fn()
    manager.on('reconnect-failed', failed)
    ;[...serverConnections][0].end()
    await vi.waitFor(() => expect(authenticated).toEqual(['jump', 'target', 'jump']))
    manager.cancelReconnect('cancel-reconnect')
    await expectReleased()
    expect(manager.getAllConnections()).toHaveLength(0)
    expect(failed).not.toHaveBeenCalled()
  })

  it('supports an HTTP proxy beneath the jump connection', async () => {
    const first = await sshServer('jump')
    const target = await sshServer('target', { keyOnly: true })
    const proxyPort = await listen(
      net.createServer((socket) => {
        let request = ''
        const onData = (data: Buffer) => {
          request += data.toString()
          if (!request.includes('\r\n\r\n')) return
          socket.removeListener('data', onData)
          expect(request).toContain(`CONNECT 127.0.0.1:${first} HTTP/1.1`)
          const upstream = net.connect(first, '127.0.0.1', () => {
            socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
            socket.pipe(upstream).pipe(socket)
          })
          sockets.add(upstream)
          upstream.on('error', () => socket.destroy())
          socket.on('close', () => upstream.destroy())
        }
        socket.on('data', onData)
      })
    )
    await manager.connect('underlying-proxy', {
      ...(await targetOptions(target, jumpConfig(first))),
      proxy: { enabled: true, type: 'http', host: '127.0.0.1', port: proxyPort }
    })
    expect(authenticated).toEqual(['jump', 'target'])
    await manager.disconnect('underlying-proxy')
    await expectReleased()
  })

  it('normalizes encrypted PKCS8 keys for jump authentication', async () => {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: keyPassphrase
      },
      publicKeyEncoding: { type: 'spki', format: 'pem' }
    })
    const config = await processProxyJumpPrivateKeys({
      ...jumpConfig(22),
      authType: 'privateKey',
      privateKey: pair.privateKey,
      passphrase: keyPassphrase
    })
    expect(utils.parseKey(config.privateKey!, keyPassphrase)).not.toBeInstanceOf(Error)
    expect(config.privateKey).toContain('BEGIN RSA PRIVATE KEY')
  })

  it.each(['http', 'socks5'] as const)(
    'times out and cancels an unresponsive %s proxy',
    async (type) => {
      const port = await listen(net.createServer())
      const proxy = { enabled: true, type, host: '127.0.0.1', port }
      await expect(ProxyHelper.connect(proxy, '127.0.0.1', 22, { timeoutMs: 100 })).rejects.toThrow(
        /超时/
      )
      const controller = new AbortController()
      const pending = ProxyHelper.connect(proxy, '127.0.0.1', 22, { signal: controller.signal })
      const rejection = expect(pending).rejects.toThrow(/取消/)
      controller.abort()
      await rejection
    }
  )

  it('rejects cyclic configurations before recursively reading private keys', async () => {
    const config = jumpConfig(22)
    config.nextJump = config
    await expect(processProxyJumpPrivateKeys(config)).rejects.toThrow(/循环/)
  })
})
