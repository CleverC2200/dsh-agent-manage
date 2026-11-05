import { resolveMpsRules, ruleSafetyDays, ruleProductionDays, ruleStopsResource, evaluateMpsRules } from './constraint-rules.ts'
import { inventoryTargetIndex, type MpsInventoryTarget, type MpsInventoryTargetResult, type MpsInventoryVersion } from './inventory-targets.ts'
import { adjustedQuantities, type MpsQuantityAdjustment } from './quantity-adjustments.ts'
import { applyReportFallback, type MpsReportRatio } from './split-fallback.ts'
export type { MpsQuantityAdjustment } from './quantity-adjustments.ts'
export type MpsQuantity = number | null
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
  category?: string
}
export interface MpsCategoryDemand {
  systemQuantity?: MpsQuantity
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
export interface MpsDemandAdjustment {
  month: string
  category: string
  quantity: number
}
export interface MpsResource {
  id: string
  base: string
  kind: 'tunnel' | 'forming'
  name: string
  dailyTons: MpsQuantity
}
export interface MpsResourceAssignment {
  month: string
  base: string
  code: string
  resourceId: string
  share: number
}
export interface MpsResourceLoad extends MpsResource {
  resourceId: string
  month: string
  productionDays: MpsQuantity
  requiredTons: MpsQuantity
  requiredDays: MpsQuantity
  load: MpsQuantity
  overloadDays: MpsQuantity
  gapTons: MpsQuantity
  status: 'normal' | 'warning' | 'overload' | 'unknown'
  missing: string[]
}
export interface MpsWorkflowInput {
  inventoryTargets?: MpsInventoryTarget[]
  inventoryTargetVersion?: MpsInventoryVersion
  inventoryTargetIssues?: string[]
  productMonths?: Pick<MpsQuantityRow, 'month' | 'base' | 'code'>[]
  scopeCoverage?: 'national' | 'in-scope'
  productionDays?: { base: string; month: string; days: MpsQuantity }[]
  unitWeights?: { base: string; code: string; tonsPerPiece: MpsQuantity }[]
  resources?: MpsResource[]
  resourceAssignments?: MpsResourceAssignment[]
  adjustments?: {
    categoryDemand?: MpsDemandAdjustment[]
    shares?: { rowId: string; share: number }[]
    quantities?: MpsQuantityAdjustment[]
  }
  context: MpsContext
  products: MpsProduct[]
  categoryDemand: MpsCategoryDemand[]
  report: MpsQuantityRow[]
  reportRatios?: MpsReportRatio[]
  history: MpsQuantityRow[]
  sourceIssues: { report: string[]; history: string[] }
  openingInventory: Omit<MpsQuantityRow, 'month'>[]
  capacities: MpsCapacity[]
  constraints: MpsConstraints
}
export interface MpsShareLayers {
  groupQuantity: MpsQuantity
  categoryQuantity: MpsQuantity
  skuQuantity: MpsQuantity
  baseQuantity: MpsQuantity
  groupShare: MpsQuantity
  skuShare: MpsQuantity
  baseShare: MpsQuantity
  product: MpsQuantity
}
export interface MpsWorkflowRow extends MpsProduct {
  inventoryTarget: MpsInventoryTargetResult
  safetyDaysSource: 'manual' | 'source' | 'rule' | 'missing'
  evaluation: 'unconstrained'
  nextMonthDemand: MpsQuantity
  requiredProduction: MpsQuantity
  projectedClosing: MpsQuantity
  requiredProductionTons: MpsQuantity
  productionDays: MpsQuantity
  reportLayers: MpsShareLayers
  historyLayers: MpsShareLayers
  layerMissing: string[]
  systemShare: MpsQuantity
  fallback: boolean
  coefficientFallback: string[]
  groupShare: MpsQuantity
  id: string
  month: string
  reportQuantity: MpsQuantity
  historyQuantity: MpsQuantity
  reportShare: MpsQuantity
  historyShare: MpsQuantity
  share: MpsQuantity
  demand: MpsQuantity
  systemDemand: MpsQuantity
  quantityAdjusted: boolean
  openingInventory: MpsQuantity
  safetyDays: MpsQuantity
  targetInventory: MpsQuantity
  targetInventoryMissing: ('safety-days-missing' | 'next-month-demand-missing' | 'invalid-target-inventory')[]
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
export function previousFiscalYear(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('评估月份无效')
  const startYear = Number(month.slice(0, 4)) - (Number(month.slice(5)) >= 7 ? 1 : 2)
  return { start: `${startYear}-07-01`, end: `${startYear + 1}-06-30` }
}
const monthOffset = (month: string, offset: number) => {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return date.toISOString().slice(0, 7)
}
const daysInMonth = (month: string) => {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1, 0)
  return date.getUTCDate()
}
const periodKey = (row: Pick<MpsQuantityRow, 'month' | 'base' | 'code'>) => JSON.stringify([row.month, row.base, row.code])
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
  const adjustmentIssues: string[] = []
  const months = Array.from({ length: 4 }, (_, offset) => monthOffset(input.context.month, offset))
  const resolvedRules = resolveMpsRules(input, months.slice(0, 3))
  const reportIndex = groupBy(input.report, periodKey)
  const historyIndex = groupBy(input.history, periodKey)
  const coefficientKey = (row: Pick<MpsProduct, 'base' | 'code'>) => periodKey({ ...row, month: input.context.month })
  const openingIndex = groupBy(input.openingInventory, key)
  const capacityIndex = groupBy(input.capacities, key)
  const daysIndex = groupBy(input.constraints.safetyDays, row => row.base)
  const inventoryTarget = inventoryTargetIndex(input.inventoryTargets ?? [], input.inventoryTargetVersion, input.inventoryTargetIssues)
  const productIndex = groupBy(input.products, key)
  const productsByMonth = new Map(
    months.slice(0, 3).map(month => [
      month,
      input.productMonths === undefined
        ? input.products
        : input.productMonths
            .filter(row => row.month === input.context.month)
            .flatMap(assignment => {
              const matches = productIndex.get(key(assignment)) ?? productIndex.get(key({ base: '', code: assignment.code })) ?? []
              return matches.map(product => ({ ...product, base: assignment.base }))
            })
    ])
  )
  const monthlyProductIndexes = new Map([...productsByMonth].map(([month, products]) => [month, groupBy(products, key)]))
  const catalogByCode = groupBy(input.products, row => row.code)
  const excludedSources: (MpsQuantityRow & { source: 'report' | 'history'; reason: string })[] = []
  const unassignedBases = new Set<string>()
  const unmatchedMonths = { report: new Map<string, Set<string>>(), history: new Map<string, Set<string>>() }
  for (const source of ['report', 'history'] as const) {
    for (const fact of input[source]) {
      if (fact.month !== input.context.month) continue
      const month = fact.month
      const domain = monthlyProductIndexes.get(month)
      if (!domain || domain.has(key(fact))) continue
      const categories = new Set([fact.category ?? '', ...(catalogByCode.get(fact.code) ?? []).map(product => product.category)].filter(Boolean))
      const category = categories.size === 1 ? [...categories][0] : ''
      excludedSources.push({ ...fact, source, reason: !fact.base ? '源记录缺基地' : '物料编码未对应当前产品明细或指定基地' })
      if (!fact.base && catalogByCode.has(fact.code) && fact.quantity !== 0) unassignedBases.add(JSON.stringify([source, month, category]))
      const unmatched = unmatchedMonths[source].get(month) ?? new Set<string>()
      unmatched.add(category)
      unmatchedMonths[source].set(month, unmatched)
    }
  }
  const scopeIssues = [...unmatchedMonths.report, ...unmatchedMonths.history].flatMap(([month, categories]) =>
    [...categories].map(category => `${month} ${category || '分类未知'} 源明细不在当前产品明细范围，已单列且未参与占比`)
  )
  const categories = [...new Set(input.products.map(row => row.category).filter(category => category.trim().length > 0))]
  const excludedCategoryDemand = input.categoryDemand
    .filter(row => !categories.includes(row.category))
    .map(row => ({ ...row, reason: '大类不在当前产品列表范围，已单列且未参与计算' }))
  scopeIssues.push(...excludedCategoryDemand.map(row => `${row.month} ${row.category || '分类未知'} ${row.reason}`))
  const categoryRows = months.flatMap(month =>
    categories.map(category => {
      const matches = input.categoryDemand.filter(row => row.month === month && row.category === category)
      const effectiveQuantity = matches.length === 1 ? quantity(matches) : null
      const baseline = matches.length === 1 ? matches[0].systemQuantity : undefined
      const systemQuantity = baseline === undefined ? effectiveQuantity : quantity([{ quantity: baseline }])
      const edits = (input.adjustments?.categoryDemand ?? []).filter(row => row.month === month && row.category === category)
      const edit = edits[0]
      const accepted = edits.length === 1 && edit !== undefined && finite(edit.quantity) && edit.quantity >= 0
      if (edits.length && !accepted) adjustmentIssues.push(`${month} ${category} 大类需求调整无效或重复`)
      const value = accepted ? edit.quantity : effectiveQuantity
      return {
        month,
        category,
        quantity: value,
        systemQuantity,
        adjusted: accepted || value !== systemQuantity,
        missing: value === null ? ['缺大类需求，本月有效值不可用'] : []
      }
    })
  )
  const rows: MpsWorkflowRow[] = months.slice(0, 3).flatMap(month =>
    (productsByMonth.get(month) ?? []).map(product => {
      const reportQuantity = quantity(reportIndex.get(coefficientKey(product)) ?? [])
      const historyQuantity = quantity(historyIndex.get(coefficientKey(product)) ?? [])
      const openingInventory = month === input.context.month ? quantity(openingIndex.get(key(product)) ?? [], true) : null
      const days = daysIndex.get(product.base) ?? []
      const sourceTarget = inventoryTarget({ base: product.base, code: product.code, month })
      const manualDays = days.length === 1 && finite(days[0].days) && days[0].days >= 0 ? days[0].days : null
      const baselineDays = manualDays ?? sourceTarget.days
      const safetyDays = ruleSafetyDays(baselineDays, { ...product, month }, resolvedRules.rules)
      const safetyDaysSource = safetyDays !== baselineDays ? 'rule' : manualDays !== null ? 'manual' : sourceTarget.days !== null ? 'source' : 'missing'
      const capacities = (capacityIndex.get(key(product)) ?? []).map(row => ({ ...row, missing: [...row.missing] }))
      return {
        ...product,
        id: JSON.stringify([month, product.base, product.group, product.code]),
        month,
        reportQuantity,
        historyQuantity,
        evaluation: 'unconstrained',
        nextMonthDemand: null,
        requiredProduction: null,
        projectedClosing: null,
        requiredProductionTons: null,
        productionDays: null,
        layerMissing: [],
        systemShare: null,
        fallback: false,
        coefficientFallback: [],
        groupShare: null,
        reportLayers: { groupQuantity: null, categoryQuantity: null, skuQuantity: null, baseQuantity: null, groupShare: null, skuShare: null, baseShare: null, product: null },
        historyLayers: { groupQuantity: null, categoryQuantity: null, skuQuantity: null, baseQuantity: null, groupShare: null, skuShare: null, baseShare: null, product: null },
        reportShare: null,
        historyShare: null,
        share: null,
        demand: null,
        systemDemand: null,
        quantityAdjusted: false,
        openingInventory,
        safetyDays,
        inventoryTarget: sourceTarget,
        safetyDaysSource,
        targetInventory: null,
        targetInventoryMissing: [],
        monthlyCapacity: null,
        load: null,
        mainPlan: null,
        gap: null,
        transfer: null,
        capacities,
        missing: {
          reportQuantity: reportQuantity === null ? ['缺本期销售提报数量'] : [],
          historyQuantity: historyQuantity === null ? ['缺上一财年全年发货数量'] : [],
          reportShare: [],
          historyShare: [],
          share: [],
          demand: [],
          openingInventory: openingInventory === null ? [month === input.context.month ? '缺上月预计月末结存' : '依赖上月主计划与期末库存'] : [],
          safetyDays: safetyDays === null ? [...sourceTarget.missing, '可维护人工覆盖或库存下限规则'] : [],
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
    const materialGroups = groupBy(group, row => row.group)
    const skuGroups = new Map([...materialGroups].map(([name, entries]) => [name, groupBy(entries, row => row.code)]))
    const duplicate = group.some(row => (monthlyProductIndexes.get(category.month)?.get(key(row))?.length ?? 0) > 1)
    const identityMissing = group.some(row => !row.base || !row.code || !row.category || !row.group)
    for (const source of ['report', 'history'] as const) {
      const field = source === 'report' ? 'reportQuantity' : 'historyQuantity'
      const shareField = source === 'report' ? 'reportShare' : 'historyShare'
      const index = source === 'report' ? reportIndex : historyIndex
      const entries = group.filter(row => index.has(coefficientKey(row)))
      const total = quantity(entries.map(row => ({ quantity: row[field] })))
      const issues = [
        ...input.sourceIssues[source],
        ...(unassignedBases.has(JSON.stringify([source, input.context.month, category.category])) || unassignedBases.has(JSON.stringify([source, input.context.month, '']))
          ? ['当前产品的源数量缺基地，范围内分母不可确认']
          : []),
        ...(identityMissing ? ['缺基地、物料组或产品分类，拆分范围不完整'] : []),
        ...(duplicate ? ['产品拆分键重复'] : []),
        ...(total === null ? ['同大类明细数量不完整'] : total === 0 ? ['同大类合计为0，占比未定义'] : [])
      ]
      const groupTotals = new Map(
        [...materialGroups].map(([name, entries]) => [name, quantity(entries.filter(row => index.has(coefficientKey(row))).map(row => ({ quantity: row[field] })))])
      )
      const skuTotals = new Map(
        [...skuGroups].map(([name, codes]) => [
          name,
          new Map([...codes].map(([code, entries]) => [code, quantity(entries.filter(row => index.has(coefficientKey(row))).map(row => ({ quantity: row[field] })))]))
        ])
      )
      const largestGroup = [...groupTotals].filter((entry): entry is [string, number] => entry[1] !== null).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))[0]?.[0]
      for (const row of group) {
        row.missing[shareField] = [...issues, ...(row[field] === null ? ['本来源缺当前基地物料记录或数量'] : [])]
        row[shareField] = !row.missing[shareField].length && total !== null && row[field] !== null ? row[field] / total : null
        const groupTotal = groupTotals.get(row.group) ?? null
        const skuTotal = skuTotals.get(row.group)?.get(row.code) ?? null
        const groupShare =
          !issues.length && total !== null && total > 0 && groupTotal !== null
            ? row.group === largestGroup
              ? 1 - [...groupTotals].filter(([name, value]) => name !== largestGroup && value !== null).reduce((sum, [, value]) => sum + (value ?? 0) / total, 0)
              : groupTotal / total
            : null
        const skuShare = !issues.length && groupTotal !== null && groupTotal > 0 && skuTotal !== null ? skuTotal / groupTotal : null
        const baseShare = !issues.length && skuTotal !== null && skuTotal > 0 && row[field] !== null ? row[field] / skuTotal : null
        row[source === 'report' ? 'reportLayers' : 'historyLayers'] = {
          groupQuantity: issues.length ? null : groupTotal,
          categoryQuantity: issues.length ? null : total,
          skuQuantity: issues.length ? null : skuTotal,
          baseQuantity: row[field],
          groupShare,
          skuShare,
          baseShare,
          product: groupShare !== null && skuShare !== null && baseShare !== null ? groupShare * skuShare * baseShare : null
        }
      }
    }
    if (!duplicate && !identityMissing && !input.sourceIssues.report.length && !unassignedBases.has(JSON.stringify(['report', input.context.month, category.category])) && !unassignedBases.has(JSON.stringify(['report', input.context.month, ''])))
      applyReportFallback(group, input.reportRatios ?? [])
    for (const row of group) {
      row.missing.share = [...new Set([...row.missing.reportShare, ...row.missing.historyShare])]
      row.systemShare = row.reportShare !== null && row.historyShare !== null ? (row.reportShare + row.historyShare) / 2 : null
      row.share = row.systemShare
      row.groupShare = row.reportLayers.groupShare !== null && row.historyLayers.groupShare !== null ? (row.reportLayers.groupShare + row.historyLayers.groupShare) / 2 : null
      if ([row.reportLayers, row.historyLayers].some(layer => layer.skuShare === null || layer.baseShare === null))
        row.layerMissing = ['中间分母为0或来源不完整，分层连乘未定义；完整大类中的真实零数量仍保留零占比']
    }
    for (const materialGroup of materialGroups.values()) {
      const codes = [...groupBy(materialGroup, row => row.code).entries()]
      const ranked = codes.map(([code, entries]) => ({ code, value: quantity(entries.map(row => ({ quantity: row.historyQuantity }))) }))
      const complete = ranked.every(row => row.value !== null) && materialGroup.every(row => row.historyShare !== null)
      const top = complete ? ranked.sort((a, b) => (b.value ?? 0) - (a.value ?? 0) || a.code.localeCompare(b.code, 'en'))[0] : undefined
      const fallback = materialGroup.filter(row => row.code === top?.code)
      fallback.forEach(row => {
        row.fallback = true
      })
      const edits = (input.adjustments?.shares ?? []).filter(edit => materialGroup.some(row => row.id === edit.rowId))
      const edited = new Map<string, number>()
      let valid = true
      for (const edit of edits) {
        if (edited.has(edit.rowId) || !finite(edit.share) || edit.share < 0 || edit.share > 1) valid = false
        edited.set(edit.rowId, edit.share)
      }
      const groupShare = materialGroup[0]?.groupShare ?? null
      if (edits.length && (!complete || groupShare === null || materialGroup.some(row => row.systemShare === null))) valid = false
      const candidates = fallback.filter(row => !edited.has(row.id))
      const fixed = materialGroup.filter(row => !candidates.includes(row))
      const fixedTotal = fixed.length ? quantity(fixed.map(row => ({ quantity: edited.get(row.id) ?? row.systemShare }))) : 0
      const residual = groupShare !== null && fixedTotal !== null ? groupShare - fixedTotal : null
      if (residual === null || residual < -1e-12 || (!candidates.length && Math.abs(residual) > 1e-12)) valid = false
      const weights = candidates.map(row => row.systemShare)
      const weightTotal = weights.length ? quantity(weights.map(value => ({ quantity: value }))) : 0
      if (candidates.length && (weightTotal === null || (weightTotal === 0 && residual !== 0))) valid = false
      if (valid && residual !== null && weightTotal !== null) {
        for (const row of fixed) row.share = edited.get(row.id) ?? row.systemShare
        candidates.forEach((row, index) => {
          row.share = weightTotal === 0 ? 0 : (Math.max(0, residual) * (weights[index] ?? 0)) / weightTotal
        })
      } else if (edits.length && !valid) adjustmentIssues.push(`${category.month} ${materialGroup[0]?.group} 占比调整拒绝：来源不完整、重复或会产生负托底`)
    }
    for (const row of group) {
      row.missing.demand = [...category.missing, ...row.missing.share]
      row.demand = category.quantity !== null && row.share !== null ? safe(category.quantity * row.share) : null
      row.systemDemand = category.systemQuantity !== null && row.systemShare !== null ? safe(category.systemQuantity * row.systemShare) : null
      if (row.demand === null && !row.missing.demand.length) row.missing.demand.push('需求超出可靠计算范围')
    }
    if (category.quantity !== null && group.every(row => row.demand !== null)) {
      const last = group.findLast(row => row.fallback && row.share !== 0) ?? group.findLast(row => row.share !== 0) ?? group[group.length - 1]
      last.demand = safe(category.quantity - group.filter(row => row !== last).reduce((sum, row) => sum + (row.demand ?? 0), 0))
    }
    const quantityEdits = (input.adjustments?.quantities ?? []).filter(edit => edit.month === category.month && edit.category === category.category)
    if (quantityEdits.length) {
      const shareEdits = (input.adjustments?.shares ?? []).some(edit => group.some(row => row.id === edit.rowId))
      const quantities = !shareEdits && months.slice(0, 2).includes(category.month) ? adjustedQuantities(group, category.quantity, quantityEdits) : null
      if (quantities) {
        for (const row of group) {
          row.demand = quantities.get(row.id) ?? null
          row.quantityAdjusted = true
          row.share = category.quantity && row.demand !== null ? row.demand / category.quantity : row.share
          const groupTotal = group.filter(candidate => candidate.group === row.group).reduce((sum, candidate) => sum + (quantities.get(candidate.id) ?? 0), 0)
          row.groupShare = category.quantity ? groupTotal / category.quantity : row.groupShare
        }
      } else adjustmentIssues.push(`${category.month} ${category.category} 数量调整拒绝：月份、范围、权重、重复、固定下级合计或占比调整冲突`)
    }
  }
  const productionDays = (base: string, month: string) => {
    const matches = (input.productionDays ?? []).filter(row => row.base === base && row.month === month)
    const value = matches[0]?.days ?? null
    return ruleProductionDays(matches.length === 1 && finite(value) && value >= 0 && value <= daysInMonth(month) ? value : null, base, month, resolvedRules.rules)
  }
  const rowIndex = groupBy(rows, periodKey)
  for (const row of rows) {
    const nextMonth = monthOffset(row.month, 1)
    const nextRow = rowIndex.get(periodKey({ month: nextMonth, base: row.base, code: row.code }))?.[0]
    const nextCategory = categoryRows.find(candidate => candidate.month === nextMonth && candidate.category === row.category)
    row.nextMonthDemand = nextRow
      ? nextRow.demand
      : row.month === months[2] && nextCategory?.quantity !== null && nextCategory?.quantity !== undefined && row.share !== null
        ? safe(nextCategory.quantity * row.share)
        : null
    row.targetInventory =
      row.safetyDays === 0 ? 0 : row.safetyDays !== null && row.nextMonthDemand !== null ? safe((row.safetyDays * row.nextMonthDemand) / daysInMonth(nextMonth)) : null
    row.targetInventoryMissing =
      row.targetInventory === null
        ? [...(row.safetyDays === null ? ['safety-days-missing' as const] : []), ...(row.nextMonthDemand === null ? ['next-month-demand-missing' as const] : [])]
        : []
    if (row.targetInventory === null && !row.targetInventoryMissing.length) row.targetInventoryMissing.push('invalid-target-inventory')
    row.missing.targetInventory = row.targetInventoryMissing.map(reason =>
      reason === 'safety-days-missing' ? `${row.month} 缺有效安全天数` : reason === 'next-month-demand-missing' ? `${nextMonth} 缺下月有效需求` : '推导目标库存超出有效范围'
    )
    if (row.month !== input.context.month) {
      const previous = rowIndex.get(periodKey({ month: monthOffset(row.month, -1), base: row.base, code: row.code }))?.[0]
      row.openingInventory = previous?.projectedClosing ?? null
    }
    row.missing.openingInventory = row.openingInventory === null ? ['缺上月结存或上月期末参考'] : []
    row.requiredProduction =
      row.demand !== null && row.targetInventory !== null && row.openingInventory !== null ? safe(Math.max(0, row.demand + row.targetInventory - row.openingInventory)) : null
    row.projectedClosing =
      row.requiredProduction !== null && row.openingInventory !== null && row.demand !== null ? safe(row.openingInventory + row.requiredProduction - row.demand) : null
    row.missing.requiredProduction = row.requiredProduction === null ? ['缺需求、安全库存或期初结存'] : []
    row.missing.projectedClosing = row.projectedClosing === null ? ['缺所需生产或库存数据'] : []
    row.missing.mainPlan = ['所需生产由需求、库存和已采用规则推导，未生成可执行主计划']
    row.missing.transfer = ['调拨、外协需人工决策，未自动生成']
    row.productionDays = productionDays(row.base, row.month)
    const weights = (input.unitWeights ?? []).filter(weight => key(weight) === key(row))
    const weight = weights[0]?.tonsPerPiece ?? null
    row.requiredProductionTons = weights.length === 1 && finite(weight) && weight > 0 && row.requiredProduction !== null ? safe(row.requiredProduction * weight) : null
    row.missing.requiredProductionTons = row.requiredProductionTons === null ? ['缺明确SKU件吨系数或所需生产，禁止由日产吨/日产件推断重量'] : []
    row.missing.productionDays = row.productionDays === null ? ['缺基地月份显式可用生产天数'] : row.productionDays === 0 ? ['可用生产天数为0，负荷比率未定义'] : []
    row.missing.resourceAssignments = []
    row.missing.monthlyCapacity = ['按唯一资源评估共享产能，不生成SKU可加总月产能']
    row.missing.load = ['负荷及缺口见隧道、成型机逐资源评估']
    row.missing.gap = ['缺口见隧道、成型机逐资源评估，SKU缺口未分配']
  }
  const resources = groupBy(input.resources ?? [], resource => resource.id)
  const allocations = input.resourceAssignments ?? []
  const invalidAssignments = new Map<string, Set<MpsResource['kind'] | 'unknown'>>()
  for (const row of rows) {
    const invalidKinds = new Set<MpsResource['kind'] | 'unknown'>()
    invalidAssignments.set(row.id, invalidKinds)
    for (const kind of ['tunnel', 'forming'] as const) {
      const candidates = [...resources.values()].flat().filter(resource => resource.base === row.base && resource.kind === kind)
      const assigned = allocations.filter(
        assignment => assignment.month === row.month && key(assignment) === key(row) && candidates.some(resource => resource.id === assignment.resourceId)
      )
      const total = assigned.reduce((sum, assignment) => sum + assignment.share, 0)
      const valid =
        candidates.length > 0 &&
        assigned.length > 0 &&
        assigned.every(assignment => finite(assignment.share) && assignment.share >= 0 && assignment.share <= 1 && resources.get(assignment.resourceId)?.length === 1) &&
        new Set(assigned.map(assignment => assignment.resourceId)).size === assigned.length &&
        Math.abs(total - 1) <= 1e-12
      if (!valid) {
        invalidKinds.add(kind)
        row.missing.resourceAssignments.push(`${kind === 'tunnel' ? '隧道' : '成型机'}资源缺失、重复或未明确分配，不能认定全约束通过`)
      }
    }
    const unknown = allocations.some(
      assignment =>
        assignment.month === row.month &&
        key(assignment) === key(row) &&
        !(input.resources ?? []).some(resource => resource.id === assignment.resourceId && resource.base === row.base)
    )
    if (unknown) {
      invalidKinds.add('unknown')
      row.missing.resourceAssignments.push('资源分配指向未知资源或其他基地')
    }
  }
  const resourceLoads: MpsResourceLoad[] = []
  for (const entries of resources.values()) {
    const resource = entries[0]
    if (!resource) continue
    for (const month of months.slice(0, 3)) {
      const stopped = ruleStopsResource(resource, month, resolvedRules.rules)
      const dailyTons = stopped ? 0 : resource.dailyTons
      const applicable = rows.filter(row => row.base === resource.base && row.month === month)
      const missing: string[] = []
      if (!resource.id || !resource.base || entries.length !== 1) missing.push('资源唯一键缺失或重复')
      if (!stopped && (!finite(dailyTons) || dailyTons <= 0)) missing.push('缺有效资源日产吨数')
      const days = productionDays(resource.base, month)
      if (!stopped && (days === null || days === 0)) missing.push('缺有效基地月份生产天数或天数为0')
      if (!applicable.length) missing.push('资源基地没有本版产品范围')
      for (const row of applicable) {
        const kindLabel = resource.kind === 'tunnel' ? '隧道' : '成型机'
        if (invalidAssignments.get(row.id)?.has(resource.kind) || invalidAssignments.get(row.id)?.has('unknown')) missing.push(`${row.code} 缺有效${kindLabel}资源分配`)
        if (row.requiredProductionTons === null) missing.push(`${row.code} 所需生产吨数未知`)
      }
      const quantities = applicable.map(row => {
        const assigned = allocations.filter(assignment => assignment.month === month && key(assignment) === key(row) && assignment.resourceId === resource.id)
        const assignedShare = assigned.reduce((sum, assignment) => sum + assignment.share, 0)
        return { quantity: row.requiredProductionTons !== null ? safe(row.requiredProductionTons * assignedShare) : null }
      })
      const allocationComplete =
        Boolean(resource.id && resource.base) &&
        entries.length === 1 &&
        applicable.length > 0 &&
        applicable.every(row => !invalidAssignments.get(row.id)?.has(resource.kind) && !invalidAssignments.get(row.id)?.has('unknown') && row.requiredProductionTons !== null)
      const requiredTons = allocationComplete ? quantity(quantities) : null
      const requiredDays = requiredTons !== null && finite(dailyTons) && dailyTons > 0 ? safe(requiredTons / dailyTons) : null
      const load = !missing.length && requiredDays !== null && days !== null && days > 0 ? safe(requiredDays / days) : null
      const overloadDays = requiredDays !== null && days !== null ? safe(Math.max(0, requiredDays - days)) : null
      const gapTons = stopped
        ? requiredTons
        : requiredTons !== null && days !== null && finite(dailyTons) && dailyTons >= 0
          ? safe(Math.max(0, requiredTons - dailyTons * days))
          : null
      resourceLoads.push({
        ...resource,
        resourceId: resource.id,
        dailyTons,
        month,
        productionDays: days,
        requiredTons,
        requiredDays,
        load,
        overloadDays,
        gapTons,
        status:
          stopped && !missing.length && requiredTons !== null
            ? requiredTons > 0
              ? 'overload'
              : 'normal'
            : load === null
              ? 'unknown'
              : load < 0.9
                ? 'normal'
                : load <= 1.05
                  ? 'warning'
                  : 'overload',
        missing: [...new Set(missing)]
      })
    }
  }
  for (const edit of input.adjustments?.shares ?? []) {
    if (!rows.some(row => row.id === edit.rowId)) adjustmentIssues.push('占比调整不属于本版月份或产品范围')
  }
  for (const edit of input.adjustments?.categoryDemand ?? []) {
    if (!categoryRows.some(row => row.month === edit.month && row.category === edit.category)) adjustmentIssues.push('大类需求调整不属于本版月份或分类范围')
  }
  for (const edit of input.adjustments?.quantities ?? []) {
    if (!rows.some(row => row.month === edit.month && row.category === edit.category)) adjustmentIssues.push('数量调整不属于本版月份或产品范围')
  }
  const demandScope = categoryRows.filter(category => months.slice(0, 3).includes(category.month))
  const categoryScopeIssues = demandScope.flatMap(category => {
    if (rows.some(row => row.month === category.month && row.category === category.category)) return []
    if (category.quantity === null) return [`${category.month} ${category.category} 缺大类需求，完整生产吨数未知`]
    if (category.quantity > 0) return [`${category.month} ${category.category} 缺月度SKU域，大类需求未拆分`]
    return []
  })
  const ruleEvaluations = evaluateMpsRules(resolvedRules, rows, resourceLoads, months.slice(0, 3))
  const blockingRules = ruleEvaluations.filter(
    entry =>
      ['conflict', 'pending', 'draft'].includes(entry.status) &&
      (resolvedRules.rules.some(rule => rule.id === entry.ruleId && (rule.strength === '硬' || rule.accepted)) || entry.status === 'draft')
  )
  const summaryMissing = [...new Set(rows.flatMap(row => [...row.missing.requiredProductionTons, ...row.missing.productionDays, ...row.missing.resourceAssignments]))]
  const summary = {
    requiredProductionTons: categoryScopeIssues.length ? null : rows.length ? quantity(rows.map(row => ({ quantity: row.requiredProductionTons }))) : demandScope.length ? 0 : null,
    knownRequiredProductionTons: safe(rows.reduce((sum, row) => sum + (row.requiredProductionTons ?? 0), 0)),
    evaluatedRows: rows.filter(
      row =>
        !blockingRules.some(
          entry =>
            entry.month === row.month &&
            resolvedRules.rules.some(
              rule =>
                rule.id === entry.ruleId &&
                (!rule.base || rule.base === row.base) &&
                (!rule.code || rule.code === row.code) &&
                (!rule.productCategory || rule.productCategory === row.category)
            )
        ) &&
        row.requiredProductionTons !== null &&
        row.productionDays !== null &&
        row.productionDays > 0 &&
        !row.missing.resourceAssignments.length &&
        !resourceLoads.some(resource => resource.month === row.month && resource.base === row.base && resource.load === null)
    ).length,
    totalRows: rows.length,
    missing: [
      ...new Set([
        ...(rows.length || demandScope.length ? [] : ['缺本版产品范围']),
        ...scopeIssues,
        ...categoryScopeIssues,
        ...summaryMissing,
        ...blockingRules.map(entry => `${entry.month} 规则${entry.ruleId}：${entry.reason}`),
        ...resourceLoads.flatMap(resource => resource.missing)
      ])
    ]
  }
  return {
    ruleEvaluations,
    scopeCoverage: input.scopeCoverage ?? 'in-scope',
    excludedSources,
    excludedCategoryDemand,
    adjustmentIssues,
    resourceLoads,
    summary,
    context: { ...input.context },
    months,
    shipmentMonth: monthOffset(input.context.month, -1),
    categoryRows,
    rows,
    constraints: {
      safetyDays: input.constraints.safetyDays.map(row => ({ ...row })),
      rules: { ...input.constraints.rules }
    },
    missing: [
      ...new Set(scopeIssues),
      ...(input.scopeCoverage === 'national' ? [] : ['产品池全国覆盖尚未取得实际证明，仅报告范围内结果']),
      '库存下限、生产天数及停用资源按有效约束计算；可执行主计划、调拨及外协方案未生成',
      '正式约束表与保存接口尚未就绪'
    ]
  }
}
