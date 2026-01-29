import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomBytes, pbkdf2Sync } from 'crypto'
import { EventEmitter } from 'events'

/**
 * 锁定配置
 */
export interface LockConfig {
  enabled: boolean
  autoLockTimeout: number // 自动锁定超时时间（分钟），0表示禁用
  lockOnMinimize: boolean // 最小化时锁定
  lockOnSuspend: boolean // 系统休眠时锁定
  requirePasswordOnUnlock: boolean // 解锁时需要密码
  maxUnlockAttempts: number // 最大解锁尝试次数
  lockoutDuration: number // 锁定时长（分钟）
}

/**
 * 密码哈希信息
 */
interface PasswordHash {
  hash: string
  salt: string
  iterations: number
}

/**
 * SessionLockManager - 会话锁定管理器
 */
export class SessionLockManager extends EventEmitter {
  private configPath: string
  private passwordPath: string
  private config: LockConfig
  private passwordHash: PasswordHash | null = null
  private isLocked: boolean = false
  private lastActivityTime: number = Date.now()
  private autoLockTimer: NodeJS.Timeout | null = null
  private failedAttempts: number = 0
  private lockoutUntil: number = 0

  constructor() {
    super()
    const userDataPath = app.getPath('userData')
    this.configPath = join(userDataPath, 'lock-config.json')
    this.passwordPath = join(userDataPath, 'lock-password.json')

    // 加载配置
    this.config = this.loadConfig()
    this.passwordHash = this.loadPasswordHash()

    // 如果启用了密码保护且有密码，启动时自动锁定
    if (this.config.enabled && this.passwordHash) {
      this.isLocked = true
      console.log('[SessionLockManager] Password protection enabled, locking on startup')
    }

    // 启动自动锁定定时器
    if (this.config.enabled && this.config.autoLockTimeout > 0) {
      this.startAutoLockTimer()
    }

    // 监听系统事件
    this.setupSystemListeners()
  }

  /**
   * 加载配置
   */
  private loadConfig(): LockConfig {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (error) {
      console.error('Failed to load lock config:', error)
    }

    // 默认配置
    return {
      enabled: false,
      autoLockTimeout: 15, // 15分钟
      lockOnMinimize: false,
      lockOnSuspend: true,
      requirePasswordOnUnlock: true,
      maxUnlockAttempts: 5,
      lockoutDuration: 5 // 5分钟
    }
  }

