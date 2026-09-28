export interface PinnableSnippet {
  pinnedAt?: string
}

/**
 * 置顶片段优先；多个置顶片段按最近置顶时间排列，其他片段保持原有顺序。
 */
export function sortSnippetsPinnedFirst<T extends PinnableSnippet>(snippets: readonly T[]): T[] {
  return snippets
    .map((snippet, index) => ({ snippet, index }))
    .sort((left, right) => {
      const leftPinnedAt = left.snippet.pinnedAt ? Date.parse(left.snippet.pinnedAt) : Number.NaN
      const rightPinnedAt = right.snippet.pinnedAt ? Date.parse(right.snippet.pinnedAt) : Number.NaN
      const leftPinned = Number.isFinite(leftPinnedAt)
      const rightPinned = Number.isFinite(rightPinnedAt)

      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1
      if (leftPinned && rightPinned && leftPinnedAt !== rightPinnedAt) {
        return rightPinnedAt - leftPinnedAt
      }
      return left.index - right.index
    })
    .map(({ snippet }) => snippet)
}
