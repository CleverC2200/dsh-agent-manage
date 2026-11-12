import { computeMpsWorkflow, type MpsWorkflowInput, type MpsWorkflowRow } from './workflow.ts'
import { resolveMpsRules, ruleProductionDays, ruleStopsResource, ruleApplies } from './constraint-rules.ts'
import { jointAllocate } from './joint-allocation.ts'

export interface MpsPlanInput extends MpsWorkflowInput {
  planCandidates?: { base: string; code: string; resourceId: string; month?: string }[]
  transferRoutes?: { from: string; to: string; code: string; month?: string }[]
  odmSupplies?: { supplierId: string; base: string; code: string; month?: string }[]
  odmProductCodes?: string[]
  odmConflicts?: { code: string; reason: string }[]
  planSourceIssues?: string[]
}
export interface MpsPlannedRow extends Omit<MpsWorkflowRow, 'evaluation'> {
  evaluation: 'capacity-constrained'
  supplyMode: 'internal' | 'odm'
  odmArrival: number | null
  odmArrivalTons: number | null
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
type TransferRoute = NonNullable<MpsPlanInput['transferRoutes']>[number]
export function transferSupplyPaths(routes: TransferRoute[], month: string, code: string, destination: string) {
  const selected = routes.filter(route => route.code === code && route.from !== route.to && (!route.month || route.month === month))
  const paths = new Map<string, TransferRoute[]>([[destination, []]])
  const queue = [destination]
  for (let index = 0; index < queue.length; index++) {
    const to = queue[index]
    for (const route of selected.filter(route => route.to === to).sort((a, b) => a.from.localeCompare(b.from, 'en'))) {
      if (paths.has(route.from)) continue
      paths.set(route.from, [route, ...(paths.get(to) ?? [])])
      queue.push(route.from)
    }
  }
  paths.delete(destination)
  return paths
}
interface ResourceSchedule {
  month: string
  base: string
  resourceId: string
  name: string
  kind: NonNullable<MpsPlanInput['resources']>[number]['kind']
  days: number | null
  dailyTons: number
  capacity: number | null
  scheduledTons: number
  load: number | null
  missing: string[]
}

const plannedRow = (row: MpsWorkflowRow): MpsPlannedRow => ({
  ...row,
  missing: structuredClone(row.missing),
  evaluation: 'capacity-constrained',
  supplyMode: 'internal',
  odmArrival: null,
  odmArrivalTons: null,
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
})

export function solveMpsPlan(input: MpsPlanInput) {
  const reference = computeMpsWorkflow(input)
  const resolved = resolveMpsRules(input, reference.months.slice(0, 3))
  const resources = input.resources ?? []
  const uniqueResources = resources.filter(row => resources.filter(item => item.id === row.id).length === 1 && row.id && row.base && finite(row.dailyTons) && row.dailyTons >= 0)
  const sourceIssues = [
    ...(input.planSourceIssues ?? []),
    ...reference.adjustmentIssues,
    ...reference.excludedCategoryDemand.filter(row => reference.months.slice(0, 3).includes(row.month)).map(row => `${row.month} ${row.category} ${row.reason}`),
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
  if (resources.length !== uniqueResources.length) sourceIssues.push('部分资源编号重复、归属或能力无效，未纳入求解')
  const candidates =
    input.planCandidates ?? (input.resourceAssignments ?? []).filter(row => row.share > 0).map(({ base, code, resourceId, month }) => ({ base, code, resourceId, month }))
  const coefficientIndex = new Map<string, NonNullable<MpsPlanInput['unitWeights']>>()
  for (const row of input.unitWeights ?? []) {
    const key = rowKey(row.base, row.code)
    const values = coefficientIndex.get(key) ?? []
    values.push(row)
    coefficientIndex.set(key, values)
  }
  const routesByCode = Map.groupBy(input.transferRoutes ?? [], route => route.code)
  const unitWeight = (base: string, code: string) => {
    const values = coefficientIndex.get(rowKey(base, code)) ?? []
    return values.length === 1 && finite(values[0].tonsPerPiece) && values[0].tonsPerPiece > 0 ? values[0].tonsPerPiece : null
  }
  const odmCodes = new Set([...(input.odmProductCodes ?? []), ...(input.odmSupplies ?? []).map(row => row.code), ...(input.odmConflicts ?? []).map(row => row.code)])
  const rows = reference.rows.map(source => {
    const row = plannedRow(source)
    if (odmCodes.has(row.code)) {
      row.supplyMode = 'odm'
      row.mainPlan = 0
      row.scheduledTons = 0
    }
    return row
  })
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
    resourceUsage: { resourceId: string; share: number }[]
    path: TransferRoute[]
  }[] = []
  const odmArrivals: {
    month: string
    supplierId: string
    base: string
    demandBase: string
    code: string
    rowId: string
    quantity: number
    tons: number | null
    path: TransferRoute[]
  }[] = []
  const transfers: {
    month: string
    from: string
    to: string
    code: string
    quantity: number
    tons: number | null
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
        kind: resource.kind,
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
    const forming = (base: string, code: string) => {
      const machines = uniqueResources.filter(resource => resource.base === base && resource.kind === 'forming')
      const assigned = (input.resourceAssignments ?? []).filter(
        row => row.base === base && row.code === code && row.month === month && machines.some(machine => machine.id === row.resourceId)
      )
      const unknown = (input.resourceAssignments ?? []).some(
        row => row.base === base && row.code === code && row.month === month && !(input.resources ?? []).some(resource => resource.id === row.resourceId && resource.base === base)
      )
      const valid =
        !unknown &&
        assigned.length > 0 &&
        new Set(assigned.map(row => row.resourceId)).size === assigned.length &&
        assigned.every(row => finite(row.share) && row.share >= 0 && row.share <= 1 && capacityMap.has(row.resourceId)) &&
        Math.abs(assigned.reduce((sum, row) => sum + row.share, 0) - 1) <= 1e-12
      return valid ? assigned.filter(row => row.share > 0).map(row => ({ resourceId: row.resourceId, share: row.share })) : null
    }
    const optionsFor = (row: MpsPlannedRow, ids: string[]) =>
      ids.flatMap(id => {
        const resource = uniqueResources.find(item => item.id === id && item.kind === 'tunnel')
        const assigned = resource ? forming(resource.base, row.code) : null
        return assigned ? [{ resourceId: id, usage: [{ resourceId: id, share: 1 }, ...assigned] }] : []
      })
    const weights = new Map<string, number>()
    const eligible = new Map<string, string[]>()
    const remote = new Map<string, string[]>()
    const supplyPaths = new Map<string, Map<string, TransferRoute[]>>()
    for (const row of monthRows) {
      if (month !== input.context.month) row.openingInventory = previous.get(rowKey(row.base, row.code))?.closingInventory ?? null
      row.requiredProduction =
        finite(row.demand) && finite(row.targetInventory) && finite(row.openingInventory) ? Math.max(0, row.demand + row.targetInventory - row.openingInventory) : null
      const weight = unitWeight(row.base, row.code)
      if (weight !== null) weights.set(row.id, weight)
      row.demandTons = row.demand === 0 ? 0 : finite(row.demand) && weight !== null ? row.demand * weight : null
      row.requiredProductionTons = row.requiredProduction === 0 ? 0 : row.requiredProduction !== null && weight !== null ? row.requiredProduction * weight : null
      const own = [
        ...new Set(candidates.filter(item => item.base === row.base && item.code === row.code && (!item.month || item.month === month)).map(item => item.resourceId))
      ].filter(id => monthResources.some(resource => resource.resourceId === id && resource.base === row.base && resource.kind === 'tunnel') && capacityMap.has(id))
      const pendingAt = (base: string) =>
        reference.ruleEvaluations.filter(
          entry =>
            entry.month === month &&
            ['draft', 'pending', 'conflict'].includes(entry.status) &&
            resolved.rules.some(
              rule =>
                rule.id === entry.ruleId &&
                ruleApplies(rule, { ...row, base }) &&
                (rule.strength === '硬' || rule.accepted) &&
                ['cost-limit', 'lead-days'].includes(rule.effect.kind)
            )
        )
      const commonMissing = [
        ...(!finite(row.demand) ? ['缺有效需求'] : []),
        ...(!finite(row.openingInventory) ? ['缺前月实际结存'] : []),
        ...(!finite(row.targetInventory) ? ['缺目标库存'] : []),
        ...resolved.evaluations.filter(entry => entry.month === month && entry.status === 'draft').map(entry => entry.reason)
      ]
      if (row.supplyMode === 'odm') {
        const enforcedAt = (base: string, kind: 'self-only' | 'transfer-limit') =>
          resolved.rules.filter(rule => rule.effect.kind === kind && (rule.strength === '硬' || rule.accepted) && ruleApplies(rule, { ...row, base }))
        const routeRows = routesByCode.get(row.code) ?? []
        const safeRoutes = routeRows.filter(
          route => !pendingAt(route.from).length && !pendingAt(route.to).length && !enforcedAt(route.from, 'self-only').length && !enforcedAt(route.to, 'self-only').length
        )
        const paths = transferSupplyPaths(safeRoutes, month, row.code, row.base)
        const open = transferSupplyPaths(
          safeRoutes.filter(route => !enforcedAt(route.to, 'transfer-limit').some(rule => rule.effect.kind === 'transfer-limit' && rule.effect.value === 0)),
          month,
          row.code,
          row.base
        )
        for (const [base, path] of open) paths.set(base, path)
        const supplies = (input.odmSupplies ?? []).filter(item => item.code === row.code && (!item.month || item.month === month))
        const options = supplies
          .filter(item => item.base === row.base || paths.has(item.base))
          .map(item => ({ ...item, path: paths.get(item.base) ?? [] }))
          .filter(item => !pendingAt(item.base).length && !enforcedAt(item.base, 'self-only').length)
          .sort((a, b) => a.path.length - b.path.length || a.base.localeCompare(b.base, 'en'))
        const supply = options[0]
        const rawPaths = transferSupplyPaths(routeRows, month, row.code, row.base)
        const potential = supplies.filter(item => item.base === row.base || rawPaths.has(item.base))
        const constraints = potential.flatMap(item =>
          [...new Set([row.base, item.base, ...(rawPaths.get(item.base) ?? []).flatMap(route => [route.from, route.to])])].flatMap(base => [
            ...pendingAt(base).map(entry => entry.reason),
            ...enforcedAt(base, 'self-only').map(rule => `ODM外部供应不满足约束「${rule.description}」`)
          ])
        )
        const path = supply?.path ?? []
        const pathWeight =
          weight !== null && [supply?.base, ...path.flatMap(route => [route.from, route.to])].every(base => base && unitWeight(base, row.code) === weight) ? weight : null
        const needsTons = path.some(route => enforcedAt(route.to, 'transfer-limit').length)
        row.planMissing = [
          ...commonMissing,
          ...(input.odmConflicts ?? []).filter(item => item.code === row.code).map(item => `ODM来源冲突：${item.reason}`),
          ...(row.requiredProduction !== 0 && !supply ? (constraints.length ? [...new Set(constraints)] : ['无有效ODM收货或调拨路径']) : []),
          ...(new Set(options.map(item => item.supplierId)).size > 1 ? ['ODM供方不唯一，需确认供应分配'] : []),
          ...(row.requiredProduction !== 0 && needsTons && pathWeight === null ? ['缺唯一有效件吨系数'] : []),
          ...(row.requiredProduction !== null && (!finite(row.requiredProduction) || (pathWeight !== null && !finite(row.requiredProduction * pathWeight)))
            ? ['ODM净缺口或折吨超出有效范围']
            : []),
          ...pendingAt(row.base).map(entry => entry.reason),
          ...enforcedAt(row.base, 'self-only').map(rule => `ODM外部供应不满足约束「${rule.description}」`)
        ]
        if (!row.planMissing.length && supply && (row.requiredProduction ?? 0) > 0)
          odmArrivals.push({
            month,
            supplierId: supply.supplierId,
            base: supply.base,
            demandBase: row.base,
            code: row.code,
            rowId: row.id,
            quantity: row.requiredProduction ?? 0,
            tons: pathWeight === null ? null : (row.requiredProduction ?? 0) * pathWeight,
            path
          })
        continue
      }
      const matchingRoutes = (routesByCode.get(row.code) ?? []).filter(
        route => weight !== null && unitWeight(route.from, row.code) === weight && unitWeight(route.to, row.code) === weight
      )
      const allowedRoutes = matchingRoutes.filter(route => !pendingAt(route.from).length && !pendingAt(route.to).length)
      const paths = transferSupplyPaths(allowedRoutes, month, row.code, row.base)
      const openPaths = transferSupplyPaths(
        allowedRoutes.filter(
          route =>
            !resolved.rules.some(
              rule => rule.effect.kind === 'transfer-limit' && rule.effect.value === 0 && (rule.strength === '硬' || rule.accepted) && ruleApplies(rule, { ...row, base: route.to })
            )
        ),
        month,
        row.code,
        row.base
      )
      for (const [base, path] of openPaths) paths.set(base, path)
      supplyPaths.set(row.id, paths)
      const other = [
        ...new Set(candidates.filter(item => item.code === row.code && (!item.month || item.month === month) && paths.has(item.base)).map(item => item.resourceId))
      ].filter(id => capacityMap.has(id) && monthResources.some(resource => resource.resourceId === id && resource.kind === 'tunnel'))
      const ownReady = optionsFor(row, own).map(option => option.resourceId)
      const otherReady = optionsFor(row, other).map(option => option.resourceId)
      eligible.set(row.id, ownReady)
      row.candidateResources = own
      remote.set(row.id, otherReady)
      const routePending =
        !own.length && !other.length && reference.ruleEvaluations.length
          ? [
              ...new Set(
                [...transferSupplyPaths(matchingRoutes, month, row.code, row.base)]
                  .filter(([base]) =>
                    candidates.some(item => item.base === base && item.code === row.code && (!item.month || item.month === month) && capacityMap.has(item.resourceId))
                  )
                  .flatMap(([, path]) => path.flatMap(route => [...pendingAt(route.from), ...pendingAt(route.to)]).map(entry => `沿线约束：${entry.reason}`))
              )
            ]
          : []
      row.planMissing = [
        ...commonMissing,
        ...(row.requiredProduction !== 0 && weight === null ? ['缺唯一有效件吨系数'] : []),
        ...(row.requiredProductionTons !== null && !finite(row.requiredProductionTons) ? ['生产吨数超出有效范围'] : []),
        ...(row.requiredProduction !== 0 && !own.length && !other.length && !routePending.length ? ['无有效产线承接关系或生产日历'] : []),
        ...(row.requiredProduction !== 0 && (own.length || other.length) && !ownReady.length && !otherReady.length ? ['缺有效成型机台账、月度批准分配或生产日历'] : []),
        ...pendingAt(row.base).map(entry => entry.reason),
        ...routePending
      ]
    }
    const demandRows = monthRows.filter(row => row.supplyMode === 'internal' && !row.planMissing.length && row.requiredProduction !== null)
    const demands = demandRows
      .filter(row => (row.requiredProductionTons ?? 0) > 0)
      .map(row => ({
        id: row.id,
        quantity: row.requiredProductionTons ?? 0,
        options: optionsFor(row, eligible.get(row.id) ?? [])
      }))
    const local = jointAllocate(
      demands,
      [...capacityMap].map(([id, quantity]) => ({ id, quantity }))
    )
    const remainingCapacity = new Map(
      [...capacityMap].map(([id, capacity]) => [
        id,
        Math.max(
          0,
          capacity - local.allocations.reduce((sum, row) => sum + row.quantity * row.usage.filter(item => item.resourceId === id).reduce((total, item) => total + item.share, 0), 0)
        )
      ])
    )
    const localOutput = new Map(local.demands.map(row => [row.id, row.allocated]))
    const imports = demandRows
      .filter(row => (remote.get(row.id) ?? []).length && (row.requiredProductionTons ?? 0) > (localOutput.get(row.id) ?? 0))
      .map(row => ({
        id: row.id,
        quantity: Math.max(0, (row.requiredProductionTons ?? 0) - (localOutput.get(row.id) ?? 0)),
        options: optionsFor(row, remote.get(row.id) ?? [])
      }))
    const supplemental = jointAllocate(
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
        resourceUsage: allocation.usage,
        tons: allocation.quantity,
        quantity: allocation.quantity / weight,
        path: resource.base === row.base ? [] : (supplyPaths.get(row.id)?.get(resource.base) ?? [])
      })
    }
    for (const rule of resolved.rules) {
      if (rule.effect.kind !== 'transfer-limit' || (rule.strength !== '硬' && !rule.accepted)) continue
      const applicable = [...allocations, ...odmArrivals]
        .filter(item => item.month === month)
        .map(item => ({
          item,
          legs: item.path.filter(route => monthRows.some(row => row.id === item.rowId && ruleApplies(rule, { ...row, base: route.to }))).length
        }))
        .filter(row => row.legs > 0)
      const total = applicable.reduce((sum, row) => sum + (row.item.tons ?? 0) * row.legs, 0)
      if (total > rule.effect.value)
        applicable.forEach(({ item: row }) => {
          const ratio = rule.effect.kind === 'transfer-limit' ? rule.effect.value / total : 0
          if (row.tons !== null) row.tons *= ratio * (1 - 1e-12)
          row.quantity *= ratio * (1 - 1e-12)
        })
    }
    for (const resource of monthResources) {
      const assigned = allocations.filter(row => row.month === month && row.resourceUsage.some(item => item.resourceId === resource.resourceId))
      const usedTons = (row: (typeof allocations)[number]) =>
        row.tons * row.resourceUsage.filter(item => item.resourceId === resource.resourceId).reduce((sum, item) => sum + item.share, 0)
      const total = assigned.reduce((sum, row) => sum + usedTons(row), 0)
      if (resource.capacity !== null && total > resource.capacity)
        assigned.forEach(row => {
          const ratio = ((resource.capacity ?? 0) / total) * (1 - 1e-12)
          row.tons *= ratio
          row.quantity *= ratio
        })
    }
    for (const resource of monthResources) {
      resource.scheduledTons = allocations
        .filter(row => row.month === month)
        .reduce((sum, row) => sum + row.tons * row.resourceUsage.filter(item => item.resourceId === resource.resourceId).reduce((total, item) => total + item.share, 0), 0)
      resource.load = resource.capacity !== null && resource.capacity > 0 ? resource.scheduledTons / resource.capacity : null
      if (resource.capacity !== null && resource.scheduledTons > resource.capacity) throw Error('产能约束校验失败，拒绝生成结果')
    }
    transfers.push(
      ...[...allocations, ...odmArrivals]
        .filter(row => row.month === month && row.base !== row.demandBase)
        .flatMap(row => row.path.map(route => ({ month, from: route.from, to: route.to, code: row.code, quantity: row.quantity, tons: row.tons })))
    )
    for (const row of monthRows) {
      const receipts = odmArrivals.filter(item => item.month === month && item.base === row.base && item.code === row.code)
      const arrival = receipts.reduce((sum, item) => sum + item.quantity, 0)
      const production = allocations.filter(item => item.month === month && item.base === row.base && item.code === row.code).reduce((sum, item) => sum + item.quantity, 0)
      const incoming = transfers.filter(item => item.month === month && item.to === row.base && item.code === row.code).reduce((sum, item) => sum + item.quantity, 0)
      const outgoing = transfers.filter(item => item.month === month && item.from === row.base && item.code === row.code).reduce((sum, item) => sum + item.quantity, 0)
      if (!row.planMissing.length) {
        const supplied = [...allocations, ...odmArrivals].filter(item => item.rowId === row.id)
        const own = supplied.filter(item => item.base === row.base).reduce((sum, item) => sum + item.quantity, 0)
        const suppliedImports = supplied.filter(item => item.base !== row.base).reduce((sum, item) => sum + item.quantity, 0)
        row.mainPlan = production
        row.odmArrival = arrival
        row.odmArrivalTons = receipts.some(item => item.tons === null) ? null : receipts.reduce((sum, item) => sum + (item.tons ?? 0), 0)
        row.transferIn = incoming
        row.transferOut = outgoing
        row.transfer = incoming - outgoing
        row.scheduledTons = allocations.filter(item => item.rowId === row.id).reduce((sum, item) => sum + item.tons, 0)
        row.unfulfilled = Math.max(0, (row.requiredProduction ?? 0) - own - suppliedImports)
        const tolerance = Math.max(1, row.requiredProduction ?? 0) * 1e-8
        if (row.unfulfilled <= tolerance) row.unfulfilled = 0
        row.fulfillment = (row.requiredProduction ?? 0) > 0 ? Math.min(1, (own + suppliedImports) / (row.requiredProduction ?? 1)) : 1
        const available = (row.openingInventory ?? 0) + production + arrival + incoming - outgoing
        row.fulfilledDemand = Math.min(row.demand ?? 0, Math.max(0, available))
        row.closingInventory = available - row.fulfilledDemand
        if (row.unfulfilled === 0 && (row.requiredProduction ?? 0) > 0 && row.targetInventory !== null && Math.abs(row.closingInventory - row.targetInventory) <= tolerance)
          row.closingInventory = row.targetInventory
        row.projectedClosing = row.closingInventory
        row.gap = row.unfulfilled
      }
      if (row.planMissing.length) {
        if (production > 0 || arrival > 0 || incoming > 0 || outgoing > 0) {
          row.odmArrival = arrival
          row.odmArrivalTons = receipts.some(item => item.tons === null) ? null : receipts.reduce((sum, item) => sum + (item.tons ?? 0), 0)
          row.mainPlan = production
          row.transferIn = incoming
          row.transferOut = outgoing
          row.transfer = incoming - outgoing
        }
      }
      for (const field of ['mainPlan', 'odmArrival', 'gap', 'transfer', 'openingInventory', 'requiredProduction', 'requiredProductionTons'])
        row.missing[field] = [...row.planMissing]
      previous.set(rowKey(row.base, row.code), row)
    }
  }
  const rowKeys = new Set(rows.map(row => JSON.stringify([row.month, row.base, row.code])))
  const missingProduction = [...allocations, ...odmArrivals]
    .flatMap(row => [...new Set([row.base, ...row.path.map(route => route.to)])].map(base => ({ ...row, base })))
    .filter(row => !rowKeys.has(JSON.stringify([row.month, row.base, row.code])))
  if (missingProduction.length) {
    const products = new Map<string, MpsWorkflowInput['products'][number]>()
    const referenceRows = new Map(reference.rows.map(row => [row.id, row]))
    for (const allocation of missingProduction) {
      const row = referenceRows.get(allocation.rowId)
      if (row)
        products.set(rowKey(allocation.base, row.code), { base: allocation.base, code: row.code, name: row.name, category: row.category, series: row.series, group: row.group })
    }
    const productionKeys = new Set(missingProduction.map(row => JSON.stringify([row.month, row.base, row.code])))
    const supplyReference = computeMpsWorkflow({
      ...input,
      products: [...products.values()],
      productMonths: undefined,
      categoryDemand: [],
      report: [],
      history: [],
      reportRatios: [],
      adjustments: undefined
    })
    for (const source of supplyReference.rows.filter(row => productionKeys.has(JSON.stringify([row.month, row.base, row.code])))) {
      const row = plannedRow(source)
      row.supplyMode = odmCodes.has(row.code) ? 'odm' : 'internal'
      if (row.supplyMode === 'odm') row.scheduledTons = 0
      const receipts = odmArrivals.filter(item => item.month === row.month && item.base === row.base && item.code === row.code)
      row.odmArrival = receipts.reduce((sum, item) => sum + item.quantity, 0)
      row.odmArrivalTons = receipts.some(item => item.tons === null) ? null : receipts.reduce((sum, item) => sum + (item.tons ?? 0), 0)
      const production = allocations.filter(item => item.month === row.month && item.base === row.base && item.code === row.code)
      row.mainPlan = production.reduce((sum, item) => sum + item.quantity, 0)
      row.transferIn = transfers.filter(item => item.month === row.month && item.to === row.base && item.code === row.code).reduce((sum, item) => sum + item.quantity, 0)
      row.transferOut = transfers.filter(item => item.month === row.month && item.from === row.base && item.code === row.code).reduce((sum, item) => sum + item.quantity, 0)
      row.transfer = row.transferIn - row.transferOut
      row.planMissing = ['供给或中转基地未纳入本地需求范围，仅记录已知生产、ODM默认计划到货及调拨量']
      row.missing.mainPlan = [...row.planMissing]
      row.missing.transfer = [...row.planMissing]
      rows.push(row)
    }
  }
  const odmSchedules = [...Map.groupBy(odmArrivals, row => JSON.stringify([row.month, row.supplierId, row.code])).values()].map(group => ({
    month: group[0].month,
    supplierId: group[0].supplierId,
    code: group[0].code,
    basis: 'default-estimated' as const,
    quantity: group.reduce((sum, row) => sum + row.quantity, 0),
    tons: group.some(row => row.tons === null) ? null : group.reduce((sum, row) => sum + (row.tons ?? 0), 0),
    receiptBases: [...new Set(group.map(row => row.base))]
  }))
  const completeRows = rows.filter(row => !row.planMissing.length)
  return {
    context: reference.context,
    months: reference.months.slice(0, 3),
    rows,
    resourceSchedules,
    allocations,
    odmArrivals,
    odmSchedules,
    transfers,
    issues: [...new Set([...sourceIssues, ...rows.flatMap(row => row.planMissing)])],
    status: completeRows.length === rows.length && rows.length && !sourceIssues.length ? 'complete' : 'partial',
    summary: {
      totalRows: rows.length,
      evaluatedRows: completeRows.length,
      scheduledTons: allocations.reduce((sum, row) => sum + row.tons, 0),
      odmArrivalPieces: odmArrivals.reduce((sum, row) => sum + row.quantity, 0),
      unfulfilledPieces: completeRows.reduce((sum, row) => sum + (row.unfulfilled ?? 0), 0)
    }
  }
}
