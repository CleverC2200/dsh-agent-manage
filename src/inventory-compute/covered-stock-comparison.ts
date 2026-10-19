export type ComparableStock = { inventory: number | null; target: number | null; demand: number | null }
const valid = (n: number | null): n is number => n !== null && Number.isFinite(n) && n >= 0

/** Supplied, scoped SKU facts only. Every ratio uses the same matched SKU cohort. */
export function coveredStockComparison(rows: ComparableStock[]) {
  const pairs = rows.filter(r => valid(r.inventory) && valid(r.target))
  const daily = pairs.filter(r => valid(r.demand))
  const demand = daily.reduce((sum, r) => sum + r.demand!, 0)
  const inventory = daily.reduce((sum, r) => sum + r.inventory!, 0)
  const target = daily.reduce((sum, r) => sum + r.target!, 0)
  const gap = pairs.reduce((sum, r) => sum + r.inventory! - r.target!, 0)
  return {
    total: rows.length,
    gapCovered: pairs.length,
    turnoverCovered: daily.length,
    gap: pairs.length && Number.isFinite(gap) ? gap : null,
    turnover: demand > 0 && Number.isFinite(demand) && Number.isFinite(inventory) ? inventory / demand : null,
    targetTurnover: demand > 0 && Number.isFinite(demand) && Number.isFinite(target) ? target / demand : null,
    gapPartial: pairs.length < rows.length,
    turnoverPartial: daily.length < rows.length
  }
}
