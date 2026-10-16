import type { Socket } from 'net'
import type { ClientChannel } from 'ssh2'

// SSH direct-tcpip channels are duplex streams, not TCP sockets.
export type SSHTransport = Socket | ClientChannel

export interface ConnectionAttemptOptions {
  timeoutMs?: number
  signal?: AbortSignal
}
