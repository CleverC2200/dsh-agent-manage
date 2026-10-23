export type MpsQuantity = number | null
export const mpsCategories = ['饺子', '调理肉制品', '汤圆', '面点', '休闲', '馄饨', '粽子', '饼类']
export interface MpsContext {
  id: string
  name: string
  month: string
}
export interface MpsProduct {
  base: string
  code: string
  name: string
  category: string
  group: string
  series: string
}
export interface MpsQuantityRow {
  month: string
  base: string
  code: string
  quantity: MpsQuantity
}
export interface MpsCategoryDemand {
  month: string
  category: string
  quantity: MpsQuantity
}
export interface MpsCapacity {
  base: string
  code: string
  line: string
  dailyPieces: MpsQuantity
  dailyTons: MpsQuantity
  missing: string[]
}
export interface MpsConstraints {
  safetyDays: { base: string; days: MpsQuantity }[]
  rules: Record<string, unknown>
}
export interface MpsWorkflowInput {
  context: MpsContext
  products: MpsProduct[]
  categoryDemand: MpsCategoryDemand[]
  report: MpsQuantityRow[]
  history: MpsQuantityRow[]
  sourceIssues: { report: string[]; history: string[] }
  openingInventory: Omit<MpsQuantityRow, 'month'>[]
  capacities: MpsCapacity[]
  constraints: MpsConstraints
}
export interface MpsWorkflowRow extends MpsProduct {
  id: string
  month: string
  reportQuantity: MpsQuantity
  historyQuantity: MpsQuantity
  reportShare: MpsQuantity
  historyShare: MpsQuantity
  share: MpsQuantity
  demand: MpsQuantity
  openingInventory: MpsQuantity
  safetyDays: MpsQuantity
  targetInventory: MpsQuantity
  monthlyCapacity: MpsQuantity
  load: MpsQuantity
  mainPlan: MpsQuantity
  gap: MpsQuantity
  transfer: MpsQuantity
  capacities: MpsCapacity[]
  missing: Record<string, string[]>
}

const finite = (value: MpsQuantity): value is number => value !== null && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
const quantity = (rows: { quantity: MpsQuantity }[], signed = false): MpsQuantity =>
  rows.length && rows.every(row => finite(row.quantity) && (signed || row.quantity >= 0)) ? safe(rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0)) : null
const safe = (value: number): MpsQuantity => (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null)
const key = (product: Pick<MpsProduct, 'base' | 'code'>) => JSON.stringify([product.base, product.code])
const monthOffset = (month: string, offset: number) => {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}
const periodKey = (row: MpsQuantityRow) => JSON.stringify([row.month, row.base, row.code])
function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
  const result = new Map<string, T[]>()
  for (const row of rows) {
    const group = result.get(keyOf(row)) ?? []
    group.push(row)
    result.set(keyOf(row), group)
  }
  return result
}

