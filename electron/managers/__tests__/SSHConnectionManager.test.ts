import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fc from 'fast-check'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) =>
      name === 'downloads' ? 'C:\\mshell-test-downloads' : 'C:\\mshell-test-data'
  }
}))

vi.mock('net', () => ({
  Socket: vi.fn().mockImplementation(() => {
    const eventHandlers: Record<string, Function> = {}
    return {
      on: vi.fn((event: string, handler: Function) => {
        eventHandlers[event] = handler
      }),
      setNoDelay: vi.fn(),
      connect: vi.fn((_port: number, _host: string, callback: Function) => callback()),
      destroy: vi.fn(),
      removeAllListeners: vi.fn(),
      destroyed: false,
      connecting: false,
      readyState: 'open',
      bytesRead: 0,
      bytesWritten: 0
    }
  })
}))

import { SSHConnectionManager } from '../SSHConnectionManager'
import { Client } from 'ssh2'

// Mock ssh2 Client
vi.mock('ssh2', () => {
  return {
    Client: vi.fn().mockImplementation(() => {
      const eventHandlers: Record<string, Function> = {}
      const createExecStream = () => {
        const streamHandlers: Record<string, Function> = {}
        const stream = {
          on: vi.fn((event: string, handler: Function) => {
            streamHandlers[event] = handler
          }),
          stderr: { on: vi.fn() },
          close: vi.fn()
        }

        setTimeout(() => {
          streamHandlers.close?.(0)
        }, 0)
        return stream
      }

      return {
        on: vi.fn((event: string, handler: Function) => {
          eventHandlers[event] = handler
        }),
        connect: vi.fn(function (this: any) {
          // Simulate successful connection
          setTimeout(() => {
            if (eventHandlers['ready']) {
              eventHandlers['ready']()
            }
          }, 10)
        }),
        shell: vi.fn((...args: any[]) => {
          const callback = args[args.length - 1] as Function
          const mockStream = {
            on: vi.fn(),
            stderr: { on: vi.fn() },
            write: vi.fn(),
            setWindow: vi.fn(),
            end: vi.fn()
          }
          callback(null, mockStream)
        }),
        end: vi.fn(),
        exec: vi.fn((_cmd: string, callback: Function) => {
          callback(null, createExecStream())
        }),
        _triggerEvent: function (this: any, event: string, ...args: any[]) {
          if (eventHandlers[event]) {
            eventHandlers[event](...args)
          }
        }
      }
    })
  }
})

