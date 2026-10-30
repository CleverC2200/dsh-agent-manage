import type { StructureRow } from './full-chain-types.js'
export const completeTotal = (values: (number | null | undefined)[]): number | null =>
  values.length && values.every(v => v != null && Number.isFinite(v)) ? values.reduce<number>((sum, v) => sum + v!, 0) : null
/** Aggregate only additive evidence; never average turnover ratios or merge customer units. */
export function summarizeStructure(rows: StructureRow[], key: string, label: string): StructureRow {
  const first = rows[0]
  const currentQty = rows.reduce((sum, r) => sum + r.currentQty, 0)
  const targetQty = completeTotal(rows.map(r => r.targetQty))
  const availableQty = completeTotal(rows.map(r => r.availableQty))
  const demand = completeTotal(rows.map(r => r.turnoverDemand30d))
  const plan = completeTotal(rows.map(r => r.plannedDailyQty))
  const age =
    rows.length && rows.every(r => r.currentQty >= 0 && (r.currentQty === 0 || r.averageAgeDays != null)) && currentQty > 0
      ? rows.reduce((s, r) => s + r.currentQty * (r.averageAgeDays ?? 0), 0) / currentQty
      : null
  const bigDateQty = completeTotal(rows.map(r => r.bigDateQty))
  return {
    ...first,
    key,
    objectName: label,
    sku: '全部SKU',
    currentQty,
    targetQty,
    availableQty,
    differenceQty: targetQty == null ? null : currentQty - targetQty,
    turnoverDemand30d: demand,
    plannedDailyQty: plan,
    turnoverDays: demand != null && demand > 0 ? (currentQty * 30) / demand : null,
    targetTurnoverDays: targetQty != null && plan != null && plan > 0 ? targetQty / plan : null,
    projectedTurnoverDays: null,
    forecastInventoryQty: completeTotal(rows.map(r => r.forecastInventoryQty)),
    averageAgeDays: age,
    bigDateQty,
    judgment: bigDateQty != null && bigDateQty > 0 ? '存在大日期库存' : targetQty == null ? '目标不可用' : currentQty < targetQty ? '库存低于目标' : '当前未命中规则风险',
    confidence: targetQty == null ? '部分目标缺失，差额不计算' : '当前范围完整汇总',
    children: undefined
  }
}
export function categoryStructureRows(rows: StructureRow[]): StructureRow[] {
  const groups = new Map<string, StructureRow[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.layer, row.objectId ?? row.objectName, row.category])
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups].map(([key, group]) => ({ ...summarizeStructure(group, 'category-object:' + key, group[0].objectName), category: group[0].category }))
}
