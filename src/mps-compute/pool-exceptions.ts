import type { MpsProduct, MpsQuantityRow, MpsWorkflowInput } from './workflow.ts'

type PoolSource = 'history' | 'report' | 'opening-inventory' | 'capacity' | 'product-list'
type PoolKind = 'history' | 'report' | 'other'
export type MpsPoolException = MpsQuantityRow & { kind: PoolKind; source: PoolSource; reason: string }
const key = (row: Pick<MpsProduct, 'base' | 'code'>) => JSON.stringify([row.base, row.code])

export function historicalPool(products: MpsProduct[]) {
  const domain = new Set<string>()
  const references = new Map<string, Set<string>>()
  for (const product of products) {
    if (!product.base || !product.code) continue
    domain.add(key(product))
    if (!product.historyCode || product.historyCode === product.code) continue
    const id = key({ ...product, code: product.historyCode })
    const codes = references.get(id) ?? new Set<string>()
    codes.add(product.code)
    references.set(id, codes)
  }
  return {
    domain,
    references,
    includes: (row: Pick<MpsProduct, 'base' | 'code'>) => domain.has(key(row))
  }
}

export function mpsPoolExceptions(input: Pick<MpsWorkflowInput, 'context' | 'products' | 'report' | 'history' | 'openingInventory' | 'capacities'>) {
  const pool = historicalPool(input.products)
  const records: MpsPoolException[] = []
  const append = (row: MpsQuantityRow, source: PoolSource) => {
    const id = key(row)
    if (row.month !== input.context.month || (source === 'history' ? pool.includes(row) : pool.domain.has(id))) return
    const hasKey = Boolean(row.base && row.code)
    const historyShipment = source === 'history' && row.quantity !== null && row.quantity !== 0
    const kind: PoolKind = !hasKey ? 'other' : source === 'report' ? 'report' : historyShipment ? 'history' : 'other'
    const reason = !hasKey
      ? '源记录缺基地或SKU，无法对应产品清单'
      : source === 'history' && (pool.references.get(id)?.size ?? 0) > 1
        ? '本基地老品对应多个当前SKU，历史发货待核对'
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
  for (const row of records) {
    const id = key(row)
    const group = grouped.get(id)
    if (group) group.push(row)
    else grouped.set(id, [row])
  }
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
