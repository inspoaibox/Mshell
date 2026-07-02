import type { SessionConfig } from '@/types/session'
import { registerPlugin } from '@capacitor/core'
import type { MobileSSHKey } from '../types'

export interface SshRunResult {
  success: boolean
  sessionId?: string
  output?: string
  error?: string
}

type NativeResult = {
  success: boolean
  sessionId?: string
  output?: string
  error?: string
}

interface MshellSshPlugin {
  connect(options: { session: SessionConfig; privateKey?: string }): Promise<NativeResult>
  execute(options: { sessionId: string; command: string }): Promise<NativeResult>
  openShell(options: { sessionId: string; cols?: number; rows?: number }): Promise<NativeResult>
  writeShell(options: { sessionId: string; data: string }): Promise<NativeResult>
  closeShell(options: { sessionId: string }): Promise<NativeResult>
  disconnect(options: { sessionId: string }): Promise<NativeResult>
  addListener(
    eventName: 'shellData',
    listener: (event: { sessionId: string; data: string }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const MshellSsh = registerPlugin<MshellSshPlugin>('MshellSsh')

const toNativeResult = (error: unknown): NativeResult => ({
  success: false,
  error: error instanceof Error ? error.message : 'Android SSH 原生桥接尚未接入'
})

export const installAndroidSshBridge = (): void => {
  if (window.mshellAndroidSsh) {
    return
  }

  window.mshellAndroidSsh = {
    connect: (options) => MshellSsh.connect(options).catch(toNativeResult),
    execute: (sessionId, command) =>
      MshellSsh.execute({ sessionId, command }).catch(toNativeResult),
    disconnect: (sessionId) => MshellSsh.disconnect({ sessionId }).catch(toNativeResult)
  }
}

export const connectAndRunCommand = async (
  session: SessionConfig,
  command: string,
  keys: MobileSSHKey[]
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  const connectResult = await bridge.connect({
    session,
    privateKey: resolvePrivateKey(session, keys)
  })

  if (!connectResult.success || !connectResult.sessionId) {
    return { success: false, error: connectResult.error || 'SSH 连接失败' }
  }

  try {
    return await bridge.execute(connectResult.sessionId, command)
  } finally {
    await bridge.disconnect(connectResult.sessionId)
  }
}

export const connectToSession = async (
  session: SessionConfig,
  keys: MobileSSHKey[]
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  const connectResult = await bridge.connect({
    session,
    privateKey: resolvePrivateKey(session, keys)
  })

  if (!connectResult.success || !connectResult.sessionId) {
    return { success: false, error: connectResult.error || 'SSH 连接失败' }
  }

  await bridge.disconnect(connectResult.sessionId)
  return { success: true, sessionId: connectResult.sessionId }
}

export const openSshSession = async (
  session: SessionConfig,
  keys: MobileSSHKey[]
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  const connectResult = await bridge.connect({
    session,
    privateKey: resolvePrivateKey(session, keys)
  })

  if (!connectResult.success || !connectResult.sessionId) {
    return { success: false, error: connectResult.error || 'SSH 连接失败' }
  }

  return { success: true, sessionId: connectResult.sessionId }
}

export const executeSshCommand = async (
  sessionId: string,
  command: string
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  return bridge.execute(sessionId, command)
}

export const openSshShell = async (
  sessionId: string,
  size: { cols?: number; rows?: number } = {}
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  return MshellSsh.openShell({ sessionId, cols: size.cols, rows: size.rows }).catch(toNativeResult)
}

export const writeSshShell = async (
  sessionId: string,
  data: string
): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  return MshellSsh.writeShell({ sessionId, data }).catch(toNativeResult)
}

export const closeSshShell = async (sessionId: string): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  return MshellSsh.closeShell({ sessionId }).catch(toNativeResult)
}

export const onSshShellData = (
  listener: (event: { sessionId: string; data: string }) => void
): Promise<{ remove: () => Promise<void> }> => MshellSsh.addListener('shellData', listener)

export const disconnectSshSession = async (sessionId: string): Promise<SshRunResult> => {
  installAndroidSshBridge()

  const bridge = window.mshellAndroidSsh
  if (!bridge) {
    return missingBridgeResult()
  }

  return bridge.disconnect(sessionId)
}

const resolvePrivateKey = (session: SessionConfig, keys: MobileSSHKey[]): string | undefined => {
  if (session.authType !== 'privateKey') {
    return undefined
  }

  const key = session.privateKeyId
    ? keys.find((item) => item.id === session.privateKeyId)
    : undefined
  return (
    key?.privateKeyContent ||
    (typeof session.privateKey === 'string' && session.privateKey.includes('PRIVATE KEY')
      ? session.privateKey
      : undefined)
  )
}

const missingBridgeResult = (): SshRunResult => ({
  success: false,
  error: 'Android SSH 原生桥接不可用，请确认安装的是最新 Android APK'
})
