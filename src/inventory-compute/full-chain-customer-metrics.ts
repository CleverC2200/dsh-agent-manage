import type { FullChainWorkspace } from './full-chain-types.js'

export function customerMetrics(workspace: FullChainWorkspace) {
  const rows = workspace.structure.filter(row => row.layer === 'customer')
  const observedInventory = rows.length ? rows.reduce((sum, row) => sum + row.currentQty, 0) : null
  const inventory = workspace.kpis.inventoryLevel.planCustomerTotal ?? null
  const completeDemand = rows.length > 0 && rows.every(row => row.turnoverDemand30d != null && row.turnoverDemand30d >= 0)
  const demand = completeDemand ? rows.reduce((sum, row) => sum + row.turnoverDemand30d!, 0) : null
  const age = workspace.agingDetails?.find(row => row.layer === 'customer')?.values.averageAgeDays
  return {
    inventory,
    // Company quantities are labelled 件; dealer inventory is labelled 箱.
    // Do not derive a cross-unit percentage without a published conversion.
    share: null,
    turnover: observedInventory != null && demand != null && demand > 0 ? (observedInventory * 30) / demand : null,
    demandIncomplete: rows.length > 0 && !completeDemand,
    averageAge: typeof age === 'number' ? age : null,
    over30: workspace.aging.over30ByLayer?.customer ?? null,
    reviewCount: workspace.customerObservationRisks.length
  }
}
