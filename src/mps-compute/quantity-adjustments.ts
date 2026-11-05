import type { MpsQuantity, MpsWorkflowRow } from './workflow.ts'

export type MpsQuantityAdjustment = {
  month: string
  category: string
  group: string
  quantity: number
} & ({ kind: 'group' } | { kind: 'sku'; code: string } | { kind: 'base-sku'; code: string; base: string })

type Node = { rows: MpsWorkflowRow[]; children: Node[]; fixed: number | undefined; weight: number }

export function adjustedQuantities(rows: MpsWorkflowRow[], total: MpsQuantity, edits: MpsQuantityAdjustment[]) {
  if (total === null || rows.some(row => row.share === null)) return null
  const used = new Set<MpsQuantityAdjustment>()
  let valid = true
  const node = (entries: MpsWorkflowRow[], level: 'group' | 'sku' | 'base-sku'): Node => {
    const first = entries[0]
    const matches = edits.filter(
      edit => edit.kind === level && edit.group === first.group && (edit.kind === 'group' || edit.code === first.code) && (edit.kind !== 'base-sku' || edit.base === first.base)
    )
    matches.forEach(edit => used.add(edit))
    if (matches.length > 1 || matches.some(edit => !Number.isFinite(edit.quantity) || edit.quantity < 0 || edit.quantity > Number.MAX_SAFE_INTEGER)) valid = false
    const children: Node[] = []
    if (level !== 'base-sku') {
      const keys = [...new Set(entries.map(row => (level === 'group' ? row.code : row.base)))]
      for (const key of keys)
        children.push(
          node(
            entries.filter(row => (level === 'group' ? row.code : row.base) === key),
            level === 'group' ? 'sku' : 'base-sku'
          )
        )
    } else if (entries.length !== 1) valid = false
    return { rows: entries, children, fixed: matches[0]?.quantity, weight: entries.reduce((sum, row) => sum + (row.share ?? 0), 0) }
  }
  const groups = [...new Set(rows.map(row => row.group))].map(group =>
    node(
      rows.filter(row => row.group === group),
      'group'
    )
  )
  if (!valid || used.size !== edits.length) return null
  const result = new Map<string, number>()
  const distribute = (nodes: Node[], amount: number): boolean => {
    const fixed = nodes.filter(node => node.fixed !== undefined)
    const flexible = nodes.filter(node => node.fixed === undefined)
    const residual = amount - fixed.reduce((sum, node) => sum + (node.fixed ?? 0), 0)
    const tolerance = Number.EPSILON * Math.max(1, amount) * Math.max(1, nodes.length) * 4
    const remaining = Math.max(0, residual)
    const weight = flexible.reduce((sum, node) => sum + node.weight, 0)
    if (residual < -tolerance || ((!flexible.length || weight === 0) && remaining > tolerance)) return false
    const last = flexible.findLast(node => node.weight > 0)
    let allocated = 0
    for (const node of nodes) {
      const quantity = node.fixed ?? (node === last ? remaining - allocated : weight === 0 ? 0 : (remaining * node.weight) / weight)
      if (node.fixed === undefined) allocated += quantity
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > Number.MAX_SAFE_INTEGER) return false
      if (node.children.length) {
        if (!distribute(node.children, quantity)) return false
      } else result.set(node.rows[0].id, quantity)
    }
    return true
  }
  return distribute(groups, total) ? result : null
}
