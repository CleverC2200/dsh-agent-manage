import { computeMpsWorkflow, type MpsWorkflowInput, type MpsWorkflowRow } from './workflow.ts'
import { resolveMpsRules, ruleProductionDays, ruleStopsResource, ruleApplies } from './constraint-rules.ts'
import { fairAllocate } from './fair-allocation.ts'

export interface MpsPlanInput extends MpsWorkflowInput {
  planCandidates?: { base: string; code: string; resourceId: string; month?: string }[]
  transferRoutes?: { from: string; to: string; code: string; month?: string }[]
  planSourceIssues?: string[]
}
export interface MpsPlannedRow extends Omit<MpsWorkflowRow, 'evaluation'> {
  evaluation: 'capacity-constrained'
  scheduledTons: number | null
  fulfillment: number | null
  unfulfilled: number | null
  fulfilledDemand: number | null
  closingInventory: number | null
  transferIn: number | null
  transferOut: number | null
  planMissing: string[]
  demandTons: number | null
  candidateResources: string[]
}
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
const rowKey = (base: string, code: string) => JSON.stringify([base, code])
interface ResourceSchedule {
  month: string
  base: string
  resourceId: string
  name: string
  days: number | null
  dailyTons: number
  capacity: number | null
  scheduledTons: number
  load: number | null
  missing: string[]
}

