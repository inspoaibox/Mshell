import { describe, expect, it } from 'vitest'
import { compareSortValues, createRowComparator } from '../virtual-table-sort'

describe('virtual-table-sort', () => {
  it('sorts names naturally and case-insensitively', () => {
    const names = ['file10.txt', 'File2.txt', 'file1.txt', 'apple']
    expect([...names].sort(compareSortValues)).toEqual([
      'apple',
      'file1.txt',
      'File2.txt',
      'file10.txt'
    ])
  })

  it('compares numbers and dates numerically and puts empty values last', () => {
    expect([10, 9, 100].sort(compareSortValues)).toEqual([9, 10, 100])
    expect(compareSortValues(new Date(1000), new Date(2000))).toBeLessThan(0)
    expect([null, 3, 1].sort(compareSortValues)).toEqual([1, 3, null])
    expect(compareSortValues(undefined, 'a')).toBeGreaterThan(0)
  })

  it('keeps ranked rows first in both directions', () => {
    const rows = [
      { name: 'b.txt', dir: false },
      { name: 'Zeta', dir: true },
      { name: 'a.txt', dir: false },
      { name: 'alpha', dir: true }
    ]
    type Row = { name: string; dir: boolean }
    const rank = (row: Row) => (row.dir ? 0 : 1)
    const asc = [...rows].sort(createRowComparator((row: Row) => row.name, 'asc', rank))
    expect(asc.map((row) => row.name)).toEqual(['alpha', 'Zeta', 'a.txt', 'b.txt'])
    const desc = [...rows].sort(createRowComparator((row: Row) => row.name, 'desc', rank))
    expect(desc.map((row) => row.name)).toEqual(['Zeta', 'alpha', 'b.txt', 'a.txt'])
  })
})