  /**
   * 保存配置
   */
  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2))
    } catch (error) {
      console.error('Failed to save lock config:', error)
      throw error
    }
  }

  /**
   * 加载密码哈希
   */
  private loadPasswordHash(): PasswordHash | null {
    try {
      if (existsSync(this.passwordPath)) {
        const data = readFileSync(this.passwordPath, 'utf-8')
        return JSON.parse(data)
      }
    } catch (error) {
      console.error('Failed to load password hash:', error)
    }
    return null
  }

  /**
   * 保存密码哈希
   */
  private savePasswordHash(hash: PasswordHash): void {
    try {
      writeFileSync(this.passwordPath, JSON.stringify(hash, null, 2))
    } catch (error) {
      console.error('Failed to save password hash:', error)
      throw error
    }
  }

  /**
   * 设置密码
   */
  setPassword(password: string): void {
    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters')
    }

    const salt = randomBytes(32).toString('hex')
    const iterations = 100000
    const hash = pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex')

    this.passwordHash = { hash, salt, iterations }
    this.savePasswordHash(this.passwordHash)
  }

  /**
   * 验证密码
   */
  verifyPassword(password: string): boolean {
    if (!this.passwordHash) {
      return false
    }

    const { hash, salt, iterations } = this.passwordHash
    const inputHash = pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex')

    return hash === inputHash
  }

  /**
   * 检查是否有密码
   */
  hasPassword(): boolean {
    return this.passwordHash !== null
  }

  /**
   * 移除密码
   */
  removePassword(): void {
    this.passwordHash = null
    try {
      if (existsSync(this.passwordPath)) {
        const fs = require('fs')
        fs.unlinkSync(this.passwordPath)
      }
    } catch (error) {
      console.error('Failed to remove password:', error)
    }
  }

  /**
   * 获取配置
   */
  getConfig(): LockConfig {
    return { ...this.config }
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<LockConfig>): void {
    this.config = { ...this.config, ...updates }
    this.saveConfig()

    // 重启自动锁定定时器
    if (this.config.enabled && this.config.autoLockTimeout > 0) {
      this.startAutoLockTimer()
    } else {
      this.stopAutoLockTimer()
    }

    this.emit('config-updated', this.config)
  }

  /**
   * 锁定会话
   */
  lock(): void {
    if (this.isLocked) {
      return
    }

    this.isLocked = true
    this.emit('locked')

    // 通知所有窗口
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('session:locked')
    })
  }

  /**
   * 解锁会话
   */
  unlock(password?: string): { success: boolean; error?: string } {
    // 检查是否在锁定期内
    if (this.lockoutUntil > Date.now()) {
      const remainingMinutes = Math.ceil((this.lockoutUntil - Date.now()) / 60000)
      return {
        success: false,
        error: `Too many failed attempts. Please try again in ${remainingMinutes} minute(s).`
      }
    }

    // 如果需要密码验证
    if (this.config.requirePasswordOnUnlock && this.hasPassword()) {
      if (!password) {
        return { success: false, error: 'Password required' }
      }

      if (!this.verifyPassword(password)) {
        this.failedAttempts++

        // 检查是否达到最大尝试次数
        if (this.failedAttempts >= this.config.maxUnlockAttempts) {
          this.lockoutUntil = Date.now() + this.config.lockoutDuration * 60000
          this.failedAttempts = 0
          this.emit('lockout', this.config.lockoutDuration)
          return {
            success: false,
            error: `Too many failed attempts. Locked out for ${this.config.lockoutDuration} minutes.`
          }
        }

        this.emit('unlock-failed', this.failedAttempts)
        return {
          success: false,
          error: `Invalid password. ${this.config.maxUnlockAttempts - this.failedAttempts} attempts remaining.`
        }
      }
    }

    // 解锁成功
    this.isLocked = false
    this.failedAttempts = 0
    this.lastActivityTime = Date.now()
    this.emit('unlocked')

    // 通知所有窗口
    BrowserWindow.getAllWindows().forEach(window => {
      window.webContents.send('session:unlocked')
    })

    return { success: true }
  }

  /**
   * 检查是否锁定
   */
  isSessionLocked(): boolean {
    return this.isLocked
  }

  /**
   * 更新活动时间
   */
  updateActivity(): void {
    if (!this.isLocked) {
      this.lastActivityTime = Date.now()
    }
  }

  /**
   * 启动自动锁定定时器
   */
  private startAutoLockTimer(): void {
    this.stopAutoLockTimer()

    if (!this.config.enabled || this.config.autoLockTimeout <= 0) {
      return
    }

    // 每分钟检查一次
    this.autoLockTimer = setInterval(() => {
      if (this.isLocked) {
        return
      }

      const inactiveMinutes = (Date.now() - this.lastActivityTime) / 60000

      if (inactiveMinutes >= this.config.autoLockTimeout) {
        this.lock()
      }
    }, 60000) // 每分钟检查一次
  }

  /**
   * 停止自动锁定定时器
   */
  private stopAutoLockTimer(): void {
    if (this.autoLockTimer) {
      clearInterval(this.autoLockTimer)
      this.autoLockTimer = null
    }
  }

  /**
   * 设置系统监听器
   */
  private setupSystemListeners(): void {
    // 监听窗口最小化
    app.on('browser-window-blur', () => {
      if (this.config.enabled && this.config.lockOnMinimize) {
        // 检查是否所有窗口都最小化
        const allMinimized = BrowserWindow.getAllWindows().every(
          window => window.isMinimized() || !window.isVisible()
        )
        if (allMinimized) {
          this.lock()
        }
      }
    })

    // 监听系统休眠（需要 Electron 的 powerMonitor）
    const { powerMonitor } = require('electron')
    powerMonitor.on('suspend', () => {
      if (this.config.enabled && this.config.lockOnSuspend) {
        this.lock()
      }
    })
  }

  /**
   * 获取锁定状态信息
   */
  getStatus() {
    return {
      isLocked: this.isLocked,
      hasPassword: this.hasPassword(),
      config: this.config,
      lastActivityTime: this.lastActivityTime,
      inactiveMinutes: (Date.now() - this.lastActivityTime) / 60000,
      isLockedOut: this.lockoutUntil > Date.now(),
      lockoutRemainingMinutes: this.lockoutUntil > Date.now()
        ? Math.ceil((this.lockoutUntil - Date.now()) / 60000)
        : 0
    }
  }

  /**
   * 清理
   */
  cleanup(): void {
    this.stopAutoLockTimer()
  }
}

// 导出单例
export const sessionLockManager = new SessionLockManager()
