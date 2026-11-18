import type { MpsWorkflowRow } from './workflow.ts'

export type MpsQuantityAdjustment = {
  month: string
  category: string
  group: string
  quantity: number
} & ({ kind: 'group' } | { kind: 'sku'; code: string } | { kind: 'base-sku'; code: string; base: string })

export function adjustedQuantities(rows: MpsWorkflowRow[], edits: MpsQuantityAdjustment[]) {
  const result = new Map(rows.map(row => [row.id, row.demand]))
  const used = new Set<string>()
  for (const edit of edits) {
    if (edit.kind !== 'base-sku' || !Number.isFinite(edit.quantity) || edit.quantity < 0 || edit.quantity > Number.MAX_SAFE_INTEGER) return null
    const matches = rows.filter(row => row.base === edit.base && row.code === edit.code && row.group === edit.group)
    if (matches.length !== 1 || used.has(matches[0].id)) return null
    used.add(matches[0].id)
    result.set(matches[0].id, edit.quantity)
  }
  return result
}
