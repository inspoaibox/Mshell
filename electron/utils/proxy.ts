import * as net from 'net'
import { ProxyConfig } from '../../src/types/session'
import type { ConnectionAttemptOptions } from './ssh-transport'

export class ProxyHelper {
    /**
     * 通过代理建立连接
     */
    static async connect(
        proxy: ProxyConfig,
        targetHost: string,
        targetPort: number,
        options: ConnectionAttemptOptions = {}
    ): Promise<net.Socket> {
        if (proxy.type === 'socks5') {
            return this.connectSocks5(proxy, targetHost, targetPort, options)
        } else if (proxy.type === 'http') {
            return this.connectHttp(proxy, targetHost, targetPort, options)
        }
        throw new Error(`Unsupported proxy type: ${proxy.type}`)
    }

    private static watchAttempt(
        socket: net.Socket,
        options: ConnectionAttemptOptions,
        reject: (error: Error) => void
    ) {
        const cleanup = () => {
            clearTimeout(timer)
            socket.removeListener('close', onClose)
            options.signal?.removeEventListener('abort', onAbort)
        }
        const fail = (error: Error) => {
            cleanup()
            socket.destroy()
            reject(error)
        }
        const onClose = () => fail(new Error('代理连接在握手完成前关闭'))
        const onAbort = () => fail(new Error('已取消代理连接'))
        const timer = setTimeout(() => fail(new Error('代理连接超时')), options.timeoutMs || 30_000)
        socket.once('close', onClose)
        options.signal?.addEventListener('abort', onAbort, { once: true })
        return { cleanup, fail }
    }

    /**
     * SOCKS5 代理连接
     */
    private static connectSocks5(
        proxy: ProxyConfig,
        targetHost: string,
        targetPort: number,
        options: ConnectionAttemptOptions
    ): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket()
            const attempt = this.watchAttempt(socket, options, reject)
            if (options.signal?.aborted) {
                attempt.fail(new Error('已取消代理连接'))
                return
            }

            socket.on('error', (err) => {
                attempt.fail(new Error(`SOCKS5 connection failed: ${err.message}`))
            })

            socket.connect(proxy.port, proxy.host, () => {
                // 1. 发送握手请求
                // Version 5, 2 authentication methods supported: No Auth (0x00), Username/Password (0x02)
                const methods = [0x00]
                if (proxy.username && proxy.password) {
                    methods.push(0x02)
                }

                const handshake = Buffer.from([0x05, methods.length, ...methods])
                socket.write(handshake)
            })

