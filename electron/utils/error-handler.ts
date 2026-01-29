import { logger } from './logger'

/**
 * 错误类型枚举
 */
export enum ErrorType {
  CONNECTION = 'connection',
  AUTHENTICATION = 'authentication',
  SFTP = 'sftp',
  PORT_FORWARD = 'port-forward',
  FILE_SYSTEM = 'file-system',
  NETWORK = 'network',
  VALIDATION = 'validation',
  PERMISSION = 'permission',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * 应用错误类
 */
export class AppError extends Error {
  public readonly type: ErrorType
  public readonly code?: string
  public readonly details?: any
  public readonly userMessage: string

  constructor(
    type: ErrorType,
    message: string,
    userMessage?: string,
    code?: string,
    details?: any
  ) {
    super(message)
    this.name = 'AppError'
    this.type = type
    this.code = code
    this.details = details
    this.userMessage = userMessage || this.getDefaultUserMessage(type)
    
    // 维护正确的堆栈跟踪
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError)
    }
  }

  /**
   * 获取默认用户提示消息
   */
  private getDefaultUserMessage(type: ErrorType): string {
    const messages: Record<ErrorType, string> = {
      [ErrorType.CONNECTION]: '连接失败，请检查网络和服务器配置',
      [ErrorType.AUTHENTICATION]: '认证失败，请检查用户名和密码',
      [ErrorType.SFTP]: 'SFTP 操作失败',
      [ErrorType.PORT_FORWARD]: '端口转发失败',
      [ErrorType.FILE_SYSTEM]: '文件操作失败',
      [ErrorType.NETWORK]: '网络错误',
      [ErrorType.VALIDATION]: '输入验证失败',
      [ErrorType.PERMISSION]: '权限不足',
      [ErrorType.TIMEOUT]: '操作超时',
      [ErrorType.UNKNOWN]: '未知错误'
    }
    return messages[type] || messages[ErrorType.UNKNOWN]
  }

  /**
   * 转换为 JSON 对象（用于 IPC 传输）
   */
  toJSON() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      userMessage: this.userMessage,
      code: this.code,
      details: this.details,
      stack: this.stack
    }
  }
}

/**
 * 错误处理器类
 */
export class ErrorHandler {
  /**
   * 处理错误并记录日志
   */
  static handle(error: Error | AppError, context?: string): AppError {
    // 如果已经是 AppError，直接返回
    if (error instanceof AppError) {
      this.logError(error, context)
      return error
    }

    // 转换为 AppError
    const appError = this.convertToAppError(error)
    this.logError(appError, context)
    return appError
  }

  /**
   * 将普通错误转换为 AppError
   */
  static convertToAppError(error: Error): AppError {
    const message = error.message.toLowerCase()

    // SSH 连接错误
    if (message.includes('econnrefused') || message.includes('connection refused')) {
      return new AppError(
        ErrorType.CONNECTION,
        error.message,
        '无法连接到服务器，请检查主机地址和端口',
        'ECONNREFUSED'
      )
    }

    if (message.includes('etimedout') || message.includes('timeout')) {
      return new AppError(
        ErrorType.TIMEOUT,
        error.message,
        '连接超时，请检查网络或增加超时时间',
        'ETIMEDOUT'
      )
    }

    if (message.includes('ehostunreach') || message.includes('host unreachable')) {
      return new AppError(
        ErrorType.NETWORK,
        error.message,
        '无法访问主机，请检查网络连接',
        'EHOSTUNREACH'
      )
    }

    // 认证错误
    if (message.includes('authentication') || message.includes('auth')) {
      return new AppError(
        ErrorType.AUTHENTICATION,
        error.message,
        '认证失败，请检查用户名、密码或密钥',
        'AUTH_FAILED'
      )
    }

    if (message.includes('permission denied')) {
      return new AppError(
        ErrorType.PERMISSION,
        error.message,
        '权限被拒绝，请检查用户权限',
        'PERMISSION_DENIED'
      )
    }

    // 文件系统错误
    if (message.includes('enoent') || message.includes('no such file')) {
      return new AppError(
        ErrorType.FILE_SYSTEM,
        error.message,
        '文件或目录不存在',
        'ENOENT'
      )
    }

    if (message.includes('eacces') || message.includes('access denied')) {
      return new AppError(
        ErrorType.PERMISSION,
        error.message,
        '没有访问权限',
        'EACCES'
      )
    }

    // SFTP 错误
    if (message.includes('sftp')) {
      return new AppError(
        ErrorType.SFTP,
        error.message,
        'SFTP 操作失败，请重试',
        'SFTP_ERROR'
      )
    }

    // 默认未知错误
    return new AppError(
      ErrorType.UNKNOWN,
      error.message,
      '操作失败，请重试或联系支持',
      'UNKNOWN'
    )
  }

  /**
   * 记录错误日志
   */
  private static logError(error: AppError, context?: string): void {
    const category = this.getCategoryFromType(error.type)
    const message = context ? `[${context}] ${error.message}` : error.message
    
    try {
      logger.logError(category, message, error)
    } catch (logError) {
      // 如果日志记录失败，至少输出到控制台
      console.error('[ErrorHandler] Failed to log error:', logError)
      console.error('[ErrorHandler] Original error:', error)
    }
  }

  /**
   * 从错误类型获取日志分类
   */
  private static getCategoryFromType(type: ErrorType): 'connection' | 'sftp' | 'system' | 'session' {
    switch (type) {
      case ErrorType.CONNECTION:
      case ErrorType.AUTHENTICATION:
      case ErrorType.NETWORK:
      case ErrorType.TIMEOUT:
        return 'connection'
      case ErrorType.SFTP:
        return 'sftp'
      case ErrorType.PORT_FORWARD:
        return 'session'
      default:
        return 'system'
    }
  }

  /**
   * 创建连接错误
   */
  static createConnectionError(message: string, details?: any): AppError {
    return new AppError(ErrorType.CONNECTION, message, undefined, undefined, details)
  }

  /**
   * 创建认证错误
   */
  static createAuthError(message: string, details?: any): AppError {
    return new AppError(ErrorType.AUTHENTICATION, message, undefined, undefined, details)
  }

  /**
   * 创建 SFTP 错误
   */
  static createSFTPError(message: string, details?: any): AppError {
    return new AppError(ErrorType.SFTP, message, undefined, undefined, details)
  }

  /**
   * 创建验证错误
   */
  static createValidationError(message: string, userMessage: string): AppError {
    return new AppError(ErrorType.VALIDATION, message, userMessage, 'VALIDATION_ERROR')
  }
}

/**
 * 全局错误处理函数
 */
export function handleError(error: Error | AppError, context?: string): AppError {
  return ErrorHandler.handle(error, context)
}

/**
 * 安全执行异步函数，自动处理错误
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  context?: string,
  fallback?: T
): Promise<T | undefined> {
  try {
    return await fn()
  } catch (error) {
    handleError(error as Error, context)
    return fallback
  }
}

/**
 * 安全执行同步函数，自动处理错误
 */
export function safeExecuteSync<T>(
  fn: () => T,
  context?: string,
  fallback?: T
): T | undefined {
  try {
    return fn()
  } catch (error) {
    handleError(error as Error, context)
    return fallback
  }
}