export function computeMpsWorkflow(input: MpsWorkflowInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.context.month)) throw Error('评估月份无效')
  const months = Array.from({ length: 4 }, (_, offset) => monthOffset(input.context.month, offset))
  const reportIndex = groupBy(input.report, periodKey)
  const historyIndex = groupBy(input.history, periodKey)
  const openingIndex = groupBy(input.openingInventory, key)
  const capacityIndex = groupBy(input.capacities, key)
  const daysIndex = groupBy(input.constraints.safetyDays, row => row.base)
  const productIndex = groupBy(input.products, key)
  const unmatchedMonths = {
    report: new Set(input.report.filter(row => !productIndex.has(key(row))).map(row => row.month)),
    history: new Set(input.history.filter(row => !productIndex.has(key(row))).map(row => row.month))
  }
  const categories = [...new Set([...mpsCategories, ...[...input.products, ...input.categoryDemand].map(row => row.category)])]
  const categoryRows = months.flatMap(month =>
    categories.map(category => {
      const matches = input.categoryDemand.filter(row => row.month === month && row.category === category)
      const value = matches.length === 1 ? quantity(matches) : null
      return {
        month,
        category,
        quantity: value,
        missing: value === null ? ['缺大类需求，第一步计算口径待确认'] : []
      }
    })
  )
  const rows: MpsWorkflowRow[] = months.slice(0, 3).flatMap(month =>
    input.products.map(product => {
      const reportQuantity = quantity(reportIndex.get(periodKey({ ...product, month, quantity: null })) ?? [])
      const historyQuantity = quantity(historyIndex.get(periodKey({ ...product, month: monthOffset(month, -12), quantity: null })) ?? [])
      const openingInventory = month === input.context.month ? quantity(openingIndex.get(key(product)) ?? [], true) : null
      const days = daysIndex.get(product.base) ?? []
      const safetyDays = days.length === 1 && finite(days[0].days) && days[0].days >= 0 ? days[0].days : null
      const capacities = (capacityIndex.get(key(product)) ?? []).map(row => ({ ...row, missing: [...row.missing] }))
      return {
        ...product,
        id: JSON.stringify([month, product.base, product.group, product.code]),
        month,
        reportQuantity,
        historyQuantity,
        reportShare: null,
        historyShare: null,
        share: null,
        demand: null,
        openingInventory,
        safetyDays,
        targetInventory: null,
        monthlyCapacity: null,
        load: null,
        mainPlan: null,
        gap: null,
        transfer: null,
        capacities,
        missing: {
          reportQuantity: reportQuantity === null ? ['缺本期销售提报数量'] : [],
          historyQuantity: historyQuantity === null ? ['缺去年同月发货数量'] : [],
          reportShare: [],
          historyShare: [],
          share: [],
          demand: [],
          openingInventory: openingInventory === null ? [month === input.context.month ? '缺上月预计月末结存' : '依赖上月主计划与期末库存'] : [],
          safetyDays: safetyDays === null ? ['缺本地安全天数配置'] : [],
          targetInventory: ['安全库存公式与工作日口径待确认'],
          monthlyCapacity: [...(capacities.length ? [] : ['缺本基地单品源产能']), '工作日、产线归属及件吨换算待确认'],
          load: ['月产能与负荷规则待确认'],
          mainPlan: ['主计划计算规则待确认'],
          gap: ['依赖主计划及可用月产能'],
          transfer: ['调拨方向与分配规则待确认']
        }
      }
    })
  )
  for (const category of categoryRows) {
    const group = rows.filter(row => row.month === category.month && row.category === category.category)
    if (!group.length) continue
    const duplicate = group.some(row => (productIndex.get(key(row))?.length ?? 0) > 1)
    const identityMissing = group.some(row => !row.base || !row.code || !row.category || !row.group)
    for (const source of ['report', 'history'] as const) {
      const field = source === 'report' ? 'reportQuantity' : 'historyQuantity'
      const shareField = source === 'report' ? 'reportShare' : 'historyShare'
      const total = quantity(group.map(row => ({ quantity: row[field] })))
      const sourceMonth = source === 'report' ? category.month : monthOffset(category.month, -12)
      const unmatched = unmatchedMonths[source].has(sourceMonth)
      const issues = [
        ...input.sourceIssues[source],
        ...(unmatched ? ['源明细存在未对应产品，拆分范围不完整'] : []),
        ...(identityMissing ? ['缺基地、物料组或产品分类，拆分范围不完整'] : []),
        ...(duplicate ? ['产品拆分键重复'] : []),
        ...(total === null ? ['同大类明细数量不完整'] : total === 0 ? ['同大类合计为0，占比未定义'] : [])
      ]
      for (const row of group) {
        row.missing[shareField] = issues
        row[shareField] = !issues.length && total !== null ? (row[field] ?? 0) / total : null
      }
    }
    for (const row of group) {
      row.missing.share = [...new Set([...row.missing.reportShare, ...row.missing.historyShare])]
      row.share = row.reportShare !== null && row.historyShare !== null ? (row.reportShare + row.historyShare) / 2 : null
      row.missing.demand = [...category.missing, ...row.missing.share]
      row.demand = category.quantity !== null && row.share !== null ? safe(category.quantity * row.share) : null
      if (row.demand === null && !row.missing.demand.length) row.missing.demand.push('需求超出可靠计算范围')
    }
    if (category.quantity !== null && group.every(row => row.demand !== null)) {
      const last = group.findLast(row => row.share !== 0) ?? group[group.length - 1]
      last.demand = safe(category.quantity - group.filter(row => row !== last).reduce((sum, row) => sum + (row.demand ?? 0), 0))
    }
  }
  return {
    context: { ...input.context },
    months,
    shipmentMonth: monthOffset(input.context.month, -1),
    categoryRows,
    rows,
    constraints: {
      safetyDays: input.constraints.safetyDays.map(row => ({ ...row })),
      rules: { ...input.constraints.rules }
    },
    missing: ['第一步大类需求完整公式待确认', '安全库存、工作日、主计划及调拨规则待确认', '正式约束表与保存接口尚未就绪']
  }
}