            let step = 0 // greeting, authentication, connect reply
            let buffer = Buffer.alloc(0)
            socket.on('data', (data: Buffer) => {
                try {
                    buffer = Buffer.concat([buffer, data])
                    if (step === 0) {
                        if (buffer.length < 2) return
                        const [version, method] = buffer
                        buffer = buffer.subarray(2)
                        if (version !== 5 || ![0, 2].includes(method))
                            throw new Error('SOCKS5 authentication method rejected')
                        if (method === 2) {
                            if (!proxy.username || !proxy.password)
                                throw new Error('Proxy authentication credentials missing')
                            const user = Buffer.from(proxy.username)
                            const password = Buffer.from(proxy.password)
                            if (user.length > 255 || password.length > 255)
                                throw new Error('Proxy credentials exceed SOCKS5 length limit')
                            socket.write(
                                Buffer.concat([
                                    Buffer.from([1, user.length]),
                                    user,
                                    Buffer.from([password.length]),
                                    password
                                ])
                            )
                            step = 1
                        } else {
                            this.sendSocks5Connect(socket, targetHost, targetPort)
                            step = 2
                        }
                    }
                    if (step === 1) {
                        if (buffer.length < 2) return
                        if (buffer[0] !== 1 || buffer[1] !== 0)
                            throw new Error('SOCKS5 authentication failed')
                        buffer = buffer.subarray(2)
                        this.sendSocks5Connect(socket, targetHost, targetPort)
                        step = 2
                    }
                    if (step === 2) {
                        if (buffer.length < 4) return
                        if (buffer[0] !== 5 || buffer[1] !== 0)
                            throw new Error(`SOCKS5 connection failed with status: ${buffer[1]}`)
                        const type = buffer[3]
                        if (type === 3 && buffer.length < 5) return
                        const length =
                            type === 1 ? 10 : type === 4 ? 22 : type === 3 ? 7 + buffer[4] : 0
                        if (!length) throw new Error('Invalid SOCKS5 address type')
                        if (buffer.length < length) return
                        // The same packet may contain the target's SSH banner. Preserve it.
                        socket.pause()
                        socket.removeAllListeners('data')
                        socket.removeAllListeners('error')
                        if (buffer.length > length) socket.unshift(buffer.subarray(length))
                        attempt.cleanup()
                        resolve(socket)
                    }
                } catch (error) {
                    attempt.fail(error instanceof Error ? error : new Error(String(error)))
                }
            })
        })
    }

    /**
     * 发送 SOCKS5 连接请求
     */
    private static sendSocks5Connect(socket: net.Socket, host: string, port: number) {
        // Version 5, Command 1 (Connect), Reserved 0, Address Type, Address, Port
        // Address Type: 0x01 (IPv4), 0x03 (Domain), 0x04 (IPv6)

        let addrType = 0x03 // Default to Domain
        let addrBuf: Buffer

        if (net.isIPv4(host)) {
            addrType = 0x01
            addrBuf = Buffer.from(host.split('.').map(Number))
        } else if (net.isIPv6(host)) {
            addrType = 0x04
            // 简化处理，这里假设是 Domain，因为解析 IPv6 比较麻烦，如果不被 net.isIPv6 识别为 Buffer，就当域名
            // 但实际上 net.isIPv6 只验证字符串。要转 Buffer 比较麻烦。
            // 为了安全起见，这里统一先支持 Domain 和 IPv4。IPv6 用户通常直接填域名。
            // 如果必须支持 IPv6 IP直连，需要额外的转换逻辑。
            // 暂时回退到 Domain 模式处理 IPv6 字符串（大多数 SOCKS5 服务器支持）
            addrType = 0x03
            addrBuf = Buffer.concat([Buffer.from([host.length]), Buffer.from(host)])
        } else {
            // Domain
            addrBuf = Buffer.concat([Buffer.from([host.length]), Buffer.from(host)])
        }

        const portBuf = Buffer.alloc(2)
        portBuf.writeUInt16BE(port)

        const request = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, addrType]), addrBuf, portBuf])

        socket.write(request)
    }

    /**
     * HTTP 代理连接 (CONNECT 方法)
     */
    private static connectHttp(
        proxy: ProxyConfig,
        targetHost: string,
        targetPort: number,
        options: ConnectionAttemptOptions
    ): Promise<net.Socket> {
        return new Promise((resolve, reject) => {
            const socket = new net.Socket()
            const attempt = this.watchAttempt(socket, options, reject)
            if (options.signal?.aborted) {
                attempt.fail(new Error('已取消代理连接'))
                return
            }

            socket.on('error', (err) => {
                attempt.fail(new Error(`HTTP proxy connection failed: ${err.message}`))
            })

            socket.connect(proxy.port, proxy.host, () => {
                // 构建 CONNECT 请求
                let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n`
                req += `Host: ${targetHost}:${targetPort}\r\n`

                if (proxy.username && proxy.password) {
                    const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString(
                        'base64'
                    )
                    req += `Proxy-Authorization: Basic ${auth}\r\n`
                }

                req += '\r\n'
                socket.write(req)
            })

            let buffer = Buffer.alloc(0)

            const onData = (data: Buffer) => {
                buffer = Buffer.concat([buffer, data])
                const headerEnd = buffer.indexOf('\r\n\r\n')
                if (headerEnd < 0) {
                    if (buffer.length > 16 * 1024)
                        attempt.fail(new Error('HTTP proxy response header too large'))
                    return
                }
                const statusLine = buffer.subarray(0, headerEnd).toString('ascii').split('\r\n')[0]
                if (/^HTTP\/1\.[01] 200(?: |$)/.test(statusLine)) {
                    socket.pause()
                    socket.removeListener('data', onData)
                    socket.removeAllListeners('error')
                    const remainder = buffer.subarray(headerEnd + 4)
                    if (remainder.length) socket.unshift(remainder)
                    attempt.cleanup()
                    resolve(socket)
                } else {
                    attempt.fail(new Error(`HTTP proxy returned error: ${statusLine}`))
                }
            }

            socket.on('data', onData)
        })
    }
}
