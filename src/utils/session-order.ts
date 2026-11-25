// Sort a complete group before filtering so legacy positions remain stable during search.
export function sortSessions<T extends { isPinned?: boolean; sortOrder?: number }>(sessions: T[]): T[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const pinned = Number(b.session.isPinned === true) - Number(a.session.isPinned === true)
      const order = (session: T, index: number) =>
        Number.isFinite(session.sortOrder) ? session.sortOrder! : index
      return pinned || order(a.session, a.index) - order(b.session, b.index) || a.index - b.index
    })
    .map(({ session }) => session)
}