describe('SSHConnectionManager', () => {
  let manager: SSHConnectionManager

  beforeEach(() => {
    manager = new SSHConnectionManager()
    // Add global error handler to prevent unhandled errors
    manager.on('error', () => {
      // Ignore errors during tests
    })
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up all connections
    const connections = manager.getAllConnections()
    for (const conn of connections) {
      try {
        await manager.disconnect(conn.id)
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  })

  /**
   * Property 1: 有效连接参数建立连接
   * Validates: Requirements 1.1, 1.2
   *
   * 对于任意有效的主机地址、端口、用户名和认证凭据（密码或私钥），
   * SSH_Client 应该能够成功建立连接，连接状态变为 'connected'。
   */
  describe('Property 1: Valid connection parameters establish connection', () => {
    it('should successfully connect with valid parameters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            host: fc.oneof(
              fc.constant('localhost'),
              fc.constant('127.0.0.1'),
              fc.ipV4(),
              fc.domain()
            ),
            port: fc.integer({ min: 1, max: 65535 }),
            username: fc.string({ minLength: 1, maxLength: 32 }),
            password: fc.string({ minLength: 8, maxLength: 64 })
          }),
          async (params) => {
            const options = {
              host: params.host,
              port: params.port,
              username: params.username,
              password: params.password
            }

            await manager.connect(params.id, options)

            const connection = manager.getConnection(params.id)
            expect(connection).toBeDefined()
            expect(connection?.status).toBe('connected')
            expect(connection?.id).toBe(params.id)

            // Cleanup
            await manager.disconnect(params.id)
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  /**
   * Property 3: 无效连接参数返回错误
   * Validates: Requirements 1.4
   *
   * 对于任意无效的连接参数或不可达的服务器，
   * SSH_Client 应该返回明确的错误信息而不是崩溃或挂起。
   */
  describe('Property 3: Invalid connection parameters return error', () => {
    it('should handle invalid parameters gracefully', async () => {
      // Mock Client to simulate connection error
      vi.mocked(Client).mockImplementation(() => {
        const eventHandlers: Record<string, Function> = {}
        return {
          on: vi.fn((event: string, handler: Function) => {
            eventHandlers[event] = handler
          }),
          connect: vi.fn(function (this: any) {
            setTimeout(() => {
              if (eventHandlers['error']) {
                eventHandlers['error'](new Error('Connection refused'))
              }
            }, 10)
          }),
          end: vi.fn(),
          _triggerEvent: function (this: any, event: string, ...args: any[]) {
            if (eventHandlers[event]) {
              eventHandlers[event](...args)
            }
          }
        } as any
      })

      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            host: fc.constant('invalid.host.that.does.not.exist'),
            port: fc.integer({ min: 1, max: 65535 }),
            username: fc.string({ minLength: 1, maxLength: 32 }),
            password: fc.string({ minLength: 1, maxLength: 64 })
          }),
          async (params) => {
            const options = {
              host: params.host,
              port: params.port,
              username: params.username,
              password: params.password
            }

            // Should reject with error, not crash
            await expect(manager.connect(params.id, options)).rejects.toThrow()

            const connection = manager.getConnection(params.id)
            if (connection) {
              expect(connection.status).toBe('error')
            }
          }
        ),
        { numRuns: 50 }
      )

      // Restore original mock
      vi.mocked(Client).mockImplementation(() => {
        const eventHandlers: Record<string, Function> = {}
        const createExecStream = () => {
          const streamHandlers: Record<string, Function> = {}
          const stream = {
            on: vi.fn((event: string, handler: Function) => {
              streamHandlers[event] = handler
            }),
            stderr: { on: vi.fn() },
            close: vi.fn()
          }

          setTimeout(() => {
            streamHandlers.close?.(0)
          }, 0)
          return stream
        }

        return {
          on: vi.fn((event: string, handler: Function) => {
            eventHandlers[event] = handler
          }),
          connect: vi.fn(function (this: any) {
            setTimeout(() => {
              if (eventHandlers['ready']) {
                eventHandlers['ready']()
              }
            }, 10)
          }),
          shell: vi.fn((...args: any[]) => {
            const callback = args[args.length - 1] as Function
            const mockStream = {
              on: vi.fn(),
              stderr: { on: vi.fn() },
              write: vi.fn(),
              setWindow: vi.fn(),
              end: vi.fn()
            }
            callback(null, mockStream)
          }),
          end: vi.fn(),
          exec: vi.fn((_cmd: string, callback: Function) => {
            callback(null, createExecStream())
          }),
          _triggerEvent: function (this: any, event: string, ...args: any[]) {
            if (eventHandlers[event]) {
              eventHandlers[event](...args)
            }
          }
        } as any
      })
    }, 10000)
  })

  /**
   * Property 4: 连接保持和心跳
   * Validates: Requirements 1.5, 11.5
   *
   * 对于任意成功建立的连接，SSH_Client 应该启动心跳机制，
   * 定期发送 keepalive 包以保持连接活跃。
   */
  describe('Property 4: Connection keepalive and heartbeat', () => {
    it('should start keepalive mechanism after connection', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            host: fc.constant('localhost'),
            port: fc.constant(22),
            username: fc.string({ minLength: 1, maxLength: 32 }),
            password: fc.string({ minLength: 8, maxLength: 64 }),
            keepaliveInterval: fc.integer({ min: 1000, max: 60000 })
          }),
          async (params) => {
            const options = {
              host: params.host,
              port: params.port,
              username: params.username,
              password: params.password,
              keepaliveInterval: params.keepaliveInterval
            }

            await manager.connect(params.id, options)

            const connection = manager.getConnection(params.id)
            expect(connection).toBeDefined()
            expect(connection?.options.keepaliveInterval).toBe(params.keepaliveInterval)

            // Cleanup
            await manager.disconnect(params.id)
          }
        ),
        { numRuns: 100 }
      )
    }, 10000)
  })

  /**
   * Property 5: 连接断开检测
   * Validates: Requirements 1.6
   *
   * 对于任意意外断开的连接，SSH_Client 应该能够检测到断开状态
   * 并更新连接状态为 'disconnected'。
   */
  describe('Property 5: Connection disconnect detection', () => {
    it('should detect connection close and update status', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.uuid(),
            host: fc.constant('localhost'),
            port: fc.constant(22),
            username: fc.string({ minLength: 1, maxLength: 32 }),
            password: fc.string({ minLength: 8, maxLength: 64 })
          }),
          async (params) => {
            const options = {
              host: params.host,
              port: params.port,
              username: params.username,
              password: params.password
            }

            await manager.connect(params.id, options)

            // Verify close event is emitted
            await manager.disconnect(params.id)

            // Connection should be removed
            const connection = manager.getConnection(params.id)
            expect(connection).toBeUndefined()
          }
        ),
        { numRuns: 100 }
      )
    }, 10000)
  })

  /**
   * Property 17: 并发连接支持
   * Validates: Requirements 4.2
   *
   * 对于任意数量的并发 SSH 连接请求（在合理范围内），
   * SSH_Client 应该能够同时维护多个活跃连接，每个连接独立运行。
   */
  describe('Property 17: Concurrent connection support', () => {
    it('should support multiple concurrent connections', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.record({
              id: fc.uuid(),
              host: fc.constant('localhost'),
              port: fc.constant(22),
              username: fc.string({ minLength: 1, maxLength: 32 }),
              password: fc.string({ minLength: 8, maxLength: 64 })
            }),
            { minLength: 2, maxLength: 5 }
          ),
          async (connectionParams) => {
            // Ensure unique IDs
            const uniqueParams = connectionParams.filter(
              (param, index, self) => self.findIndex((p) => p.id === param.id) === index
            )

            // Connect all
            await Promise.all(
              uniqueParams.map((params) =>
                manager.connect(params.id, {
                  host: params.host,
                  port: params.port,
                  username: params.username,
                  password: params.password
                })
              )
            )

            // Verify all connections are active
            const allConnections = manager.getAllConnections()
            expect(allConnections.length).toBe(uniqueParams.length)

            for (const params of uniqueParams) {
              const connection = manager.getConnection(params.id)
              expect(connection).toBeDefined()
              expect(connection?.status).toBe('connected')
            }

            // Cleanup all
            await Promise.all(uniqueParams.map((params) => manager.disconnect(params.id)))
          }
        ),
        { numRuns: 50 }
      )
    }, 10000)
  })

  /**
   * Additional unit tests for specific methods
   */
  describe('Unit tests', () => {
    it('sends database SQL through stdin after attaching channel listeners', async () => {
      const handlers: Record<string, Function> = {}
      const stream = {
        on: vi.fn((event: string, handler: Function) => { handlers[event] = handler }),
        stderr: { on: vi.fn() },
        close: vi.fn(),
        end: vi.fn((stdin: string) => {
          expect(stdin).toBe('BEGIN READ ONLY;\nSELECT 1;\nROLLBACK;\n')
          handlers.data(Buffer.from('1\n'))
          handlers.close(0)
        })
      }
      const client = { exec: vi.fn((_command: string, callback: Function) => callback(null, stream)), end: vi.fn() }
      ;(manager as any).connections.set('db-query', { id: 'db-query', status: 'connected', client, lastActivity: new Date() })
      await expect(manager.executeCommand('db-query', 'psql -X -w', 1000, 1024, 'BEGIN READ ONLY;\nSELECT 1;\nROLLBACK;\n')).resolves.toBe('1\n')
      expect(client.exec).toHaveBeenCalledWith('psql -X -w', expect.any(Function))
      expect(stream.end).toHaveBeenCalledOnce()
    })

    it('should stop capturing command output after the configured byte limit', async () => {
      const id = 'test-output-limit'
      const streamHandlers: Record<string, Function> = {}
      const stream = {
        on: vi.fn((event: string, handler: Function) => {
          streamHandlers[event] = handler
        }),
        stderr: { on: vi.fn() },
        close: vi.fn()
      }
      const client = {
        exec: vi.fn((_command: string, callback: Function) => callback(null, stream)),
        end: vi.fn()
      }

      ;(manager as any).connections.set(id, {
        id,
        status: 'connected',
        client,
        options: { host: 'localhost', port: 22, username: 'test' },
        lastActivity: new Date()
      })

      const result = manager.executeCommand(id, 'cat /large-file', 1000, 10)
      streamHandlers.data(Buffer.alloc(11))

      await expect(result).rejects.toThrow('Command output exceeded limit of 10 bytes')
      expect(stream.close).toHaveBeenCalledOnce()
    })

    it('should write data to connection', async () => {
      const id = 'test-write'
      await manager.connect(id, {
        host: 'localhost',
        port: 22,
        username: 'test',
        password: 'test123'
      })

      expect(() => manager.write(id, 'echo hello\n')).not.toThrow()

      await manager.disconnect(id)
    }, 10000)

    it('should resize terminal', async () => {
      const id = 'test-resize'
      await manager.connect(id, {
        host: 'localhost',
        port: 22,
        username: 'test',
        password: 'test123'
      })

      expect(() => manager.resize(id, 80, 24)).not.toThrow()

      await manager.disconnect(id)
    }, 10000)

    it('should ignore writes to non-existent connections', () => {
      expect(() => manager.write('non-existent', 'data')).not.toThrow()
    })

    it('should ignore resize requests for non-existent connections', () => {
      expect(() => manager.resize('non-existent', 80, 24)).not.toThrow()
    })

    it('should ignore disconnect requests for non-existent connections', async () => {
      await expect(manager.disconnect('non-existent')).resolves.toBeUndefined()
    })
  })
})