export function solveMpsPlan(input: MpsPlanInput) {
  const reference = computeMpsWorkflow(input)
  const resolved = resolveMpsRules(input, reference.months.slice(0, 3))
  const resources = (input.resources ?? []).filter(row => row.kind === 'tunnel')
  const uniqueResources = resources.filter(row => resources.filter(item => item.id === row.id).length === 1 && row.id && row.base && finite(row.dailyTons) && row.dailyTons >= 0)
  const sourceIssues = [
    ...(input.planSourceIssues ?? []),
    ...reference.categoryRows
      .filter(
        category =>
          reference.months.slice(0, 3).includes(category.month) &&
          (input.categoryDemand.some(item => item.category === category.category) || category.adjusted) &&
          !reference.rows.some(row => row.month === category.month && row.category === category.category) &&
          (category.quantity === null || category.quantity > 0)
      )
      .map(category => `${category.month} ${category.category} 缺有效需求或月度SKU域，尚未拆分`),
    ...resolved.evaluations.filter(row => row.status === 'draft').map(row => row.reason)
  ]
  if (resources.length !== uniqueResources.length) sourceIssues.push('部分隧道资源编号重复、归属或能力无效，未纳入求解')
  const candidates =
    input.planCandidates ?? (input.resourceAssignments ?? []).filter(row => row.share > 0).map(({ base, code, resourceId, month }) => ({ base, code, resourceId, month }))
  const rows: MpsPlannedRow[] = reference.rows.map(row => ({
    ...row,
    missing: structuredClone(row.missing),
    evaluation: 'capacity-constrained',
    mainPlan: null,
    gap: null,
    transfer: null,
    scheduledTons: null,
    fulfillment: null,
    unfulfilled: null,
    fulfilledDemand: null,
    closingInventory: null,
    transferIn: null,
    transferOut: null,
    planMissing: [],
    demandTons: null,
    candidateResources: []
  }))
  const resourceSchedules: ResourceSchedule[] = []
  const allocations: {
    month: string
    base: string
    demandBase: string
    code: string
    rowId: string
    resourceId: string
    tons: number
    quantity: number
  }[] = []
  const transfers: {
    month: string
    from: string
    to: string
    code: string
    quantity: number
    tons: number
  }[] = []
  const previous = new Map<string, MpsPlannedRow>()
  for (const month of reference.months.slice(0, 3)) {
    const monthRows = rows.filter(row => row.month === month)
    const monthResources = uniqueResources.map((resource): ResourceSchedule => {
      const calendar = (input.productionDays ?? []).filter(row => row.base === resource.base && row.month === month)
      const day = calendar.length === 1 && finite(calendar[0].days) && calendar[0].days >= 0 ? calendar[0].days : null
      const last = new Date(`${month}-01T00:00:00Z`)
      last.setUTCMonth(last.getUTCMonth() + 1, 0)
      const days = ruleProductionDays(day !== null && day <= last.getUTCDate() ? day : null, resource.base, month, resolved.rules)
      const stopped = ruleStopsResource(resource, month, resolved.rules)
      const dailyTons = stopped ? 0 : (resource.dailyTons ?? 0)
      const capacity = stopped ? 0 : days !== null && finite(dailyTons * days) ? dailyTons * days : null
      return {
        month,
        base: resource.base,
        resourceId: resource.id,
        name: resource.name,
        days,
        dailyTons,
        capacity,
        scheduledTons: 0,
        load: null,
        missing: capacity === null ? ['缺有效生产日历或能力数值'] : []
      }
    })
    resourceSchedules.push(...monthResources)
    const capacityMap = new Map(monthResources.filter(row => row.capacity !== null).map(row => [row.resourceId, row.capacity ?? 0]))
    const weights = new Map<string, number>()
    const eligible = new Map<string, string[]>()
    const remote = new Map<string, string[]>()
    for (const row of monthRows) {
      if (month !== input.context.month) row.openingInventory = previous.get(rowKey(row.base, row.code))?.closingInventory ?? null
      row.requiredProduction =
        finite(row.demand) && finite(row.targetInventory) && finite(row.openingInventory) ? Math.max(0, row.demand + row.targetInventory - row.openingInventory) : null
      const coefficient = (input.unitWeights ?? []).filter(item => item.base === row.base && item.code === row.code)
      const weight = coefficient.length === 1 && finite(coefficient[0].tonsPerPiece) && coefficient[0].tonsPerPiece > 0 ? coefficient[0].tonsPerPiece : null
      if (weight !== null) weights.set(row.id, weight)
      row.demandTons = finite(row.demand) && weight !== null ? row.demand * weight : null
      row.requiredProductionTons = row.requiredProduction !== null && weight !== null ? row.requiredProduction * weight : null
      const own = [
        ...new Set(candidates.filter(item => item.base === row.base && item.code === row.code && (!item.month || item.month === month)).map(item => item.resourceId))
      ].filter(id => monthResources.some(resource => resource.resourceId === id && resource.base === row.base) && capacityMap.has(id))
      const routes = (input.transferRoutes ?? []).filter(
        route => route.to === row.base && route.code === row.code && route.from !== route.to && (!route.month || route.month === month)
      )
      const other = [
        ...new Set(
          candidates
            .filter(
              item =>
                item.code === row.code &&
                (!item.month || item.month === month) &&
                routes.some(route => route.from === item.base) &&
                (() => {
                  const coefficients = (input.unitWeights ?? []).filter(value => value.base === item.base && value.code === row.code)
                  return weight !== null && coefficients.length === 1 && coefficients[0].tonsPerPiece === weight
                })()
            )
            .map(item => item.resourceId)
        )
      ].filter(id => capacityMap.has(id))
      eligible.set(row.id, own)
      row.candidateResources = own
      remote.set(row.id, other)
      const pending = reference.ruleEvaluations.filter(
        entry =>
          entry.month === month &&
          ['draft', 'pending', 'conflict'].includes(entry.status) &&
          resolved.rules.some(
            rule => rule.id === entry.ruleId && ruleApplies(rule, row) && (rule.strength === '硬' || rule.accepted) && ['cost-limit', 'lead-days'].includes(rule.effect.kind)
          )
      )
      row.planMissing = [
        ...(!finite(row.demand) ? ['缺有效需求'] : []),
        ...(!finite(row.openingInventory) ? ['缺前月实际结存'] : []),
        ...(!finite(row.targetInventory) ? ['缺目标库存'] : []),
        ...(row.requiredProduction !== 0 && weight === null ? ['缺唯一有效件吨系数'] : []),
        ...(row.requiredProductionTons !== null && !finite(row.requiredProductionTons) ? ['生产吨数超出有效范围'] : []),
        ...(row.requiredProduction !== 0 && !own.length && !other.length ? ['无有效产线承接关系或生产日历'] : []),
        ...pending.map(entry => entry.reason),
        ...resolved.evaluations.filter(entry => entry.month === month && entry.status === 'draft').map(entry => entry.reason)
      ]
    }
    const demandRows = monthRows.filter(row => !row.planMissing.length && row.requiredProduction !== null)
    const demands = demandRows
      .filter(row => (row.requiredProductionTons ?? 0) > 0)
      .map(row => ({
        id: row.id,
        quantity: row.requiredProductionTons ?? 0,
        resources: eligible.get(row.id) ?? []
      }))
    const local = fairAllocate(
      demands,
      [...capacityMap].map(([id, quantity]) => ({ id, quantity }))
    )
    const remainingCapacity = new Map(
      [...capacityMap].map(([id, capacity]) => [id, Math.max(0, capacity - local.allocations.filter(row => row.resourceId === id).reduce((sum, row) => sum + row.quantity, 0))])
    )
    const localOutput = new Map(local.demands.map(row => [row.id, row.allocated]))
    const imports = demandRows
      .filter(row => (remote.get(row.id) ?? []).length && (row.requiredProductionTons ?? 0) > (localOutput.get(row.id) ?? 0))
      .map(row => ({
        id: row.id,
        quantity: Math.max(0, (row.requiredProductionTons ?? 0) - (localOutput.get(row.id) ?? 0)),
        resources: remote.get(row.id) ?? []
      }))
    const supplemental = fairAllocate(
      imports,
      [...remainingCapacity].map(([id, quantity]) => ({ id, quantity }))
    )
    const outputs = [...local.allocations, ...supplemental.allocations]
    for (const allocation of outputs) {
      const row = demandRows.find(item => item.id === allocation.demandId)
      const resource = monthResources.find(item => item.resourceId === allocation.resourceId)
      const weight = weights.get(allocation.demandId)
      if (!row || !resource || weight === undefined) continue
      allocations.push({
        month,
        base: resource.base,
        demandBase: row.base,
        code: row.code,
        rowId: row.id,
        resourceId: resource.resourceId,
        tons: allocation.quantity,
        quantity: allocation.quantity / weight
      })
    }
    for (const rule of resolved.rules) {
      if (rule.effect.kind !== 'transfer-limit' || (rule.strength !== '硬' && !rule.accepted)) continue
      const applicable = allocations.filter(item => item.month === month && item.base !== item.demandBase && monthRows.some(row => row.id === item.rowId && ruleApplies(rule, row)))
      const total = applicable.reduce((sum, row) => sum + row.tons, 0)
      if (total > rule.effect.value)
        applicable.forEach(row => {
          const ratio = rule.effect.kind === 'transfer-limit' ? rule.effect.value / total : 0
          row.tons *= ratio * (1 - 1e-12)
          row.quantity *= ratio * (1 - 1e-12)
        })
    }
    for (const resource of monthResources) {
      const assigned = allocations.filter(row => row.month === month && row.resourceId === resource.resourceId)
      const total = assigned.reduce((sum, row) => sum + row.tons, 0)
      if (resource.capacity !== null && total > resource.capacity)
        assigned.forEach(row => {
          const ratio = ((resource.capacity ?? 0) / total) * (1 - 1e-12)
          row.tons *= ratio
          row.quantity *= ratio
        })
      resource.scheduledTons = assigned.reduce((sum, row) => sum + row.tons, 0)
      resource.load = resource.capacity !== null && resource.capacity > 0 ? resource.scheduledTons / resource.capacity : null
      if (resource.capacity !== null && resource.scheduledTons > resource.capacity) throw Error('产能约束校验失败，拒绝生成结果')
    }
    transfers.push(
      ...allocations
        .filter(row => row.month === month && row.base !== row.demandBase)
        .map(row => ({
          month,
          from: row.base,
          to: row.demandBase,
          code: row.code,
          quantity: row.quantity,
          tons: row.tons
        }))
    )
    for (const row of monthRows) {
      if (!row.planMissing.length) {
        const supplied = allocations.filter(item => item.rowId === row.id)
        const own = supplied.filter(item => item.base === row.base).reduce((sum, item) => sum + item.quantity, 0)
        const incoming = supplied.filter(item => item.base !== row.base).reduce((sum, item) => sum + item.quantity, 0)
        const outgoing = allocations
          .filter(item => item.month === month && item.base === row.base && item.code === row.code && item.demandBase !== row.base)
          .reduce((sum, item) => sum + item.quantity, 0)
        row.mainPlan = own + outgoing
        row.transferIn = incoming
        row.transferOut = outgoing
        row.transfer = incoming - outgoing
        row.scheduledTons = supplied.reduce((sum, item) => sum + item.tons, 0)
        row.unfulfilled = Math.max(0, (row.requiredProduction ?? 0) - own - incoming)
        if (row.unfulfilled <= Math.max(1, row.requiredProduction ?? 0) * 1e-8) row.unfulfilled = 0
        row.fulfillment = (row.requiredProduction ?? 0) > 0 ? Math.min(1, (own + incoming) / (row.requiredProduction ?? 1)) : 1
        const available = (row.openingInventory ?? 0) + own + incoming
        row.fulfilledDemand = Math.min(row.demand ?? 0, Math.max(0, available))
        row.closingInventory = available - row.fulfilledDemand
        row.projectedClosing = row.closingInventory
        row.gap = row.unfulfilled
      }
      if (row.planMissing.length) {
        const outgoing = allocations
          .filter(item => item.month === month && item.base === row.base && item.code === row.code && item.demandBase !== row.base)
          .reduce((sum, item) => sum + item.quantity, 0)
        if (outgoing > 0) {
          row.mainPlan = outgoing
          row.transferOut = outgoing
        }
      }
      for (const field of ['mainPlan', 'gap', 'transfer', 'openingInventory', 'requiredProduction', 'requiredProductionTons']) row.missing[field] = [...row.planMissing]
      previous.set(rowKey(row.base, row.code), row)
    }
  }
  const completeRows = rows.filter(row => !row.planMissing.length)
  return {
    context: reference.context,
    months: reference.months.slice(0, 3),
    rows,
    resourceSchedules,
    allocations,
    transfers,
    issues: [...new Set([...sourceIssues, ...rows.flatMap(row => row.planMissing)])],
    status: completeRows.length === rows.length && rows.length && !sourceIssues.length ? 'complete' : 'partial',
    summary: {
      totalRows: rows.length,
      evaluatedRows: completeRows.length,
      scheduledTons: allocations.reduce((sum, row) => sum + row.tons, 0),
      unfulfilledPieces: completeRows.reduce((sum, row) => sum + (row.unfulfilled ?? 0), 0)
    }
  }
}
