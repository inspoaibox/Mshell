/**
 * VirtualTable 排序比较：字符串使用不区分大小写的自然排序（file2 < file10），
 * 数字和日期按数值比较，空值排在最后。
 */

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const isEmpty = (value: unknown) => value === undefined || value === null || value === ''

const toComparableNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (value instanceof Date) {
    const time = value.getTime()
    return Number.isFinite(time) ? time : undefined
  }
  return undefined
}

export const compareSortValues = (a: unknown, b: unknown): number => {
  const aEmpty = isEmpty(a)
  const bEmpty = isEmpty(b)
  if (aEmpty || bEmpty) {
    if (aEmpty && bEmpty) return 0
    return aEmpty ? 1 : -1
  }

  const aNumber = toComparableNumber(a)
  const bNumber = toComparableNumber(b)
  if (aNumber !== undefined && bNumber !== undefined) {
    return aNumber === bNumber ? 0 : aNumber > bNumber ? 1 : -1
  }

  return naturalCollator.compare(String(a), String(b))
}

/**
 * 生成行比较函数。rank 越小越靠前，且不受升降序影响（例如目录始终排在文件前面）；
 * rank 相同时再按 key 对应的值排序。
 */
export const createRowComparator = <T>(
  getValue: (row: T) => unknown,
  order: 'asc' | 'desc',
  rank?: (row: T) => number
) => {
  return (a: T, b: T): number => {
    if (rank) {
      const rankDiff = rank(a) - rank(b)
      if (rankDiff !== 0) return rankDiff
    }
    const comparison = compareSortValues(getValue(a), getValue(b))
    return order === 'asc' ? comparison : -comparison
  }
}
