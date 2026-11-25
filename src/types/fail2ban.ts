export interface Fail2BanEnvironment {
  osId: string
  osName: string
  versionId: string
  packageManager: string
  needsPrivilege: boolean
  canSudo: boolean
}

export interface Fail2BanJail {
  name: string
  currentlyFailed: number
  totalFailed: number
  currentlyBanned: number
  totalBanned: number
  bannedIps: string[]
}

export interface Fail2BanOverview {
  installed: boolean
  version: string
  serviceStatus: string
  serviceError?: string
  running: boolean
  enabled: boolean
  environment: Fail2BanEnvironment
  jails: Fail2BanJail[]
  totalCurrentlyBanned: number
  totalBanned: number
  totalFailed: number
  warnings: string[]
  capturedAt: number
}

export interface Fail2BanOperationResult {
  output: string
  overview?: Fail2BanOverview
}
