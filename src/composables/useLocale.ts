import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

export function useLocale() {
  const { locale, t } = useI18n()

  /**
   * Format date according to current locale
   */
  const formatDate = (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...options
    }

    return new Intl.DateTimeFormat(locale.value, defaultOptions).format(dateObj)
  }

  /**
   * Format time according to current locale
   */
  const formatTime = (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...options
    }

    return new Intl.DateTimeFormat(locale.value, defaultOptions).format(dateObj)
  }

  /**
   * Format date and time according to current locale
   */
  const formatDateTime = (date: Date | string | number, options?: Intl.DateTimeFormatOptions): string => {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    
    const defaultOptions: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      ...options
    }

    return new Intl.DateTimeFormat(locale.value, defaultOptions).format(dateObj)
  }

  /**
   * Format number according to current locale
   */
  const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string => {
    return new Intl.NumberFormat(locale.value, options).format(value)
  }

  /**
   * Format bytes to human readable format
   */
  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (bytes === 0) return '0 B'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = locale.value === 'zh-CN' 
      ? ['字节', 'KB', 'MB', 'GB', 'TB', 'PB']
      : ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  /**
   * Format duration to human readable format
   */
  const formatDuration = (seconds: number): string => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (locale.value === 'zh-CN') {
      if (days > 0) return `${days}天 ${hours}小时`
      if (hours > 0) return `${hours}小时 ${minutes}分钟`
      if (minutes > 0) return `${minutes}分钟 ${secs}秒`
      return `${secs}秒`
    } else {
      if (days > 0) return `${days}d ${hours}h`
      if (hours > 0) return `${hours}h ${minutes}m`
      if (minutes > 0) return `${minutes}m ${secs}s`
      return `${secs}s`
    }
  }

  /**
   * Format relative time (e.g., "2 hours ago")
   */
  const formatRelativeTime = (date: Date | string | number): string => {
    const dateObj = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date
    const now = new Date()
    const diffMs = now.getTime() - dateObj.getTime()
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (locale.value === 'zh-CN') {
      if (diffSecs < 60) return '刚刚'
      if (diffMins < 60) return `${diffMins}分钟前`
      if (diffHours < 24) return `${diffHours}小时前`
      if (diffDays < 7) return `${diffDays}天前`
      return formatDate(dateObj)
    } else {
      if (diffSecs < 60) return 'just now'
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
      return formatDate(dateObj)
    }
  }

  /**
   * Get current locale
   */
  const currentLocale = computed(() => locale.value)

  /**
   * Check if current locale is Chinese
   */
  const isZhCN = computed(() => locale.value === 'zh-CN')

  /**
   * Check if current locale is English
   */
  const isEnUS = computed(() => locale.value === 'en-US')

  return {
    t,
    locale,
    currentLocale,
    isZhCN,
    isEnUS,
    formatDate,
    formatTime,
    formatDateTime,
    formatNumber,
    formatBytes,
    formatDuration,
    formatRelativeTime
  }
}
