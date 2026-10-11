import type { SessionConfig, SessionGroup } from '@/types/session'

export interface MobileSnippet {
  id: string
  name: string
  command: string
  description: string
  category: string
  tags: string[]
  variables: string[]
  shortcut?: string
  usageCount: number
  createdAt: string
  updatedAt: string
}

export interface MobileSSHKey {
  id: string
  name: string
  type: 'rsa' | 'ed25519' | 'ecdsa'
  bits?: number
  publicKey: string
  fingerprint: string
  comment?: string
  createdAt: string
  lastUsed?: string
  updatedAt?: string
  usageCount: number
  protected: boolean
  privateKeyContent?: string
  publicKeyContent?: string
}

export interface MobileQuickCommand {
  id: string
  name: string
  command: string
  description?: string
  category?: string
  tags?: string[]
  usageCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface MobileBackupData {
  version: string
  timestamp: string
  sessions?: SessionConfig[]
  sessionGroups?: SessionGroup[]
  snippets?: MobileSnippet[]
  quickCommands?: MobileQuickCommand[]
  sshKeys?: MobileSSHKey[]
  commandHistory?: unknown[]
  portForwards?: unknown[]
  portForwardTemplates?: unknown[]
  sessionTemplates?: unknown[]
  scheduledTasks?: unknown[]
  workflows?: unknown[]
  settings?: Record<string, unknown>
  backupConfig?: Record<string, unknown>
  syncConfig?: Record<string, unknown>
  aiConfig?: unknown
  aiChatHistory?: unknown[]
  aiTerminalChatHistory?: Record<string, unknown[]>
  connectionStats?: unknown[]
  auditLogs?: unknown[]
  transferRecords?: unknown[]
  lockConfig?: Record<string, unknown>
}

export interface MobileStoreState {
  sessions: SessionConfig[]
  sessionGroups: SessionGroup[]
  snippets: MobileSnippet[]
  sshKeys: MobileSSHKey[]
  syncConfig?: MobileSyncConfig
  lastImportedAt?: string
}

export interface MobileSyncConfig {
  enabled: boolean
  provider: 'github' | 'gitlab'
  remoteUrl: string
  token: string
  password: string
  lastSyncAt?: string
  lastUploadAt?: string
  lastDownloadAt?: string
  lastSyncChecksum?: string
}

export interface MobileSshConnectOptions {
  session: SessionConfig
  privateKey?: string
}

export interface MobileSshBridge {
  connect: (
    options: MobileSshConnectOptions
  ) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  disconnect: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  execute: (
    sessionId: string,
    command: string
  ) => Promise<{ success: boolean; output?: string; error?: string }>
  openShell?: (
    sessionId: string,
    size?: { cols?: number; rows?: number }
  ) => Promise<{ success: boolean; output?: string; error?: string }>
  writeShell?: (
    sessionId: string,
    data: string
  ) => Promise<{ success: boolean; output?: string; error?: string }>
  closeShell?: (sessionId: string) => Promise<{ success: boolean; error?: string }>
}

declare global {
  interface Window {
    mshellAndroidSsh?: MobileSshBridge
  }
}
