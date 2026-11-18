import type { MpsProduct, MpsQuantityRow, MpsWorkflowInput } from './workflow.ts'

type PoolSource = 'history' | 'report' | 'opening-inventory' | 'capacity' | 'product-list'
type PoolKind = 'history' | 'report' | 'other'
export type MpsPoolException = MpsQuantityRow & { kind: PoolKind; source: PoolSource; reason: string }
const key = (row: Pick<MpsProduct, 'base' | 'code'>) => JSON.stringify([row.base, row.code])

export function mpsPoolExceptions(input: Pick<MpsWorkflowInput, 'context' | 'products' | 'report' | 'history' | 'openingInventory' | 'capacities'>) {
  const domain = new Set(input.products.filter(row => row.base && row.code).map(key))
  const references = new Set(
    input.products.filter(row => row.base && row.historyCode && row.historyCode !== row.code).map(row => key({ ...row, code: row.historyCode ?? row.code }))
  )
  const records: MpsPoolException[] = []
  const append = (row: MpsQuantityRow, source: PoolSource) => {
    if (row.month !== input.context.month || domain.has(key(row)) || references.has(key(row))) return
    const historyShipment = source === 'history' && row.quantity !== null && row.quantity !== 0
    const kind: PoolKind = source === 'report' ? 'report' : historyShipment ? 'history' : 'other'
    const reason =
      !row.base || !row.code
        ? '源记录缺基地或SKU，无法对应产品清单'
        : source === 'history' && !historyShipment
          ? row.quantity === 0
            ? '历史记录为真实零发货，SKU未列入该基地产品清单'
            : '历史发货数量缺失或无效，SKU未列入该基地产品清单'
          : source === 'opening-inventory'
            ? '期初库存SKU未列入该基地产品清单'
            : source === 'capacity'
              ? '产能来源SKU未列入该基地产品清单'
              : 'SKU未列入该基地产品清单'
    records.push({ ...row, kind, source, reason })
  }
  for (const row of input.products.filter(row => !row.base || !row.code)) append({ ...row, month: input.context.month, quantity: null }, 'product-list')
  for (const source of ['history', 'report'] as const) for (const row of input[source]) append(row, source)
  for (const row of input.openingInventory) append({ ...row, month: input.context.month }, 'opening-inventory')
  for (const row of input.capacities) append({ ...row, month: input.context.month, quantity: row.dailyPieces }, 'capacity')
  const grouped = new Map<string, MpsPoolException[]>()
  for (const row of records) grouped.set(key(row), [...(grouped.get(key(row)) ?? []), row])
  return {
    history: records.filter(row => row.kind === 'history'),
    report: records.filter(row => row.kind === 'report'),
    other: records.filter(row => row.kind === 'other'),
    total: [...grouped.values()].map(rows => ({
      base: rows[0].base,
      code: rows[0].code,
      categories: [...new Set(rows.map(row => row.kind))],
      sources: [...new Set(rows.map(row => row.source))],
      records: rows
    }))
  }
}
