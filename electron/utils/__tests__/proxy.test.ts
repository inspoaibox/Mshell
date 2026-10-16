// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import * as net from 'node:net'
import { ProxyHelper } from '../proxy'

describe('proxy negotiation preserves SSH transport data', () => {
  const servers = new Set<net.Server>()
  const sockets = new Set<net.Socket>()
  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    await Promise.all(
      [...servers].map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
    servers.clear()
    sockets.clear()
  })
  const start = async (handler: (socket: net.Socket) => void) => {
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => {})
      handler(socket)
    })
    servers.add(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return (server.address() as net.AddressInfo).port
  }
  const banner = 'SSH-2.0-loopback-test\r\n'
  const readBanner = (socket: net.Socket) =>
    new Promise<string>((resolve, reject) => {
      sockets.add(socket)
      let text = ''
      socket.on('error', reject)
      socket.on('data', (data) => {
        text += data.toString()
        if (text.endsWith('\r\n')) resolve(text)
      })
      socket.resume()
    })

  it('keeps a target banner coalesced with an HTTP CONNECT response', async () => {
    const port = await start((socket) =>
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 Connection established\r\n')
        setTimeout(() => socket.write('\r\n' + banner), 5)
      })
    )
    const socket = await ProxyHelper.connect(
      { enabled: true, type: 'http', host: '127.0.0.1', port },
      '127.0.0.1',
      22
    )
    expect(await readBanner(socket)).toBe(banner)
  })

  it.each([false, true])(
    'handles fragmented SOCKS5 replies (password authentication: %s)',
    async (withPassword) => {
      const port = await start((socket) => {
        let phase = 0
        socket.on('data', () => {
          if (phase === 0) {
            phase = withPassword ? 1 : 2
            socket.write(Buffer.from([5]))
            setTimeout(() => socket.write(Buffer.from([withPassword ? 2 : 0])), 5)
          } else if (phase === 1) {
            phase = 2
            socket.write(Buffer.from([1]))
            setTimeout(() => socket.write(Buffer.from([0])), 5)
          } else {
            const reply = Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 22])
            socket.write(reply.subarray(0, 7))
            setTimeout(
              () => socket.write(Buffer.concat([reply.subarray(7), Buffer.from(banner)])),
              5
            )
          }
        })
      })
      const socket = await ProxyHelper.connect(
        {
          enabled: true,
          type: 'socks5',
          host: '127.0.0.1',
          port,
          username: 'test',
          password: 'test'
        },
        '127.0.0.1',
        22
      )
      expect(await readBanner(socket)).toBe(banner)
    }
  )

  it.each(['http', 'socks5'] as const)('rejects an early %s proxy close', async (type) => {
    const port = await start((socket) => socket.end())
    await expect(
      ProxyHelper.connect({ enabled: true, type, host: '127.0.0.1', port }, '127.0.0.1', 22)
    ).rejects.toThrow(/关闭/)
  })
})
