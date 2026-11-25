import type { SessionGroup } from '../types/session'

// Missing order values in older configurations retain their original array order.
export function sortSessionGroups(groups: SessionGroup[]): SessionGroup[] {
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const pinned = Number(b.group.isPinned === true) - Number(a.group.isPinned === true)
      const order = (group: SessionGroup, fallback: number) =>
        Number.isFinite(group.sortOrder) ? group.sortOrder! : fallback
      return pinned || order(a.group, a.index) - order(b.group, b.index) || a.index - b.index
    })
    .map(({ group }) => group)
}
