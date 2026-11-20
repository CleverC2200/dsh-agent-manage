import type { MpsWorkflowRow } from './workflow.ts'

export type MpsQuantityAdjustment = {
  month: string
  category: string
  quantity: number
} & (
  | { kind: 'category-total'; base?: string }
  | { kind: 'group-total'; group: string; base?: string }
  | { kind: 'group'; group: string }
  | { kind: 'sku'; group: string; code: string }
  | { kind: 'base-sku'; group: string; code: string; base: string }
)

export function adjustedQuantities(rows: MpsWorkflowRow[], edits: MpsQuantityAdjustment[]) {
  const result = new Map<string, number>()
  const used = new Set<string>()
  for (const edit of edits) {
    if (edit.kind === 'group' || edit.kind === 'sku') continue
    const group = 'group' in edit ? edit.group : undefined
    const code = edit.kind === 'base-sku' ? edit.code : undefined
    const id = JSON.stringify([edit.kind, edit.base, group, code])
    if (!Number.isFinite(edit.quantity) || edit.quantity < 0 || edit.quantity > Number.MAX_SAFE_INTEGER || used.has(id)) return null
    used.add(id)
    const matches = rows.filter(
      row => (edit.base === undefined || row.base === edit.base) && (group === undefined || row.group === group) && (code === undefined ? !row.delisted : row.code === code)
    )
    if (edit.kind === 'base-sku') {
      if (matches.length !== 1) return null
      result.set(matches[0].id, edit.quantity)
      continue
    }
    if (!matches.length) return null
    if (edit.quantity === 0) {
      for (const row of matches) result.set(row.id, 0)
      continue
    }
    if (matches.some(row => row.share === null || row.share < 0)) return null
    const weights = matches.reduce((sum, row) => sum + (row.share ?? 0), 0)
    if (!(weights > 0)) return null
    const residual = matches.findLast(row => row.fallback && (row.share ?? 0) > 0) ?? matches.findLast(row => (row.share ?? 0) > 0)
    if (!residual) return null
    let remaining = edit.quantity
    for (const row of matches) {
      if (row === residual) continue
      const allocated = edit.quantity * ((row.share ?? 0) / weights)
      result.set(row.id, allocated)
      remaining -= allocated
    }
    result.set(residual.id, Math.max(0, remaining))
  }
  return result
}
