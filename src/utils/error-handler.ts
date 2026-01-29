import { ElMessage, ElNotification } from 'element-plus'

export interface ErrorResponse {
  success: false
  error: string
  type?: string
  code?: string
  userMessage?: string
}

export class FrontendErrorHandler {
  /**
   * 处理 API 错误响应
   */
  static handleApiError(response: ErrorResponse, context?: string) {
    const message = response.userMessage || response.error || '操作失败'
    
    // 根据错误类型选择不同的展示方式
    if (response.type === 'validation') {
      ElMessage.warning(message)
    } else if (response.type === 'authentication') {
      ElNotification.error({
        title: '认证失败',
        message: message,
        duration: 5000
      })
    } else if (response.type === 'connection') {
      ElNotification.error({
        title: '连接错误',
        message: message,
        duration: 5000
      })
    } else if (response.type === 'timeout') {
      ElMessage.error({
        message: message,
        duration: 3000
      })
    } else {
      ElMessage.error(message)
    }
    
    // 记录到控制台
    if (context) {
      console.error(`[${context}] Error:`, response)
    }
  }
  
  /**
   * 处理未捕获的错误
   */
  static handleUnexpectedError(error: Error, context?: string) {
    console.error(`[${context || 'Unexpected'}] Error:`, error)
    ElMessage.error('发生意外错误，请重试')
  }
  
  /**
   * 安全执行异步操作
   */
  static async safeExecute<T>(
    fn: () => Promise<T>,
    context?: string,
    onError?: (error: Error) => void
  ): Promise<T | null> {
    try {
      return await fn()
    } catch (error) {
      this.handleUnexpectedError(error as Error, context)
      onError?.(error as Error)
      return null
    }
  }
  
  /**
   * 检查响应并处理错误
   */
  static checkResponse<T>(
    response: { success: boolean; data?: T; error?: string; userMessage?: string; type?: string; code?: string },
    context?: string
  ): T | null {
    if (response.success && response.data !== undefined) {
      return response.data
    }
    
    this.handleApiError(response as ErrorResponse, context)
    return null
  }
}

// 便捷函数
export const handleApiError = FrontendErrorHandler.handleApiError.bind(FrontendErrorHandler)
export const handleUnexpectedError = FrontendErrorHandler.handleUnexpectedError.bind(FrontendErrorHandler)
export const safeExecute = FrontendErrorHandler.safeExecute.bind(FrontendErrorHandler)
export const checkResponse = FrontendErrorHandler.checkResponse.bind(FrontendErrorHandler)
