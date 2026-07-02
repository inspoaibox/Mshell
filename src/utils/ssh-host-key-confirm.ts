import { h } from 'vue'
import { ElMessageBox } from 'element-plus'
import type { SessionConfig } from '@/types/session'

export interface HostKeyChallengeDetails {
  host: string
  port: number
  keyType?: string
  key: string
  fingerprint: string
  status: 'unknown' | 'changed'
  knownFingerprint?: string
  knownKeyType?: string
}

export interface TrustedHostKey {
  host: string
  port: number
  key?: string
  fingerprint: string
  keyType?: string
}

export interface ConnectResult {
  success: boolean
  error?: string
  userMessage?: string
  code?: string
  details?: HostKeyChallengeDetails
}

export function createSSHConnectOptions(
  session: SessionConfig,
  sshSettings: any = {},
  trustedHostKey?: TrustedHostKey
) {
  const authType =
    session.authType ||
    (session.privateKeyId || session.privateKeyPath || session.privateKey ? 'privateKey' : 'password')
  const usePrivateKey = authType === 'privateKey'

  return {
    host: session.host,
    port: session.port,
    username: session.username,
    authType,
    password: usePrivateKey ? undefined : session.password,
    privateKey: usePrivateKey
      ? session.privateKeyId
        ? undefined
        : session.privateKeyPath || session.privateKey
      : undefined,
    privateKeyId: usePrivateKey ? session.privateKeyId : undefined,
    passphrase: usePrivateKey ? session.passphrase : undefined,
    readyTimeout: (sshSettings.timeout || 30) * 1000,
    keepaliveInterval: sshSettings.keepalive
      ? (sshSettings.keepaliveInterval || 60) * 1000
      : undefined,
    keepaliveCountMax: sshSettings.keepalive ? 3 : undefined,
    autoReconnect: sshSettings.autoReconnect !== false,
    maxReconnectAttempts:
      sshSettings.autoReconnect === false ? 0 : sshSettings.maxReconnectAttempts || 3,
    reconnectInterval: (sshSettings.reconnectInterval || 5) * 1000,
    sessionName: session.name,
    proxyJump: session.proxyJump ? JSON.parse(JSON.stringify(session.proxyJump)) : undefined,
    proxy: session.proxy ? JSON.parse(JSON.stringify(session.proxy)) : undefined,
    trustedHostKey
  }
}

export function isHostKeyChallengeResult(
  result: ConnectResult
): result is ConnectResult & { details: HostKeyChallengeDetails } {
  return result.code === 'HOST_KEY_CHALLENGE_REQUIRED' && !!result.details
}

export function createTrustedHostKey(details: HostKeyChallengeDetails): TrustedHostKey {
  return {
    host: details.host,
    port: details.port,
    key: details.key,
    fingerprint: details.fingerprint,
    keyType: details.keyType
  }
}

export async function confirmHostKeyChallenge(
  details: HostKeyChallengeDetails,
  sessionName?: string
): Promise<boolean> {
  const isChanged = details.status === 'changed'
  const title = isChanged ? '服务器主机指纹已变化' : '确认新的 SSH 主机'
  const summary = isChanged
    ? '该主机保存过旧指纹，但这次连接返回了新的 SSH 主机指纹。'
    : '这是一个尚未信任的 SSH 主机，请确认后继续连接。'

  const message = h('div', { style: 'line-height: 1.7; word-break: break-all;' }, [
    h('p', { style: 'margin: 0 0 10px;' }, summary),
    h('p', { style: 'margin: 0;' }, `会话：${sessionName || details.host}`),
    h('p', { style: 'margin: 0;' }, `主机：${details.host}:${details.port}`),
    details.knownFingerprint
      ? h('p', { style: 'margin: 8px 0 0;' }, `旧指纹：${details.knownFingerprint}`)
      : null,
    h('p', { style: 'margin: 4px 0 0;' }, `新指纹：${details.fingerprint}`),
    h(
      'p',
      { style: 'margin: 12px 0 0; color: var(--el-text-color-secondary);' },
      isChanged
        ? '如果这是你刚重装系统或更换服务器后的连接，可以信任新指纹并继续。否则建议取消。'
        : '确认后会保存该主机指纹，并自动继续连接。'
    )
  ])

  try {
    await ElMessageBox.confirm(message, title, {
      type: isChanged ? 'warning' : 'info',
      confirmButtonText: '信任并连接',
      cancelButtonText: '取消',
      closeOnClickModal: false,
      distinguishCancelAndClose: true
    })
    return true
  } catch {
    return false
  }
}

export async function runWithHostKeyConfirmation<T extends ConnectResult>(
  connect: (trustedHostKey?: TrustedHostKey) => Promise<T>,
  sessionName?: string
): Promise<T> {
  const firstResult = await connect()
  if (!isHostKeyChallengeResult(firstResult)) {
    return firstResult
  }

  const confirmed = await confirmHostKeyChallenge(firstResult.details, sessionName)
  if (!confirmed) {
    return {
      ...firstResult,
      success: false,
      error: '已取消主机指纹确认',
      userMessage: '已取消主机指纹确认'
    }
  }

  return connect(createTrustedHostKey(firstResult.details))
}
