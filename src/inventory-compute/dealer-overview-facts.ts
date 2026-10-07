/** One selection policy for workbench cards and conversational overviews. */
import type { DealerDashboardSummary, DealerInventoryDailySummary } from './dealer-dashboard.js'

export function dealerOverviewFacts(plan: DealerDashboardSummary | null, daily: DealerInventoryDailySummary | null) {
  const inventory = daily?.coverageComplete && daily.stockQtyComplete ? daily.inventory : (plan?.inventory ?? null)
  const inTransit = daily?.coverageComplete && daily.inTransitQtyComplete ? daily.inTransit : (plan?.inTransit ?? null)
  const forecastSales = daily?.coverageComplete && daily.sales30DailyAverageComplete ? daily.sales30 : plan ? plan.dailySales * 30 : null
  const totalInventory = inventory !== null && inTransit !== null ? inventory + inTransit : null
  const shortage = plan?.shortageSkuCount ?? null
  return {
    inventory,
    inTransit,
    totalInventory,
    forecastSales,
    averageCover: totalInventory !== null && forecastSales !== null && forecastSales > 0 ? Math.round(totalInventory / (forecastSales / 30)) : null,
    stockAmount: daily?.stockAmountCoverage ? daily.stockAmount : null,
    targetInventory: plan?.targetInventory ?? null,
    reasonableSkuCount: plan?.reasonableSkuCount ?? null,
    unreasonableSkuCount: plan?.unreasonableSkuCount ?? null,
    shortageSkuCount: shortage,
    coveredSkuCount: plan?.coveredSkuCount ?? null,
    skuCount: plan?.skuCount ?? null,
    // 批次临期、无动销和异常品类计数尚未发布，按 v1.0.1 显示待完善分数。
    healthScore: 0,
    healthStatus: '数据待完善',
    expirySkuCount: null,
    inventorySource: daily?.coverageComplete && daily.stockQtyComplete ? '库存日快照' : '预订单全范围汇总',
    transitSource: daily?.coverageComplete && daily.inTransitQtyComplete ? '库存日快照' : '预订单全范围汇总',
    coverageSource: daily?.coverageComplete && daily.sales30DailyAverageComplete ? '库存日快照近30日销量' : '预订单日均销量',
    dailyCustomerCount: daily?.customerCount ?? 0,
    dailyCoverageComplete: daily?.coverageComplete ?? false,
    stockAmountCoverage: daily?.stockAmountCoverage ?? 0
  }
}
