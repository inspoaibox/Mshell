import type { PortEntry, PortExposure, PortProcess, PortProtocol } from '../types/ports'

const SERVICE_NAME = /^[A-Za-z0-9@._:-]+\.service$/
const CRITICAL_SERVICE = /^(sshd?|systemd-.*|dbus|dbus-broker|polkit)\.service$/

/** 可以通过 systemctl stop 停止的服务（排除用户会话管理器） */
export const isStoppableUnit = (unit: string | undefined): unit is string =>
  !!unit && SERVICE_NAME.test(unit) && !unit.startsWith('user@') && !unit.startsWith('session-')

export const isCriticalUnit = (unit: string): boolean => CRITICAL_SERVICE.test(unit)

export const isDockerProxy = (process: Pick<PortProcess, 'name' | 'command'>): boolean =>
  /(^|\/)docker-proxy$/.test(process.name) || /(^|\/)docker-proxy(\s|$)/.test(process.command)

/** 端口不能直接关闭的原因；可以关闭时返回 undefined */
export const closeBlockReason = (entry: PortEntry): string | undefined => {
  if (entry.isSshPort) return '当前 SSH 连接正在使用该端口，关闭会断开连接'
  if (entry.processHidden || !entry.processes.length) {
    return '占用进程不可见，需要 root 或免密 sudo 权限'
  }
  if (entry.containers.length || entry.processes.some(isDockerProxy)) {
    return '该端口由 Docker 发布，请在 Docker 管理中停止对应容器'
  }
  if (entry.rootPids.includes(1)) return '由 PID 1（init/systemd）直接监听，无法结束'
  return undefined
}

/** 主进程所属的唯一 systemd 服务（可停止时返回） */
export const stoppableUnitOf = (entry: PortEntry): string | undefined => {
  const units = [
    ...new Set(
      entry.processes.filter((item) => entry.rootPids.includes(item.pid)).map((item) => item.unit)
    )
  ]
  const unit = units.length === 1 ? units[0] : undefined
  return isStoppableUnit(unit) && !isCriticalUnit(unit) ? unit : undefined
}

export interface PortFilter {
  keyword: string
  protocol: 'all' | PortProtocol
  /** any：不限；其余为 PortExposure */
  exposure: 'any' | PortExposure
}

/**
 * 搜索：端口号精确匹配、`8000-9000` 范围、或按进程名 / PID / 用户 / 地址 / 命令 / 服务 / 容器模糊匹配。
 */
export const filterPorts = (ports: PortEntry[], filter: PortFilter): PortEntry[] => {
  const keyword = filter.keyword.trim().toLowerCase()
  const range = keyword.match(/^(\d{1,5})\s*-\s*(\d{1,5})$/)
  const exactPort = /^\d{1,5}$/.test(keyword) ? Number(keyword) : undefined
  return ports.filter((entry) => {
    if (filter.protocol !== 'all' && entry.protocol !== filter.protocol) return false
    if (filter.exposure !== 'any' && entry.exposure !== filter.exposure) return false
    if (!keyword) return true
    if (range) {
      const [low, high] = [Number(range[1]), Number(range[2])].sort((a, b) => a - b)
      return entry.port >= low && entry.port <= high
    }
    if (exactPort !== undefined && entry.port === exactPort) return true
    const haystack = [
      String(entry.port),
      entry.protocol,
      ...entry.addresses,
      ...entry.containers,
      ...entry.processes.flatMap((item) => [
        item.name,
        String(item.pid),
        item.user,
        item.command,
        item.unit || ''
      ])
    ]
      .join('\n')
      .toLowerCase()
    return exactPort !== undefined
      ? haystack.split('\n').some((value) => value === keyword)
      : haystack.includes(keyword)
  })
}

export const formatRss = (kb?: number): string => {
  if (kb === undefined || !Number.isFinite(kb)) return '-'
  if (kb < 1024) return `${kb} KB`
  if (kb < 1024 * 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${(kb / 1024 / 1024).toFixed(2)} GB`
}

/** 把 ps 的 etime（[[DD-]hh:]mm:ss）转换为中文时长 */
export const formatElapsed = (etime: string): string => {
  const match = etime.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!match) return etime || '-'
  const [, days, hours, minutes] = match
  if (days) return `${Number(days)} 天 ${Number(hours || 0)} 小时`
  if (hours) return `${Number(hours)} 小时 ${Number(minutes)} 分`
  return `${Number(minutes)} 分钟`
}

export const exposureLabel: Record<PortExposure, string> = {
  all: '对外开放',
  local: '仅本机',
  specific: '指定地址'
}
