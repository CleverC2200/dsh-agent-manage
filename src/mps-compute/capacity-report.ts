import type { MpsPlanInput, solveMpsPlan } from './plan.ts'
import type { MpsQuantityRow } from './workflow.ts'
import { resolveMpsRules, ruleProductionDays, ruleStopsResource } from './constraint-rules.ts'

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
  const referenceMonth = annual?.referenceMonth ?? input.context.month
  const annualRows = (annual?.rows ?? []).filter(row => row.base !== '全国')
  const fiscalMonths = capacityFiscalMonths(referenceMonth)
  const months = [...new Set([...fiscalMonths, referenceMonth, ...Array.from({ length: 4 }, (_, index) => offset(input.context.month, index))])].sort()
  const weightIndex = new Map<string, NonNullable<MpsPlanInput['unitWeights']>>()
  for (const row of input.unitWeights ?? []) {
    const key = JSON.stringify([row.base, row.code])
    weightIndex.set(key, [...(weightIndex.get(key) ?? []), row])
  }
  const annualTons = (row: MpsQuantityRow) => {
    if (row.quantity === 0) return 0
    const weight = weightIndex.get(JSON.stringify([row.base, row.code])) ?? []
    return row.quantity !== null && row.quantity >= 0 && weight.length === 1 && weight[0].tonsPerPiece !== null && weight[0].tonsPerPiece > 0
      ? row.quantity * weight[0].tonsPerPiece
      : null
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
        days,
        dailyTons,
        capacity: existing?.capacity ?? (days !== null && dailyTons !== null ? days * dailyTons : null)
      }
    })
  )
  const candidates = input.planCandidates ?? (input.resourceAssignments ?? []).filter(row => row.share > 0)
  const categoryByCode = new Map<string, Set<string>>()
  for (const product of input.products) {
    const categories = categoryByCode.get(product.code) ?? new Set<string>()
    categories.add(product.category)
    categoryByCode.set(product.code, categories)
  }
  const productCodes = new Set(input.products.map(row => row.code))
  for (const row of annualRows)
    if (!productCodes.has(row.code) && row.category) {
      const categories = categoryByCode.get(row.code) ?? new Set<string>()
      categories.add(row.category)
      categoryByCode.set(row.code, categories)
    }
  const candidateIndex = new Map<string, typeof candidates>()
  const categoryResources = new Map<string, typeof candidates>()
  for (const row of candidates) {
    const key = JSON.stringify([row.base, row.code])
    candidateIndex.set(key, [...(candidateIndex.get(key) ?? []), row])
    const categories = categoryByCode.get(row.code)
    if (categories?.size !== 1) continue
    for (const category of categories) {
      const group = JSON.stringify([row.base, category])
      categoryResources.set(group, [...(categoryResources.get(group) ?? []), row])
    }
  }
  interface DemandIssue {
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
  const demandIssues: DemandIssue[] = plan.rows
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
  const productsByCode = new Map(input.products.map(row => [row.code, row]))
  if (!plan.months.includes(referenceMonth))
    for (const row of annualRows) {
      if (row.month !== referenceMonth) continue
      const product = productsByPair.get(JSON.stringify([row.base, row.code])) ?? productsByCode.get(row.code)
      reportRows.push({
        month: row.month,
        base: row.base,
        code: row.code,
        category: product?.category ?? row.category ?? '分类待核对',
        group: product?.group ?? row.group ?? '物料组待核对',
        series: product?.series ?? row.series ?? row.group ?? '系列待核对',
        demandTons: annualTons(row)
      })
      if (annualTons(row) === null)
        demandIssues.push({
          month: row.month,
          base: row.base,
          code: row.code,
          name: product?.name ?? row.code,
          category: product?.category ?? row.category ?? '分类待核对',
          group: product?.group ?? row.group ?? '',
          kind: row.quantity === null ? '缺年度需求' : '缺件吨系数',
          reason: row.quantity === null ? '年度需求为空或同键值冲突' : '年度需求未取得有效吨/件',
          referenceCode: row.code,
          sourceTable: row.quantity === null ? 'ai_db.agents_dim_demand_annual_mi' : 'ai_db.agents_dim_material_prod_sales_info_d',
          fields: row.quantity === null ? 'belong_base / material_code / stat_month / demand_qty' : 'material_code / channel_name / ton_per_piece'
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
      const ownRows = rows.filter(assigned)
      const unassigned = rows.filter(row => !assigned(row))
      const demand = ownRows.length ? sum(ownRows.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
      const orphanDemand = unassigned.length ? sum(unassigned.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
      const capacity = sum(physical.map(row => row.capacity)).value
      const dailyTons = sum(physical.map(row => row.dailyTons)).value
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      const seriesGroups = new Map<string, typeof rows>()
      for (const row of rows) seriesGroups.set(row.group, [...(seriesGroups.get(row.group) ?? []), row])
      const series = [...seriesGroups].map(([group, items]) => {
        const eligible = items.filter(assigned)
        const quantity = eligible.length ? sum(eligible.map(row => row.demandTons)) : { value: 0, known: 0, missing: 0 }
        const orphan = items.filter(row => !assigned(row))
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
      const demand = sum(rows.map(row => row.demandTons))
      const capacity = sum(selected.map(row => row.capacity)).value
      const dailyTons = sum(selected.map(row => row.dailyTons)).value
      const days = [...new Set(selected.map(row => row.days))]
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      return {
        month,
        base,
        lines: selected.length,
        demand,
        dailyTons,
        days: days.length === 1 ? days[0] : null,
        capacity,
        load,
        knownLoad: capacity !== null && capacity > 0 && rows.length > demand.missing ? demand.known / capacity : null,
        band: capacityLoadBand(load),
        margin: demand.value !== null && capacity !== null ? capacity - demand.value : null
      }
    })
  )
  const annualTotals = months.flatMap(month =>
    [...bases, '全国'].map(base => {
      const rows = annualRows.filter(row => row.month === month && (base === '全国' || row.base === base))
      const unknown = (annual?.unmapped ?? []).filter(row => !row.month || row.month === month).map(() => null)
      const demand = sum([...rows.map(annualTons), ...unknown])
      const capacity = totals.find(row => row.month === month && row.base === base)?.capacity ?? null
      const load = demand.value !== null && capacity !== null && capacity > 0 ? demand.value / capacity : null
      return {
        month,
        base,
        demand,
        capacity,
        load,
        knownLoad: capacity !== null && capacity > 0 && rows.some(row => annualTons(row) !== null) ? demand.known / capacity : null,
        band: capacityLoadBand(load)
      }
    })
  )
  if (!plan.months.includes(referenceMonth))
    for (const total of totals.filter(row => row.month === referenceMonth)) {
      const row = annualTotals.find(row => row.month === referenceMonth && row.base === total.base)
      if (!row) continue
      total.demand = row.demand
      total.load = row.load
      total.knownLoad = row.knownLoad
      total.band = row.band
      total.margin = row.demand.value !== null && total.capacity !== null ? total.capacity - row.demand.value : null
    }
  const annualIssues = new Map<string, { base: string; code: string; months: string[]; reason: string; sourceTable: string; fields: string }>()
  const weightGaps = new Map((annual?.unitWeightGaps ?? []).map(row => [JSON.stringify([row.base, row.code]), row]))
  for (const row of annualRows)
    if (annualTons(row) === null) {
      const quantityMissing = row.quantity === null || row.quantity < 0
      const key = JSON.stringify([row.base, row.code, quantityMissing])
      const gap = weightGaps.get(JSON.stringify([row.base, row.code]))
      const current = annualIssues.get(key) ?? {
        base: row.base,
        code: row.code,
        months: [],
        reason: quantityMissing ? '年度需求为空、冲突或无效' : gap?.reason || '缺唯一有效件吨系数',
        sourceTable: quantityMissing ? 'ai_db.agents_dim_demand_annual_mi' : gap?.sourceTable || 'ai_db.agents_dim_material_prod_sales_info_d',
        fields: quantityMissing ? 'stat_month / belong_base / material_code / demand_qty' : 'material_code / channel_name / ton_per_piece'
      }
      current.months.push(row.month)
      annualIssues.set(key, current)
    }
  return {
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
      aggregateRows: (annual?.rows ?? []).length - annualRows.length,
      excludedRows: annual?.excludedRows ?? 0,
      unmappedCount: annual?.unmapped?.length ?? 0,
      unmappedPreview: annual?.unmapped?.slice(0, 25) ?? [],
      error: [annual?.error, annual?.weightError].filter(Boolean).join('；') || (annual ? '' : '全年年度SKU需求尚未读取')
    },
    gaps: rccp.filter(row => row.gap !== null && row.gap > 0)
  }
}
