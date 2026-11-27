import type { MpsPlanInput, solveMpsPlan } from './plan.ts'
import type { MpsQuantityRow } from './workflow.ts'
import { resolveMpsRules, ruleProductionDays, ruleStopsResource } from './constraint-rules.ts'

export interface MpsDemandIssue {
  month: string
  base: string
  code: string
  name: string
  category: string
  group: string
  kind: string
  reason: string
  referenceCode: string
  sourceTable: string
  fields: string
}

const offset = (month: string, count: number) => {
  const date = new Date(`${month}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + count)
  return date.toISOString().slice(0, 7)
}
const sum = (values: (number | null)[]) => {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return {
    value: values.length && known.length === values.length ? known.reduce((a, b) => a + b, 0) : null,
    known: known.reduce((a, b) => a + b, 0),
    missing: values.length - known.length
  }
}
export const capacityLoadBand = (load: number | null) => (load === null ? 'unknown' : load > 1.05 ? 'overload' : load >= 0.9 ? 'warning' : 'normal')

export function capacityFiscalMonths(month: string) {
  const start = `${Number(month.slice(0, 4)) - (Number(month.slice(5)) < 7 ? 1 : 0)}-07`
  return Array.from({ length: 12 }, (_, index) => offset(start, index))
}
interface AnnualCapacityInput {
  rows: (MpsQuantityRow & Partial<Pick<MpsPlanInput['products'][number], 'group' | 'series'>>)[]
  referenceMonth?: string
  error?: string
  weightError?: string
  excludedRows?: number
  unmapped?: { month: string | null; code: string; reason: string }[]
  unitWeightGaps?: { base: string; code: string; reason: string; sourceTable: string }[]
}

export function buildCapacityReport(input: MpsPlanInput, plan: ReturnType<typeof solveMpsPlan>, annual?: AnnualCapacityInput) {
  const odmCodes = new Set([...(input.odmProductCodes ?? []), ...(input.odmSupplies ?? []).map(row => row.code), ...(input.odmConflicts ?? []).map(row => row.code)])
  const zero = { value: 0, known: 0, missing: 0 }
  const referenceMonth = annual?.referenceMonth ?? input.context.month
  const productPairs = new Set(input.products.map(row => JSON.stringify([row.base, row.code])))
  const annualRows = (annual?.rows ?? []).filter(row => productPairs.has(JSON.stringify([row.base, row.code])))
  const fiscalMonths = capacityFiscalMonths(referenceMonth)
  const months = [...new Set([...fiscalMonths, referenceMonth, ...Array.from({ length: 4 }, (_, index) => offset(input.context.month, index))])].sort()
  const weightIndex = new Map<string, NonNullable<MpsPlanInput['unitWeights']>>()
  for (const row of input.unitWeights ?? []) {
    const key = JSON.stringify([row.base, row.code])
    weightIndex.set(key, [...(weightIndex.get(key) ?? []), row])
  }
  const annualQuantity = (row: MpsQuantityRow) => (row.quantity !== null && Number.isFinite(row.quantity) && row.quantity >= 0 ? row.quantity : null)
  const annualTons = (row: MpsQuantityRow) => {
    const quantity = annualQuantity(row) ?? 0
    if (quantity === 0) return 0
    const weight = weightIndex.get(JSON.stringify([row.base, row.code])) ?? []
    return weight.length === 1 && weight[0].tonsPerPiece !== null && weight[0].tonsPerPiece > 0 ? quantity * weight[0].tonsPerPiece : null
  }
  const resources = (input.resources ?? []).filter(row => row.kind === 'tunnel' && plan.resourceSchedules.some(schedule => schedule.resourceId === row.id))
  const rules = resolveMpsRules(input, months).rules
  const schedules = new Map(plan.resourceSchedules.map(row => [JSON.stringify([row.month, row.resourceId]), row]))
  const lines = months.flatMap(month =>
    resources.map(resource => {
      const existing = schedules.get(JSON.stringify([month, resource.id]))
      const calendar = (input.productionDays ?? []).filter(row => row.base === resource.base && row.month === month)
      const days = existing?.days ?? ruleProductionDays(calendar.length === 1 ? calendar[0].days : null, resource.base, month, rules)
      const dailyTons = existing?.dailyTons ?? (ruleStopsResource(resource, month, rules) ? 0 : resource.dailyTons)
      return {
        month,
        base: resource.base,
        resourceId: resource.id,
        name: resource.name,
        workshop: resource.workshop ?? '',
        productionLines: resource.productionLines ?? [],
        tunnel: resource.tunnel ?? '',
        scheduledTons: existing?.scheduledTons ?? null,
        days,
        dailyTons,
        capacity: existing?.capacity ?? (days !== null && dailyTons !== null ? days * dailyTons : null)
      }
    })
  )
  const candidates = input.planCandidates ?? (input.resourceAssignments ?? []).filter(row => row.share > 0)
  const categoryByPair = new Map<string, Set<string>>()
  for (const product of input.products) {
    const categories = categoryByPair.get(JSON.stringify([product.base, product.code])) ?? new Set<string>()
    categories.add(product.category)
    categoryByPair.set(JSON.stringify([product.base, product.code]), categories)
  }
  const candidateIndex = new Map<string, typeof candidates>()
  const categoryResources = new Map<string, typeof candidates>()
  for (const row of candidates) {
    const key = JSON.stringify([row.base, row.code])
    candidateIndex.set(key, [...(candidateIndex.get(key) ?? []), row])
    const categories = categoryByPair.get(JSON.stringify([row.base, row.code]))
    if (categories?.size !== 1) continue
    for (const category of categories) {
      const group = JSON.stringify([row.base, category])
      categoryResources.set(group, [...(categoryResources.get(group) ?? []), row])
    }
  }

  const demandIssues: MpsDemandIssue[] = plan.rows
    .filter(row => row.demandTons === null)
    .map(row => {
      const categoryMissing = row.missing.demand.some(reason => reason.includes('大类需求'))
      const historyMissing = row.demand === null && row.historyQuantity === null
      return {
        month: row.month,
        base: row.base,
        code: row.code,
        name: row.name,
        category: row.category,
        group: row.group,
        kind: categoryMissing ? '缺大类需求' : historyMissing ? '缺历史拆分依据' : row.demand === null ? '缺拆分依据' : '缺件吨系数',
        reason: row.demand === null ? row.missing.demand.join('；') : '无法取得唯一有效吨/件，需求不能折吨',
        referenceCode: row.historyCode || row.code,
        sourceTable: categoryMissing
          ? '大类需求测算与年度环比'
          : historyMissing
            ? 'ai_db.agents_scm_cust_deliv_daily_di'
            : row.demand === null
              ? '计划提报与历史拆分系数'
              : 'ai_db.agents_dim_material_prod_sales_info_d',
        fields: historyMissing
          ? 'belong_base / material_code / shipment_date / act_dl_qty_total'
          : row.demand === null
            ? '有效需求 / 拆分系数'
            : 'material_code / channel_name / ton_per_piece'
      }
    })
  type ReportRow = Pick<(typeof plan.rows)[number], 'month' | 'base' | 'code' | 'category' | 'group' | 'series' | 'demandTons'>
  const reportRows: ReportRow[] = [...plan.rows]
  const productsByPair = new Map(input.products.map(row => [JSON.stringify([row.base, row.code]), row]))
  if (!plan.months.includes(referenceMonth))
    for (const row of annualRows) {
      if (row.month !== referenceMonth) continue
      const product = productsByPair.get(JSON.stringify([row.base, row.code]))
      const demandTons = annualTons(row)
      reportRows.push({
        month: row.month,
        base: row.base,
        code: row.code,
        category: product?.category ?? row.category ?? '分类待核对',
        group: product?.group ?? row.group ?? '物料组待核对',
        series: product?.series ?? row.series ?? row.group ?? '系列待核对',
        demandTons
      })
      if (demandTons === null)
        demandIssues.push({
          month: row.month,
          base: row.base,
          code: row.code,
          name: product?.name ?? row.code,
          category: product?.category ?? row.category ?? '分类待核对',
          group: product?.group ?? row.group ?? '',
          kind: '缺件吨系数',
          reason: '年度需求未取得有效吨/件',
          referenceCode: row.code,
          sourceTable: 'ai_db.agents_dim_material_prod_sales_info_d',
          fields: 'material_code / channel_name / ton_per_piece'
        })
    }
  const groups = new Map<string, ReportRow[]>()
  for (const row of reportRows) {
    const key = JSON.stringify([row.month, row.base, row.category])
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const rccp = [...groups.values()]
    .map(rows => {
      const first = rows[0]
      const ids = new Set(
        (categoryResources.get(JSON.stringify([first.base, first.category])) ?? []).filter(row => !row.month || row.month === first.month).map(row => row.resourceId)
      )
      const physical = lines.filter(row => row.month === first.month && row.base === first.base && ids.has(row.resourceId))
      const assigned = (row: typeof first) =>
        (candidateIndex.get(JSON.stringify([row.base, row.code])) ?? []).some(
          candidate => (!candidate.month || candidate.month === row.month) && resources.some(resource => resource.id === candidate.resourceId && resource.base === row.base)
        )
      const ownRows = rows.filter(row => !odmCodes.has(row.code) && assigned(row))
      const unassigned = rows.filter(row => !odmCodes.has(row.code) && !assigned(row))
      const demand = ownRows.length ? sum(ownRows.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
      const orphanDemand = unassigned.length ? sum(unassigned.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
      const capacity = sum(physical.map(row => row.capacity)).value
      const dailyTons = sum(physical.map(row => row.dailyTons)).value
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      const seriesGroups = new Map<string, typeof rows>()
      for (const row of rows) seriesGroups.set(row.group, [...(seriesGroups.get(row.group) ?? []), row])
      const series = [...seriesGroups].map(([group, items]) => {
        const eligible = items.filter(row => !odmCodes.has(row.code) && assigned(row))
        const quantity = eligible.length ? sum(eligible.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
        const orphan = items.filter(row => !odmCodes.has(row.code) && !assigned(row))
        const share = quantity.value !== null && demand.value !== null && demand.value > 0 ? quantity.value / demand.value : null
        const quota = share !== null && capacity !== null ? capacity * share : null
        return {
          group,
          name: items[0].series || group,
          demand: quantity,
          unassigned: orphan.length ? sum(orphan.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 },
          share,
          quota,
          excess: quantity.value !== null && quota !== null ? quantity.value - quota : null
        }
      })
      return {
        month: first.month,
        base: first.base,
        category: first.category,
        demand,
        unassigned: orphanDemand,
        odmDemand: rows.some(row => odmCodes.has(row.code)) ? sum(rows.filter(row => odmCodes.has(row.code)).map(row => row.demandTons)) : zero,
        dailyTons,
        capacity,
        load,
        knownLoad: capacity !== null && capacity > 0 && (demand.value !== null || ownRows.length > demand.missing) ? demand.known / capacity : null,
        band: capacityLoadBand(load),
        margin: demand.value !== null && capacity !== null ? capacity - demand.value : null,
        gap: demand.value !== null && capacity !== null ? Math.max(0, demand.value - capacity) : null,
        series
      }
    })
    .sort((a, b) => (b.load ?? -1) - (a.load ?? -1))
  const bases = [...new Set([...resources.map(row => row.base), ...plan.rows.map(row => row.base)])].sort()
  const totals = months.flatMap(month =>
    [...bases, '全国'].map(base => {
      const selected = lines.filter(row => row.month === month && (base === '全国' || row.base === base))
      const rows = plan.rows.filter(row => row.month === month && (base === '全国' || row.base === base))
      const internal = rows.filter(row => !odmCodes.has(row.code))
      const external = rows.filter(row => odmCodes.has(row.code))
      const demand = internal.length ? sum(internal.map(row => row.demandTons)) : external.length ? zero : sum([])
      const capacity = sum(selected.map(row => row.capacity)).value
      const dailyTons = sum(selected.map(row => row.dailyTons)).value
      const days = [...new Set(selected.map(row => row.days))]
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      return {
        month,
        base,
        lines: selected.length,
        demand,
        odmDemand: external.length ? sum(external.map(row => row.demandTons)) : zero,
        dailyTons,
        days: days.length === 1 ? days[0] : null,
        capacity,
        load,
        knownLoad: capacity !== null && capacity > 0 && internal.length > demand.missing ? demand.known / capacity : null,
        band: capacityLoadBand(load),
        margin: demand.value !== null && capacity !== null ? capacity - demand.value : null
      }
    })
  )
  const annualTotals = months.flatMap(month =>
    [...bases, '全国'].map(base => {
      const rows = annualRows.filter(row => row.month === month && (base === '全国' || row.base === base))
      const unknown = (annual?.unmapped ?? []).filter(row => !row.month || row.month === month).map(() => null)
      const internal = rows.filter(row => !odmCodes.has(row.code))
      const external = rows.filter(row => odmCodes.has(row.code))
      const quantities = [...internal.map(annualTons), ...unknown]
      const demand = !quantities.length && annual && !annual.error ? zero : sum(quantities)
      const capacity = totals.find(row => row.month === month && row.base === base)?.capacity ?? null
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      return {
        month,
        base,
        demand,
        odmDemand: external.length ? sum(external.map(annualTons)) : zero,
        capacity,
        load,
        knownLoad: capacity !== null && capacity > 0 && internal.some(row => annualTons(row) !== null) ? demand.known / capacity : null,
        band: capacityLoadBand(load)
      }
    })
  )
  if (!plan.months.includes(referenceMonth))
    for (const total of totals.filter(row => row.month === referenceMonth)) {
      const row = annualTotals.find(row => row.month === referenceMonth && row.base === total.base)
      if (!row) continue
      total.odmDemand = row.odmDemand
      total.demand = row.demand
      total.load = row.load
      total.knownLoad = row.knownLoad
      total.band = row.band
      total.margin = row.demand.value !== null && total.capacity !== null ? total.capacity - row.demand.value : null
    }
  const annualIssues = new Map<string, { base: string; code: string; months: string[]; defaultedDemand: boolean; reason: string; sourceTable: string; fields: string }>()
  const weightGaps = new Map((annual?.unitWeightGaps ?? []).map(row => [JSON.stringify([row.base, row.code]), row]))
  for (const row of annualRows) {
    const defaultedDemand = annualQuantity(row) === null
    if (!defaultedDemand && annualTons(row) !== null) continue
    const key = JSON.stringify([row.base, row.code, defaultedDemand])
    const gap = weightGaps.get(JSON.stringify([row.base, row.code]))
    const current = annualIssues.get(key) ?? {
      base: row.base,
      code: row.code,
      months: [],
      defaultedDemand,
      reason: defaultedDemand ? '年度需求为空、冲突或无效，按 0 计算' : gap?.reason || '缺唯一有效件吨系数',
      sourceTable: defaultedDemand ? 'ai_db.agents_dim_demand_annual_mi' : gap?.sourceTable || 'ai_db.agents_dim_material_prod_sales_info_d',
      fields: defaultedDemand ? 'stat_month / belong_base / material_code / demand_qty' : 'material_code / channel_name / ton_per_piece'
    }
    current.months.push(row.month)
    annualIssues.set(key, current)
  }
  const productDetails = reportRows.map(row => {
    const resourceIds = [
      ...new Set(
        (candidateIndex.get(JSON.stringify([row.base, row.code])) ?? [])
          .filter(
            candidate => (!candidate.month || candidate.month === row.month) && resources.some(resource => resource.id === candidate.resourceId && resource.base === row.base)
          )
          .map(candidate => candidate.resourceId)
      )
    ]
    return { ...row, name: productsByPair.get(JSON.stringify([row.base, row.code]))?.name ?? row.code, odm: odmCodes.has(row.code), resourceIds }
  })
  const hierarchyIssues = resources.flatMap(resource =>
    [
      ...(!resource.workshop ? ['车间归属待补'] : []),
      ...(!resource.productionLines?.length ? ['产线归属待补：来源未提供独立产线'] : []),
      ...(!resource.tunnel ? ['隧道号待补'] : [])
    ].map(reason => ({
      base: resource.base,
      resourceId: resource.id,
      name: resource.name,
      reason,
      sourceTable: resource.id.startsWith('source:') ? 'ai_db.agents_dim_tunnel_capacity_mi' : '人工资源配置'
    }))
  )
  for (const row of productDetails.filter(row => !row.odm && !row.resourceIds.length))
    demandIssues.push({
      month: row.month,
      base: row.base,
      code: row.code,
      name: row.name,
      category: row.category,
      group: row.group,
      kind: '无有效设备关联',
      reason: '未取得本基地有效物理隧道关联，需求未归属设备',
      referenceCode: row.code,
      sourceTable: 'ai_db.agents_dim_production_line_sku_capacity_mi / 人工资源配置',
      fields: 'belong_base / material_code / workshop / tunnel_no / resourceId'
    })
  return {
    productDetails,
    allocations: plan.allocations,
    hierarchyIssues,
    referenceMonth,
    fiscalMonths,
    months,
    bases,
    totals,
    rccp,
    lines,
    demandIssues,
    annualTotals,
    annualIssues: [...annualIssues.values()],
    annualSource: {
      table: 'ai_db.agents_dim_demand_annual_mi',
      records: annual?.rows.length ?? 0,
      aggregateRows: (annual?.rows ?? []).filter(row => row.base === '全国').length,
      excludedRows: (annual?.excludedRows ?? 0) + (annual?.rows ?? []).filter(row => row.base !== '全国' && !productPairs.has(JSON.stringify([row.base, row.code]))).length,
      unmappedCount: annual?.unmapped?.length ?? 0,
      unmappedPreview: annual?.unmapped?.slice(0, 25) ?? [],
      error: [annual?.error, annual?.weightError].filter(Boolean).join('；') || (annual ? '' : '全年年度SKU需求尚未读取')
    },
    gaps: rccp.filter(row => row.gap !== null && row.gap > 0)
  }
}

export function selectCapacityScope(
  report: ReturnType<typeof buildCapacityReport>,
  scope: { month: string; base?: string; workshop?: string; line?: string; resourceId?: string },
  level: 'category' | 'group' | 'sku' = 'category'
) {
  const lines = report.lines.filter(
    row =>
      row.month === scope.month &&
      (!scope.base || row.base === scope.base) &&
      (scope.workshop === undefined || row.workshop === scope.workshop) &&
      (scope.line === undefined || (scope.line === '' ? !row.productionLines.length : row.productionLines.includes(scope.line))) &&
      (!scope.resourceId || row.resourceId === scope.resourceId)
  )
  const ids = new Set(lines.map(row => row.resourceId))
  const rows = report.productDetails.filter(row => row.month === scope.month && !row.odm && row.resourceIds.some(id => ids.has(id)))
  const allocations = report.allocations.filter(row => row.month === scope.month && ids.has(row.resourceId))
  const selectedRows = [...rows]
  for (const allocation of allocations) {
    if (selectedRows.some(row => row.base === allocation.demandBase && row.code === allocation.code)) continue
    const product = report.productDetails.find(row => row.month === scope.month && row.base === allocation.demandBase && row.code === allocation.code)
    if (product) selectedRows.push({ ...product, demandTons: 0 })
  }
  const grouped = new Map<string, typeof selectedRows>()
  for (const row of selectedRows) {
    const key = JSON.stringify([row.category, ...(level === 'category' ? [] : [row.group]), ...(level === 'sku' ? [row.base, row.code] : [])])
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const capacity = sum(lines.map(row => row.capacity)).value
  const demand = rows.length
    ? sum(rows.map(row => row.demandTons))
    : report.productDetails.some(row => row.month === scope.month && (!scope.base || row.base === scope.base))
      ? { value: 0, known: 0, missing: 0 }
      : sum([])
  const scheduledTons = lines.every(row => row.scheduledTons !== null) ? allocations.reduce((total, row) => total + row.tons, 0) : null
  const products = [...grouped.values()].map(items => {
    const first = items[0]
    const productDemand = sum(items.map(row => row.demandTons))
    const occupied = allocations
      .filter(allocation => items.some(row => row.base === allocation.demandBase && row.code === allocation.code))
      .reduce((total, row) => total + row.tons, 0)
    return {
      category: first.category,
      group: level === 'category' ? '' : first.group,
      base: level === 'sku' ? first.base : '',
      code: level === 'sku' ? first.code : '',
      name: level === 'sku' ? first.name : level === 'group' ? first.group : first.category,
      demand: productDemand,
      scheduledTons: scheduledTons === null ? null : occupied,
      occupancy: scheduledTons !== null && capacity !== null && capacity > 0 ? occupied / capacity : null
    }
  })
  const unassigned = report.productDetails.filter(row => row.month === scope.month && (!scope.base || row.base === scope.base) && !row.odm && !row.resourceIds.length)
  const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
  return {
    lines,
    products,
    demand,
    unassigned,
    capacity,
    dailyTons: sum(lines.map(row => row.dailyTons)).value,
    scheduledTons,
    load,
    knownLoad: capacity !== null && capacity > 0 && rows.length > demand.missing ? demand.known / capacity : null,
    band: capacityLoadBand(load)
  }
}
