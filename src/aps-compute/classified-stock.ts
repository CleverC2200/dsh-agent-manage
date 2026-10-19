import type { MetricData } from './metrics.js'
import type { Scope } from './adapter.js'

/** Display-only observation. Missing classification never yields a complete total or comparison. */
export function classifiedStockObservation(data: MetricData | null | undefined, scope: Scope) {
  const section = data?.sections.find(section => section.id === 'stock')
  if (section?.status !== 'ready' || !(scope.category || scope.item || scope.material)) return null
  const entries = Object.entries(scope).filter(([, value]) => value !== undefined)
  const missing = (value: unknown) => value == null || value === ''
  const unknownRows = section.rows.filter(row => entries.some(([key]) => missing(row[key])) && entries.every(([key, value]) => missing(row[key]) || row[key] === value)).length
  if (!unknownRows) return null
  const matched = section.rows.filter(row => entries.every(([key, value]) => row[key] === value))
  if (!matched.length || matched.some(row => typeof row.inventory !== 'number' || !Number.isFinite(row.inventory) || row.inventory < 0)) return null
  return { value: matched.reduce((sum, row) => sum + (row.inventory as number), 0) / 10000, matchedRows: matched.length, unknownRows }
}

/** Matched SKU quantities are aggregated in SQL before grouping. Observation only:
 * coverage may differ between periods, so strict metrics and comparisons stay unchanged.
 */
export function stockCoverageObservation(data: MetricData | null | undefined, base?: string) {
  const section = data?.sections.find(section => section.id === 'stock')
  if (section?.status !== 'ready') return null
  const rows = section.rows.filter(row => !base || row.base === base)
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!rows.length || rows.some(row => !valid(row.records))) return null
  const total = rows.reduce((sum, row) => sum + (row.records as number), 0)
  const observation = (name: 'support' | 'shippable') => {
    const countKey = `covered_${name}_count`,
      quantityKey = `covered_${name}_quantity`,
      demandKey = `covered_${name}_demand`
    if (rows.some(row => !valid(row[countKey]) || (row[countKey] as number) > (row.records as number))) return null
    const matched = rows.filter(row => (row[countKey] as number) > 0)
    if (!matched.length || matched.some(row => !valid(row[quantityKey]) || !valid(row[demandKey]))) return null
    const count = matched.reduce((sum, row) => sum + (row[countKey] as number), 0)
    const quantity = matched.reduce((sum, row) => sum + (row[quantityKey] as number), 0)
    const demand = matched.reduce((sum, row) => sum + (row[demandKey] as number), 0)
    return { count, total, quantity, demand, days: demand > 0 ? quantity / demand : null }
  }
  return { support: observation('support'), shippable: observation('shippable') }
}
