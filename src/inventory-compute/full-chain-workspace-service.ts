import { categoryStructureRows } from './full-chain-category-structure.js'
import { createHash } from 'node:crypto'

import type {
  AgingBatchRow,
  AgingLayerValues,
  BuildWorkspaceRequest,
  FullChainData,
  FullChainWorkspace,
  InventoryLayer,
  MetricValue,
  StructureRow,
  TrustedAccessContext,
  WorkspaceRisk,
  WorkspaceDetailNode,
  WorkspaceFilters
} from './full-chain-types.js'

const RULE_VERSION = 'full-chain-rules/2026-09-17-r7' as const
const COMPANY_SOURCE_TABLES = [
  'agents_scm_safety_stock',
  'agents_scm_inventory_age',
  'agents_scm_order_fulfillment',
  'agents_scm_branch_inventory_snapshot',
  'agents_scm_branch_plan',
  'agents_scm_branch_operation_fact',
  'agents_scm_branch_pending_order'
]
const CUSTOMER_SOURCE_TABLES = ['agents_scm_cust_inventory_daily', 'agents_scm_cust_plan_order_analysis', 'agents_scm_cust_stock_age', 'agents_scm_wl_cust_stock_age']

const round = (value: number, digits = 2) => Number(value.toFixed(digits))
const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0)
const completeSum = (values: Array<number | null | undefined>) => (values.length > 0 && values.every(value => value != null) ? sum(values) : null)
const latest = (dates: Array<string | null | undefined>) => dates.reduce<string | null>((result, date) => (date && (result == null || date > result) ? date : result), null)

// Preserve insertion order and row identity without requiring Node 22's Map.groupBy.
function groupBy<T, K>(rows: Iterable<T>, keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const key = keyOf(row)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

function allowed(value: string, allowlist?: string[]) {
  return allowlist === undefined || allowlist.includes(value)
}

function applyTrustedScope(data: FullChainData, request: BuildWorkspaceRequest): FullChainData {
  const { access, filters } = request
  const selectedLayer = filters.customerId ? 'customer' : filters.branch ? 'branch' : filters.base ? 'base' : null
  const layerVisible = (layer: InventoryLayer) => (!selectedLayer || layer === selectedLayer) && (request.scope === 'all-channel' || layer !== 'customer')
  const orderInScope = (row: FullChainData['orders'][number]) =>
    (!selectedLayer || (selectedLayer === 'base' && row.pickupType === 'factory') || (selectedLayer === 'branch' && row.pickupType === 'branch')) &&
    (!row.objectName ||
      (row.pickupType === 'factory'
        ? allowed(row.objectName, access.allowedBases) && (!filters.base || row.objectName === filters.base)
        : allowed(row.objectName, access.allowedBranches) && (!filters.branch || row.objectName === filters.branch))) &&
    (!filters.category || !row.category || row.category === filters.category) &&
    (!filters.sku || !row.sku || row.sku === filters.sku)
  const orderVisible = (row: FullChainData['orders'][number]) => (!filters.month || row.month === filters.month) && orderInScope(row)
  const baseInventory = data.baseInventory.filter(
    row =>
      layerVisible('base') &&
      allowed(row.base, access.allowedBases) &&
      (!filters.base || row.base === filters.base) &&
      (!filters.category || row.category === filters.category) &&
      (!filters.sku || row.sku === filters.sku)
  )
  const branchInventory = data.branchInventory.filter(
    row =>
      layerVisible('branch') &&
      allowed(row.branch, access.allowedBranches) &&
      (!row.base || allowed(row.base, access.allowedBases)) &&
      (!filters.branch || row.branch === filters.branch) &&
      (!filters.category || row.category === filters.category) &&
      (!filters.sku || row.sku === filters.sku)
  )
  const customerInventory =
    request.scope === 'all-channel'
      ? data.customerInventory.filter(
          row =>
            layerVisible('customer') &&
            allowed(row.customerId, access.allowedCustomerIds) &&
            (!filters.customerId || row.customerId === filters.customerId) &&
            (!row.branch || allowed(row.branch, access.allowedBranches)) &&
            (!filters.category || row.category === filters.category) &&
            (!filters.sku || row.sku === filters.sku)
        )
      : []
  const customerPlanInventory =
    request.scope === 'all-channel' && !filters.category
      ? (data.customerPlanInventory ?? []).filter(
          row =>
            layerVisible('customer') &&
            allowed(row.customerId, access.allowedCustomerIds) &&
            (!filters.customerId || row.customerId === filters.customerId) &&
            !filters.base &&
            !filters.branch
        )
      : []
  const visibleObjects = new Set([...baseInventory.map(row => row.base), ...branchInventory.map(row => row.branch), ...customerInventory.map(row => row.customer)])
  return {
    ...data,
    baseInventory,
    branchInventory,
    baseCurrentOrders: data.baseCurrentOrders?.filter(row => layerVisible('base') && allowed(row.base, access.allowedBases) && (!filters.base || row.base === filters.base)),
    branchOutbound: data.branchOutbound?.filter(
      row =>
        layerVisible('branch') &&
        allowed(row.branch, access.allowedBranches) &&
        (!filters.branch || row.branch === filters.branch) &&
        (!filters.sku || row.sku === filters.sku) &&
        (!filters.category || row.category === filters.category)
    ),
    branchFulfillment: data.branchFulfillment?.filter(
      row => layerVisible('branch') && allowed(row.branch, access.allowedBranches) && (!filters.branch || row.branch === filters.branch) && !filters.sku && !filters.category
    ),
    customerInventory,
    customerPlanInventory,
    customerQuantityGaps: (data.customerQuantityGaps ?? []).filter(
      row =>
        layerVisible('customer') &&
        allowed(row.customerId, access.allowedCustomerIds) &&
        (!filters.customerId || row.customerId === filters.customerId) &&
        (!filters.sku || row.sku === filters.sku) &&
        (!filters.category || row.category === filters.category)
    ),
    agingBatches: data.agingBatches.filter(row => {
      if (!layerVisible(row.layer)) return false
      if (row.layer === 'base' && filters.base && row.objectName !== filters.base) return false
      if (row.layer === 'branch' && filters.branch && row.objectName !== filters.branch) return false
      const objectAllowed =
        row.layer === 'base'
          ? allowed(row.objectName, access.allowedBases)
          : row.layer === 'branch'
            ? allowed(row.objectName, access.allowedBranches)
            : row.objectId
              ? allowed(row.objectId, access.allowedCustomerIds)
              : visibleObjects.has(row.objectName)
      return (
        objectAllowed &&
        (!filters.customerId || row.layer !== 'customer' || row.objectId === filters.customerId) &&
        (!filters.category || row.category === filters.category) &&
        (!filters.sku || row.sku === filters.sku)
      )
    }),
    pendingOrders: data.pendingOrders.filter(
      row =>
        layerVisible('branch') && allowed(row.branch, access.allowedBranches) && (!filters.branch || row.branch === filters.branch) && (!filters.sku || row.sku === filters.sku)
    ),
    orders: data.orders.filter(orderVisible),
    orders7d: data.orders7d?.filter(orderInScope),
    orderHistory: data.orderHistory?.filter(orderVisible),
    agingHistory: data.agingHistory?.filter(row => layerVisible(row.layer)),
    inventoryTrend: data.inventoryTrend.filter(row => layerVisible(row.layer)),
    activeCustomerIds30d: request.scope === 'all-channel' ? [...new Set(data.activeCustomerIds30d)].filter(id => allowed(id, access.allowedCustomerIds)) : []
  }
}

function ratioDays(stock: number | null, demand30d: number | null) {
  return stock != null && demand30d != null && demand30d > 0 ? round(stock / (demand30d / 30)) : null
}

function companyAgingSample(batches: AgingBatchRow[]) {
  return batches.filter(row => row.layer !== 'branch' || row.qty >= 0)
}

function fulfillmentRate(rows: FullChainData['orders']) {
  if (rows.some(row => row.pickupType === 'factory') && rows.some(row => row.pickupType === 'branch')) return null
  if (rows.length && rows.every(row => row.pickupType === 'factory')) {
    const demand = completeSum(rows.map(row => row.demandQty))
    const shortage = completeSum(rows.map(row => row.shortageQty))
    return demand != null && shortage != null && demand > 0 ? round((1 - shortage / demand) * 100) : null
  }
  const ordered = completeSum(rows.map(row => row.orderQty))
  const shipped = completeSum(rows.map(row => row.shippedQty))
  return ordered != null && shipped != null && ordered > 0 && shipped >= 0 && shipped <= ordered ? round((shipped / ordered) * 100) : null
}

function branchTurnover(data: FullChainData, branch?: string, category?: string, sku?: string) {
  const stock = data.branchInventory.filter(row => (!branch || row.branch === branch) && (!category || row.category === category) && (!sku || row.sku === sku))
  const outbound = data.branchOutbound?.filter(row => (!branch || row.branch === branch) && (!category || row.category === category) && (!sku || row.sku === sku))
  return ratioDays(completeSum(stock.map(row => row.availableQty)), completeSum(outbound?.map(row => row.qty) ?? []))
}

function branchFulfillmentRate(data: FullChainData) {
  const ordered = completeSum(data.branchFulfillment?.map(row => row.orderQty) ?? [])
  const shipped = completeSum(data.branchFulfillment?.map(row => row.shippedQty) ?? [])
  return ordered != null && shipped != null && ordered > 0 ? round((shipped / ordered) * 100) : null
}

function ageQuantity(batches: AgingBatchRow[], layer: InventoryLayer, kind: 'attention' | 'high' | 'risk', days = 0): number | null {
  if (kind === 'attention' && layer === 'base') return null
  if (kind === 'high' && layer !== 'customer') return null
  const layerBatches = companyAgingSample(batches).filter(row => row.layer === layer)
  if (!layerBatches.length) return null
  if (layer === 'base' && days === 0) {
    if (layerBatches.some(row => row.qty !== 0 && row.ageDays == null)) return null
    return round(sum(layerBatches.filter(row => row.ageDays != null && row.ageDays > 60).map(row => row.qty)))
  }
  if (layerBatches.some(row => row.qty < 0 || (days > 0 && row.dailyVelocity != null && row.dailyVelocity < 0))) return null
  if (layerBatches.some(row => row.qty > 0 && row.ageDays == null)) return null
  if (days > 0 && layerBatches.some(row => row.qty > 0 && row.dailyVelocity == null)) return null
  const byObjectSku = groupBy(
    layerBatches.filter(row => row.qty > 0),
    row => `${row.objectId ?? row.objectName}\u0000${row.sku}`
  )
  let result = 0
  for (const group of byObjectSku.values()) {
    if (days > 0 && new Set(group.map(row => row.dailyVelocity)).size !== 1) return null
    let remainingConsumption = days * (group[0]?.dailyVelocity ?? 0)
    const oldestFirst = [...group].sort((a, b) => b.ageDays! - a.ageDays!)
    for (const batch of oldestFirst) {
      const consumed = Math.min(batch.qty, Math.max(0, remainingConsumption))
      remainingConsumption -= consumed
      const remaining = batch.qty - consumed
      const projectedAge = batch.ageDays! + days
      const inBand =
        kind === 'attention'
          ? projectedAge >= 60 && projectedAge < 90
          : kind === 'high'
            ? projectedAge >= 90 && projectedAge < 120
            : layer === 'base'
              ? projectedAge > 60
              : layer === 'branch'
                ? projectedAge >= 90
                : projectedAge >= 120
      if (inBand) result += remaining
    }
  }
  return round(result)
}

function layerValues(batches: AgingBatchRow[], kind: 'attention' | 'high' | 'risk', days = 0): AgingLayerValues {
  return {
    base: ageQuantity(batches, 'base', kind, days),
    branch: ageQuantity(batches, 'branch', kind, days),
    customer: ageQuantity(batches, 'customer', kind, days)
  }
}

function projectionState(values: AgingLayerValues, includeCustomer: boolean) {
  const required = includeCustomer ? [values.base, values.branch, values.customer] : [values.base, values.branch]
  const count = required.filter(value => value != null).length
  return count === 0 ? ('unavailable' as const) : count === required.length ? ('available' as const) : ('partial' as const)
}

function sourceDate(data: FullChainData, domain: 'inventory' | 'aging' | 'orders' | 'customer' | 'pending') {
  if (domain === 'inventory') return latest([...data.baseInventory, ...data.branchInventory].map(row => row.snapshotDate))
  if (domain === 'aging') return latest(data.agingBatches.map(row => row.snapshotDate))
  if (domain === 'orders') return latest(data.orders.map(row => row.snapshotDate))
  if (domain === 'customer') return latest(data.customerInventory.map(row => row.snapshotDate))
  return latest(data.pendingOrders.map(row => row.snapshotDate))
}

function metric(current: number | null, target: number | null, unit: MetricValue['unit'], explanation: string, date: string | null, risk = false): MetricValue {
  return { current, target, unit, explanation, sourceDate: date, state: current == null ? 'unavailable' : risk ? 'risk' : 'ok' }
}

function structureRows(data: FullChainData, includeCustomer: boolean): StructureRow[] {
  const forecastFields = (row: { sourceTargetTurnoverDays?: number | null; plannedDailyQty?: number | null; forecastInventoryQty?: number | null; targetQty: number | null }) => ({
    plannedDailyQty: row.plannedDailyQty ?? null,
    forecastInventoryQty: row.forecastInventoryQty ?? null,
    targetTurnoverDays:
      row.targetQty != null && row.plannedDailyQty != null && row.plannedDailyQty > 0 ? round(row.targetQty / row.plannedDailyQty) : (row.sourceTargetTurnoverDays ?? null),
    projectedTurnoverDays:
      row.forecastInventoryQty != null && row.forecastInventoryQty >= 0 && row.plannedDailyQty != null && row.plannedDailyQty > 0
        ? round(row.forecastInventoryQty / row.plannedDailyQty)
        : null
  })
  const agingGroups = groupBy(data.agingBatches, row => `${row.layer}\u0000${row.objectId ?? row.objectName}\u0000${row.sku}`)
  const ageFields = (layer: InventoryLayer, objectName: string, sku: string, objectId?: string) => {
    const key = `${layer}\u0000${objectId ?? objectName}\u0000${sku}`
    const batches = companyAgingSample(agingGroups.get(key) ?? [])
    if (batches.some(row => (row.layer !== 'base' && row.qty < 0) || (row.qty !== 0 && row.ageDays == null))) {
      const unavailable = { averageAgeDays: null, bigDateQty: null }
      return unavailable
    }
    const qty = sum(batches.map(row => row.qty))
    const averageAgeDays = qty > 0 ? round(sum(batches.map(row => row.qty * row.ageDays!)) / qty, 1) : null
    const bigDateQty = batches.length ? round(sum(batches.filter(row => (layer === 'base' ? row.ageDays! > 60 : row.ageDays! >= 60)).map(row => row.qty))) : null
    const value = { averageAgeDays, bigDateQty }
    return value
  }
  const decision = (layer: InventoryLayer, differenceQty: number | null, bigDateQty: number | null) => {
    const owner = layer === 'base' ? '基地计划' : layer === 'branch' ? '分仓运营' : '经销商运营'
    if ((bigDateQty ?? 0) > 0) return { judgment: '存在大日期库存', suggestedAction: layer === 'customer' ? '复核客户动销与库存来源' : '优先匹配近期需求并复核 FIFO', owner }
    if (differenceQty == null) return { judgment: '目标不可用', suggestedAction: '补齐有效目标后再判断偏差', owner }
    if (differenceQty < 0) return { judgment: '库存低于目标', suggestedAction: '核对近期需求并评估补货', owner }
    return { judgment: '当前未命中规则风险', suggestedAction: '持续观察真实快照', owner }
  }
  const baseRows: StructureRow[] = data.baseInventory.map(row => {
    const age = ageFields('base', row.base, row.sku)
    return {
      ...forecastFields(row),
      key: `base:${row.base}:${row.sku}`,
      layer: 'base',
      objectName: row.base,
      parentName: null,
      category: row.category,
      sku: row.sku,
      currentQty: row.currentQty,
      availableQty: row.currentQty,
      targetQty: row.targetQty,
      differenceQty: row.targetQty != null ? round(row.currentQty - row.targetQty) : null,
      turnoverDays: ratioDays(row.currentQty, row.plannedDailyQty == null ? null : row.plannedDailyQty * 30),
      turnoverDemand30d: row.plannedDailyQty == null ? null : row.plannedDailyQty * 30,
      ...age,
      ...decision('base', row.targetQty != null ? round(row.currentQty - row.targetQty) : null, age.bigDateQty),
      sourceDate: row.snapshotDate,
      confidence: row.targetQty == null ? '目标缺失' : '基地安全库存口径'
    }
  })
  const branchRows: StructureRow[] = data.branchInventory.map(row => {
    const age = ageFields('branch', row.branch, row.sku)
    return {
      ...forecastFields(row),
      key: `branch:${row.branch}:${row.sku}`,
      layer: 'branch',
      objectName: row.branch,
      parentName: row.base,
      category: row.category,
      sku: row.sku,
      currentQty: row.currentQty,
      availableQty: row.availableQty ?? null,
      targetQty: row.targetQty,
      differenceQty: row.targetQty != null ? round(row.currentQty - row.targetQty) : null,
      turnoverDays: ratioDays(row.availableQty ?? null, row.externalDemand30d),
      turnoverDemand30d: row.externalDemand30d,
      ...age,
      ...decision('branch', row.targetQty != null ? round(row.currentQty - row.targetQty) : null, age.bigDateQty),
      sourceDate: row.snapshotDate,
      confidence: row.targetQty == null ? '目标缺失' : '分仓计划口径'
    }
  })
  const customerRows: StructureRow[] = includeCustomer
    ? data.customerInventory.map(row => {
        const age = ageFields('customer', row.customer, row.sku, row.customerId)
        return {
          key: `customer:${row.customerId}:${row.sku}`,
          layer: 'customer',
          objectName: row.customer,
          objectId: row.customerId,
          parentName: row.branch,
          category: row.category,
          sku: row.sku,
          currentQty: row.currentQty,
          availableQty: row.currentQty,
          targetQty: row.targetQty,
          differenceQty: row.targetQty && row.targetQty > 0 ? round(row.currentQty - row.targetQty) : null,
          turnoverDays: ratioDays(row.currentQty, row.sales30d),
          turnoverDemand30d: row.sales30d,
          ...age,
          ...decision('customer', row.targetQty && row.targetQty > 0 ? round(row.currentQty - row.targetQty) : null, age.bigDateQty),
          sourceDate: row.snapshotDate,
          confidence: row.sourceConflict ? 'JXC 主源；辅助源冲突' : 'JXC 主源'
        }
      })
    : []
  return [...baseRows, ...branchRows, ...customerRows]
}

function compactStructureRows(rows: StructureRow[], filters: BuildWorkspaceRequest['filters'], batches: AgingBatchRow[]): StructureRow[] {
  const objectSelected = Boolean(filters.base || filters.branch || filters.customerId)
  if (filters.sku || (filters.category && objectSelected)) return rows
  const groups = groupBy(rows, row => `${row.layer}\u0000${row.objectId ?? ''}\u0000${row.objectName}${objectSelected ? `\u0000${row.category}` : ''}`)
  const batchKey = (row: { layer: string; objectId?: string; objectName: string; category: string }) =>
    JSON.stringify([row.layer, row.objectId ?? row.objectName, ...(objectSelected ? [row.category] : [])])
  const batchesByObject = groupBy(batches, batch => batchKey(batch))
  return [...groups.entries()].map(([key, group]) => {
    const currentQty = sum(group.map(row => row.currentQty))
    const targets = group.map(row => row.targetQty)
    const targetQty = group[0]!.layer === 'base' && targets.some(value => value != null) ? sum(targets) : completeSum(targets)
    const avgAgeDenominator = sum(group.filter(row => row.averageAgeDays != null).map(row => row.currentQty))
    const turnoverDemand30d =
      group[0]!.layer === 'base' && group.some(row => row.turnoverDemand30d != null)
        ? sum(group.map(row => row.turnoverDemand30d))
        : completeSum(group.map(row => row.turnoverDemand30d))
    const plannedDailyQty = completeSum(group.map(row => row.plannedDailyQty))
    const forecastInventoryQty = group.some(row => row.forecastInventoryQty != null && row.forecastInventoryQty < 0)
      ? null
      : completeSum(group.map(row => row.forecastInventoryQty))
    const matchingBatches = companyAgingSample(batchesByObject.get(batchKey(group[0]!)) ?? [])
    const batchBigDate =
      matchingBatches.length && matchingBatches.every(batch => batch.qty === 0 || batch.ageDays != null)
        ? sum(matchingBatches.filter(batch => (batch.layer === 'base' ? batch.ageDays! > 60 : batch.ageDays! >= 60)).map(batch => batch.qty))
        : null
    const hasAgeRisk = group.some(row => row.judgment === '存在大日期库存')
    return {
      key: `summary:${key}`,
      layer: group[0]!.layer,
      objectName: group[0]!.objectName,
      objectId: group[0]!.objectId,
      parentName: group[0]!.parentName,
      category: objectSelected ? group[0]!.category : '全部品类',
      sku: '全部SKU',
      currentQty,
      availableQty: group.every(row => row.availableQty != null) ? sum(group.map(row => row.availableQty)) : null,
      targetQty,
      differenceQty: targetQty == null ? null : round(currentQty - targetQty),
      turnoverDemand30d,
      plannedDailyQty,
      forecastInventoryQty,
      targetTurnoverDays: plannedDailyQty != null && plannedDailyQty > 0 && targetQty != null ? round(targetQty / plannedDailyQty) : null,
      projectedTurnoverDays:
        plannedDailyQty != null && plannedDailyQty > 0 && forecastInventoryQty != null && forecastInventoryQty >= 0 ? round(forecastInventoryQty / plannedDailyQty) : null,
      turnoverDays: ratioDays(currentQty, turnoverDemand30d),
      averageAgeDays: avgAgeDenominator > 0 ? round(sum(group.map(row => (row.averageAgeDays ?? 0) * row.currentQty)) / avgAgeDenominator, 1) : null,
      bigDateQty: group[0]!.layer === 'customer' ? (group.every(row => row.bigDateQty != null) ? sum(group.map(row => row.bigDateQty)) : null) : batchBigDate,
      judgment: hasAgeRisk ? '下级存在大日期库存' : targetQty == null ? '部分目标不可用' : '展开查看 SKU',
      suggestedAction: hasAgeRisk ? '下钻 SKU 并按层处理' : '按品类继续下钻',
      owner: group[0]!.owner,
      sourceDate: latest(group.map(row => row.sourceDate)) ?? '',
      confidence: `由 ${group.length} 个 SKU 真实记录汇总`
    }
  })
}

export function buildAccessScopeId(access: TrustedAccessContext) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        principalId: access.principalId,
        ...(access.gatewayScopeRef ? { gatewayScopeRef: access.gatewayScopeRef } : {}),
        bases: access.allowedBases?.toSorted() ?? null,
        branches: access.allowedBranches?.toSorted() ?? null,
        customers: access.allowedCustomerIds?.toSorted() ?? null
      })
    )
    .digest('hex')
    .slice(0, 16)
}

function buildRisks(aging: AgingLayerValues, pendingGap: number | null): WorkspaceRisk[] {
  const risks: WorkspaceRisk[] = []
  if ((aging.base ?? 0) > 0) risks.push({ code: 'BASE_OVER_AGE', level: 'high', title: '基地超期库存', detail: `${aging.base} 件超过 60 天`, owner: '基地计划', tab: 'aging' })
  if ((aging.branch ?? 0) > 0)
    risks.push({ code: 'BRANCH_STAGNANT', level: 'high', title: '分仓滞销库存', detail: `${aging.branch} 件达到 90 天`, owner: '分仓运营', tab: 'aging' })
  if ((pendingGap ?? 0) > 0)
    risks.push({ code: 'PENDING_ALLOCATION_GAP', level: 'attention', title: '当前待分配缺口', detail: `${pendingGap} 件尚未分配`, owner: '分仓订单运营', tab: 'shortage' })
  return risks
}

function buildCustomerObservationRisks(data: FullChainData, aging: AgingLayerValues, includeCustomer: boolean): WorkspaceRisk[] {
  if (!includeCustomer) return []
  const risks: WorkspaceRisk[] = []
  if ((aging.customer ?? 0) > 0)
    risks.push({ code: 'CUSTOMER_FUSE', level: 'high', title: '客户库存熔断观察', detail: `${aging.customer} 件达到 120 天；不计入公司主判断`, owner: '经销商运营', tab: 'aging' })
  if (data.customerInventory.some(row => row.sourceConflict))
    risks.push({
      code: 'CUSTOMER_SOURCE_CONFLICT',
      level: 'info',
      title: '客户库存源不一致',
      detail: 'JXC 当前库存与计划辅助源存在差异，未静默覆盖；不计入公司主判断',
      owner: '客户库存数据治理',
      tab: 'structure'
    })
  return risks
}

function weightedAverageAge(batches: AgingBatchRow[]) {
  const companyBatches = companyAgingSample(batches).filter(row => row.layer !== 'customer')
  if (!companyBatches.length || companyBatches.some(row => row.qty !== 0 && row.ageDays == null)) return null
  const quantity = sum(companyBatches.map(row => row.qty))
  return quantity > 0 ? round(sum(companyBatches.map(row => row.qty * row.ageDays!)) / quantity, 1) : null
}

function detailTree<T extends { layer: InventoryLayer; objectName: string; objectId?: string; category: string; sku: string }>(
  rows: T[],
  filters: WorkspaceFilters,
  prefix: string,
  summarize: (rows: T[], layer: InventoryLayer, nodeFilters: WorkspaceFilters) => WorkspaceDetailNode['values']
): WorkspaceDetailNode[] {
  return [...groupBy(rows, row => row.layer)].map(([layer, layerRows]) => {
    const node = (label: string, items: T[], nodeFilters: WorkspaceFilters, depth: number): WorkspaceDetailNode => ({
      key: `${prefix}:${layer}:${JSON.stringify(nodeFilters)}`,
      label,
      layer,
      filters: nodeFilters,
      expandable: depth < 3,
      values: summarize(items, layer, nodeFilters)
    })
    const root = node(layer === 'base' ? '基地汇总' : layer === 'branch' ? '分仓汇总' : '客户观测', layerRows, {}, 0)
    root.children = [...groupBy(layerRows, row => row.objectId ?? row.objectName)].map(([, objectRows]) => {
      const first = objectRows[0]!
      const objectFilter: WorkspaceFilters =
        layer === 'base' ? { base: first.objectName } : layer === 'branch' ? { branch: first.objectName } : { customerId: first.objectId ?? first.objectName }
      const objectNode = node(first.objectName, objectRows, objectFilter, 1)
      if (filters.base || filters.branch || filters.customerId) {
        objectNode.children = [...groupBy(objectRows, row => row.category)].map(([category, categoryRows]) => {
          const categoryNode = node(category || '未分类', categoryRows, { ...objectFilter, category }, 2)
          if (filters.category != null || filters.sku)
            categoryNode.children = [...groupBy(categoryRows, row => row.sku)].map(([sku, skuRows]) => node(sku, skuRows, { ...objectFilter, category, sku }, 3))
          return categoryNode
        })
      }
      return objectNode
    })
    return root
  })
}

function buildAgingDetails(data: FullChainData, filters: WorkspaceFilters): WorkspaceDetailNode[] {
  return detailTree(data.agingBatches, filters, 'age', (rawBatches, layer) => {
    const batches = companyAgingSample(rawBatches)
    const excluded = rawBatches.length - batches.length
    const valid = batches.length > 0 && batches.every(row => (row.layer === 'base' || row.qty >= 0) && (row.qty === 0 || row.ageDays != null))
    const quantity = sum(batches.map(row => row.qty))
    const speeds = [
      ...groupBy(
        batches.filter(row => row.qty > 0),
        row => `${row.objectId ?? row.objectName}\u0000${row.sku}`
      )
    ].map(([, group]) => {
      const values = new Set(group.map(row => row.dailyVelocity))
      return values.size === 1 && group[0]!.dailyVelocity != null && group[0]!.dailyVelocity! >= 0 ? group[0]!.dailyVelocity : null
    })
    const dailyVelocity = valid ? (speeds.length ? completeSum(speeds) : 0) : null
    const band = (low: number, high: number) => (valid ? round(sum(batches.filter(row => row.ageDays! >= low && row.ageDays! <= high).map(row => row.qty))) : null)
    return {
      currentQty: round(sum(rawBatches.map(row => row.qty))),
      averageAgeDays: valid && quantity > 0 ? round(sum(batches.map(row => row.qty * (row.ageDays ?? 0))) / quantity, 1) : null,
      maxAgeDays: valid ? batches.reduce((max, row) => Math.max(max, row.ageDays ?? 0), 0) : null,
      age0to30: band(0, 30),
      age31to40: band(31, 40),
      age41to60: band(41, 60),
      age60Plus: band(61, Infinity),
      riskQty: valid ? ageQuantity(batches, layer, 'risk') : null,
      attentionQty: valid ? ageQuantity(batches, layer, 'attention') : null,
      day7: valid && dailyVelocity != null ? ageQuantity(batches, layer, 'risk', 7) : null,
      day14: valid && dailyVelocity != null ? ageQuantity(batches, layer, 'risk', 14) : null,
      dailyVelocity,
      threshold: layer === 'base' ? '>60天' : layer === 'branch' ? '≥90天（60–89天关注）' : '≥120天熔断（60/90天分级）',
      velocityBasis: layer === 'branch' ? '分仓计划日均（非实际动销）' : layer === 'base' ? '基地近30日速度' : '客户近30日动销',
      sourceDate: latest(batches.map(row => row.snapshotDate)),
      forecastReason:
        (excluded ? `已排除 ${excluded} 批负库存；` : '') +
        (!valid ? '缺少货龄或存在负库存，预测不可用' : dailyVelocity == null ? '缺少或存在冲突的SKU速度，预测不可用' : 'FIFO按SKU扣减；7/14天后仍超期的存量，非新增超期'),
      owner: layer === 'base' ? '基地计划' : layer === 'branch' ? '分仓计划' : '销售协同',
      action: layer === 'customer' ? '先复核来源与动销，仅作观察' : '按批次优先消化，复核补货节奏'
    }
  })
}

function distinctOrderCount(rows: FullChainData['orders'], affected = false): number | null {
  const field = affected ? 'affectedOrderIds' : 'orderIds'
  return rows.length && rows.every(row => row[field] != null) ? new Set(rows.flatMap(row => row[field]!)).size : null
}

function buildOrderDetails(data: FullChainData, filters: WorkspaceFilters): WorkspaceDetailNode[] {
  const monthly = data.orders.map(row => ({ ...row, period: 'month' }))
  const weekly = (data.orders7d ?? []).map(row => ({ ...row, period: 'week' }))
  const rows = [...monthly, ...weekly]
    .filter(row => row.objectName && row.sku)
    .map(row => ({
      ...row,
      layer: row.pickupType === 'factory' ? ('base' as const) : ('branch' as const),
      objectName: row.objectName!,
      category: row.category ?? '未分类',
      sku: row.sku!
    }))
  const inventories = [
    ...data.baseInventory.map(row => ({ ...row, layer: 'base' as const, objectName: row.base })),
    ...data.branchInventory.map(row => ({ ...row, layer: 'branch' as const, objectName: row.branch }))
  ]
  // Request-local indexes preserve original row order and first-match semantics.
  const inventoriesByLayer = groupBy(inventories, row => row.layer)
  const inventoriesByObject = groupBy(inventories, row => JSON.stringify([row.layer, row.objectName]))
  const firstBranchStock = new Map<string, (typeof inventories)[number]>()
  for (const row of inventories) {
    const key = JSON.stringify([row.objectName, row.sku])
    if (row.layer === 'branch' && !firstBranchStock.has(key)) firstBranchStock.set(key, row)
  }
  const pendingByBranch = groupBy(data.pendingOrders, row => row.branch)
  // Pending-only warehouses/SKUs must remain visible even when this month has no fulfillment row.
  for (const pending of data.pendingOrders) {
    if (!pending.sku) continue
    const stock = firstBranchStock.get(JSON.stringify([pending.branch, pending.sku]))
    const category = stock?.category ?? '未分类'
    if (filters.category && category !== filters.category) continue
    rows.push({
      layer: 'branch',
      objectName: pending.branch,
      category,
      sku: pending.sku,
      period: 'pending',
      snapshotDate: pending.snapshotDate,
      month: '',
      pickupType: 'branch',
      demandQty: 0,
      shortageQty: 0,
      shippedQty: 0,
      affectedOrders: 0
    })
  }
  return detailTree(rows, filters, 'order', (items, layer, nodeFilters) => {
    const current = items.filter(row => row.period === 'month')
    const week = items.filter(row => row.period === 'week')
    const object = nodeFilters.base || nodeFilters.branch
    const stockCandidates = object ? (inventoriesByObject.get(JSON.stringify([layer, object])) ?? []) : (inventoriesByLayer.get(layer as 'base' | 'branch') ?? [])
    const stock = stockCandidates.filter(
      row =>
        row.layer === layer &&
        (!nodeFilters.base || row.objectName === nodeFilters.base) &&
        (!nodeFilters.branch || row.objectName === nodeFilters.branch) &&
        (!nodeFilters.category || row.category === nodeFilters.category) &&
        (!nodeFilters.sku || row.sku === nodeFilters.sku)
    )
    const stockSkus = new Set<string | undefined>(stock.map(row => row.sku))
    const pendingCandidates = nodeFilters.branch ? (pendingByBranch.get(nodeFilters.branch) ?? []) : data.pendingOrders
    const pending =
      layer === 'branch'
        ? pendingCandidates.filter(
            row =>
              (!nodeFilters.branch || row.branch === nodeFilters.branch) && (!nodeFilters.sku || row.sku === nodeFilters.sku) && (!nodeFilters.category || stockSkus.has(row.sku))
          )
        : []
    const demand = completeSum(current.map(row => row.demandQty))
    const shortage = completeSum(current.map(row => row.shortageQty))
    return {
      orderQty: completeSum(current.map(row => row.orderQty)),
      orderCount: distinctOrderCount(current),
      demandQty: demand,
      shippedQty: completeSum(current.map(row => row.shippedQty)),
      shortageQty: shortage,
      rate:
        layer === 'base'
          ? fulfillmentRate(current)
          : nodeFilters.sku || nodeFilters.category
            ? null
            : branchFulfillmentRate({ ...data, branchFulfillment: data.branchFulfillment?.filter(row => !nodeFilters.branch || row.branch === nodeFilters.branch) }),
      affectedOrders: distinctOrderCount(current, true),
      shortageSkus: current.length ? new Set(current.filter(row => row.shortageQty > 0).map(row => row.sku)).size : null,
      currentQty: completeSum(stock.map(row => row.currentQty)),
      availableQty: completeSum(stock.map(row => row.availableQty)),
      pendingQty: completeSum(pending.map(row => row.demandQty)),
      allocatedQty: completeSum(pending.map(row => row.allocatedQty)),
      preparedQty: completeSum(pending.map(row => row.preparedQty)),
      preparedReason: '备单完成且未发货状态的占单量；不把全部已分配量当作已备',
      orderQty7d: completeSum(week.map(row => row.orderQty)),
      shippedQty7d: completeSum(week.map(row => row.shippedQty)),
      shortageQty7d: completeSum(week.map(row => row.shortageQty)),
      collaborativeQty: null,
      collaborativeReason: '跨仓可用量及可调拨约束未齐，不抵消原缺口',
      sourceDate: latest(items.map(row => row.snapshotDate)),
      owner: layer === 'base' ? '基地订单运营' : '分仓订单运营',
      action: '核对缺口订单、可用库存与补货安排'
    }
  })
}

export function buildFullChainWorkspace(input: FullChainData, request: BuildWorkspaceRequest): FullChainWorkspace {
  if (!request.access.trusted || !request.access.principalId) throw new Error('A trusted access context is required before data retrieval')
  const data = applyTrustedScope(input, request)
  const includeCustomer = request.scope === 'all-channel'
  const companyRows = [...data.baseInventory, ...data.branchInventory]
  const companyCurrent = completeSum([...data.baseInventory.map(row => row.currentQty), ...data.branchInventory.map(row => row.availableQty)])
  const customerCurrent = sum(data.customerInventory.map(row => row.currentQty))
  const planCustomerRows = data.customerPlanInventory ?? []
  const planCustomerTotal =
    includeCustomer && planCustomerRows.length && planCustomerRows.every(row => row.stockQty != null && row.inTransitQty != null)
      ? sum(planCustomerRows.map(row => row.stockQty! + row.inTransitQty!))
      : null
  const planCustomerDate = planCustomerTotal == null ? null : latest(planCustomerRows.map(row => row.snapshotDate))
  const inventoryCurrent = companyCurrent == null ? null : companyCurrent + (includeCustomer ? customerCurrent : 0)
  const companyTarget = data.branchInventory.length
    ? completeSum(companyRows.map(row => row.targetQty))
    : data.baseInventory.some(row => row.targetQty != null)
      ? sum(data.baseInventory.map(row => row.targetQty))
      : null
  const baseTurnover = ratioDays(
    completeSum(data.baseInventory.map(row => row.currentQty)),
    data.baseInventory.some(row => row.plannedDailyQty != null) ? sum(data.baseInventory.map(row => row.plannedDailyQty)) * 30 : null
  )
  const branchTurnoverValue = branchTurnover(data)
  const mixedLayers = data.baseInventory.length > 0 && data.branchInventory.length > 0
  const turnover = mixedLayers ? null : data.baseInventory.length ? baseTurnover : branchTurnoverValue
  const agingByLayer = layerValues(data.agingBatches, 'risk')
  const attentionByLayer = layerValues(data.agingBatches, 'attention')
  const highRiskByLayer = layerValues(data.agingBatches, 'high')
  const ageCurrent = weightedAverageAge(data.agingBatches)
  const orderShortage = data.orders.length ? sum(data.orders.map(row => row.shortageQty)) : null
  const factoryRows = data.orders.filter(row => row.pickupType === 'factory')
  const branchRows = data.orders.filter(row => row.pickupType === 'branch')
  const segment = (rows: typeof data.orders) => {
    const demandQty = sum(rows.map(row => row.demandQty))
    const shortageQty = sum(rows.map(row => row.shortageQty))
    return {
      orderQty: completeSum(rows.map(row => row.orderQty)),
      shippedQty: completeSum(rows.map(row => row.shippedQty)),
      demandQty,
      shortageQty,
      rate: fulfillmentRate(rows),
      affectedOrders: distinctOrderCount(rows, true) ?? sum(rows.map(row => row.affectedOrders))
    }
  }
  const coveredIds = new Set(data.customerInventory.map(row => row.customerId))
  const activeIds = new Set(data.activeCustomerIds30d)
  const coveredCustomers = [...activeIds].filter(id => coveredIds.has(id)).length
  const coverageRate = activeIds.size ? round((coveredCustomers / activeIds.size) * 100, 1) : null
  const allDates = [
    ...data.baseInventory.map(row => row.snapshotDate),
    ...data.branchInventory.map(row => row.snapshotDate),
    ...(includeCustomer ? data.customerInventory.map(row => row.snapshotDate) : []),
    ...data.agingBatches.filter(row => includeCustomer || row.layer !== 'customer').map(row => row.snapshotDate),
    ...data.orders.map(row => row.snapshotDate),
    ...data.pendingOrders.map(row => row.snapshotDate)
  ]
    .filter(Boolean)
    .sort()
  const companyAgingBatches = data.agingBatches.filter(row => row.layer !== 'customer')
  const byDomain = {
    inventory: sourceDate(data, 'inventory'),
    aging: latest(companyAgingBatches.map(row => row.snapshotDate)),
    orders: sourceDate(data, 'orders'),
    customer: sourceDate(data, 'customer'),
    pendingOrders: sourceDate(data, 'pending'),
    baseInventory: latest(data.baseInventory.map(row => row.snapshotDate)),
    branchInventory: latest(data.branchInventory.map(row => row.snapshotDate)),
    customerStatistics: latest(data.customerInventory.map(row => row.statisticDate)),
    customerOldestUpload:
      data.customerInventory
        .map(row => row.snapshotDate)
        .filter(Boolean)
        .sort()[0] ?? null
  }
  const pendingGap = data.pendingOrders.length ? sum(data.pendingOrders.map(row => Math.max(0, row.demandQty - row.allocatedQty))) : null
  const currentShortage = completeSum([...(data.baseCurrentOrders ?? []).map(row => row.shortageQty), ...data.pendingOrders.map(row => row.shortageQty)])
  const day7 = layerValues(data.agingBatches, 'risk', 7)
  const day14 = layerValues(data.agingBatches, 'risk', 14)
  const risks = buildRisks(agingByLayer, pendingGap)
  const customerObservationRisks = buildCustomerObservationRisks(data, agingByLayer, includeCustomer)
  const inventoryDateCount = new Set(data.inventoryTrend.map(row => row.snapshotDate)).size
  const companyDomainsReady = Boolean(byDomain.inventory && byDomain.aging && byDomain.orders)
  const targetCount = companyRows.filter(row => row.targetQty != null).length
  const demandCount = companyRows.filter(row => row.externalDemand30d != null).length
  const ageCount = companyAgingBatches.filter(row => row.ageDays != null).length
  const velocityCount = companyAgingBatches.filter(row => row.dailyVelocity != null).length
  const negativeCount = companyRows.filter(row => row.currentQty < 0).length
  const negativeBatchCount = companyAgingBatches.filter(row => row.layer === 'branch' && row.qty < 0).length
  const companyFieldsIncomplete =
    targetCount < companyRows.length ||
    demandCount < companyRows.length ||
    ageCount < companyAgingBatches.length ||
    velocityCount < companyAgingBatches.length ||
    negativeCount > 0 ||
    negativeBatchCount > 0
  const completenessSummary = `当前公司范围：目标完整 ${targetCount}/${companyRows.length}，消耗完整 ${demandCount}/${companyRows.length}；库龄完整 ${ageCount}/${companyAgingBatches.length} 批，速度完整 ${velocityCount}/${companyAgingBatches.length} 批。${negativeCount ? `存在 ${negativeCount} 条负库存，需业务核对。` : ''}${negativeBatchCount ? `存在 ${negativeBatchCount} 批负库存，已从公司库龄、超期量及预测中排除。` : ''}${companyFieldsIncomplete ? '缺失值不补零；各层周转使用各自来源口径，目标及预测仍受数据完整性限制。' : ''}`
  const customerConflict = data.customerInventory.some(row => row.sourceConflict)
  const customerAgeIncomplete = data.agingBatches.some(row => row.layer === 'customer' && row.qty > 0 && row.ageDays == null)
  const customerFreshnessDays = byDomain.customer == null ? null : Math.floor((request.now.getTime() - new Date(`${byDomain.customer}T00:00:00Z`).getTime()) / 86_400_000)
  const customerAgeDatesBySource = groupBy(
    data.agingBatches.filter(row => row.layer === 'customer'),
    row => row.source ?? '未标记来源'
  )
  const customerAgeSourceFreshnessDays = [...customerAgeDatesBySource.values()].map(rows => {
    const sourceLatestDate = latest(rows.map(row => row.snapshotDate))
    return sourceLatestDate == null ? null : Math.floor((request.now.getTime() - new Date(`${sourceLatestDate}T00:00:00Z`).getTime()) / 86_400_000)
  })
  const customerFieldsIncomplete = data.customerInventory.some(row => row.sales30d == null || row.targetQty == null)
  const customerQualityPenalty =
    customerConflict ||
    customerAgeIncomplete ||
    customerFieldsIncomplete ||
    (data.customerQuantityGaps?.length ?? 0) > 0 ||
    customerFreshnessDays == null ||
    customerFreshnessDays > 3 ||
    data.customerInventory.some(row => !row.snapshotDate || (request.now.getTime() - new Date(row.snapshotDate + 'T00:00:00+08:00').getTime()) / 86_400_000 > 3) ||
    customerAgeSourceFreshnessDays.length === 0 ||
    customerAgeSourceFreshnessDays.some(days => days == null || days > 3)
  const confidenceLevel = includeCustomer
    ? !companyDomainsReady || coverageRate == null || coverageRate < 30
      ? 'low'
      : coverageRate < 70 || customerQualityPenalty || companyFieldsIncomplete
        ? 'medium'
        : 'high'
    : !companyDomainsReady
      ? 'low'
      : companyFieldsIncomplete
        ? 'medium'
        : 'high'
  const confidenceSummary = includeCustomer
    ? coverageRate == null
      ? '客户覆盖率不可用；公司系统判断保持独立。'
      : `客户库存覆盖近30天活跃客户的 ${coverageRate.toFixed(1)}%；${customerQualityPenalty ? '存在库存/库龄新鲜度、关键字段完整性或主辅源冲突限制；' : '客户数据质量检查通过；'}公司系统判断保持独立。`
    : companyDomainsReady
      ? '公司体系核心库存、库龄与订单域均有真实快照；客户观察未纳入当前范围。'
      : '公司体系必要数据域不完整；客户观察未纳入当前范围。'
  const workspaceFingerprint = JSON.stringify({
    ruleVersion: RULE_VERSION,
    principalId: request.access.principalId,
    scope: request.scope,
    filters: request.filters,
    dates: byDomain,
    data
  })
  const workspaceId = `fcw_${createHash('sha256').update(workspaceFingerprint).digest('hex').slice(0, 16)}`
  const accessScopeId = buildAccessScopeId(request.access)
  const orderTrend = groupBy(data.orderHistory?.length ? data.orderHistory : data.orders, row => row.snapshotDate)
  const ageTrend = groupBy(companyAgingBatches, row => `${row.snapshotDate}\u0000${row.layer}`)
  const agingTrend = data.agingHistory?.length
    ? data.agingHistory
    : [...ageTrend.entries()]
        .map(([key, rows]) => ({ snapshotDate: key.split('\u0000')[0]!, layer: rows[0]!.layer as 'base' | 'branch', averageAge: weightedAverageAge(rows) }))
        .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))

  const inventoryStructure = structureRows(data, includeCustomer)
  return {
    contractVersion: 'full-chain-workspace/v1',
    workspaceId,
    accessScopeId,
    generatedAt: request.now.toISOString(),
    scope: request.scope,
    filters: request.filters,
    kpis: {
      inventoryLevel: {
        ...metric(
          companyCurrent,
          companyTarget,
          '件',
          includeCustomer
            ? '主值为公司系统库存；客户总量取最新预订单快照在仓加在途，客户明细与货龄仍为库存日快照观察'
            : '基地当前库存 + 分仓可用库存（与分仓 Agent 库存卡一致）；实物库存另见结构明细',
          byDomain.inventory
        ),
        companyCurrent,
        observedCustomer: includeCustomer ? customerCurrent : 0,
        observedTotal: inventoryCurrent,
        planCustomerTotal,
        planCustomerDate
      },
      turnover: metric(
        turnover,
        null,
        '天',
        mixedLayers
          ? '基地按库存/计划日均需求，分仓按可用库存/近30天实际日均出库；口径不同，分别展示，不合成公司周转'
          : data.baseInventory.length
            ? '基地库存合计 / 已提供计划日均需求合计，与安全库存 Agent 一致；缺失计划不补值'
            : '分仓可用库存 / 近30天实际日均出库；分母含已售罄SKU，不使用计划代替',
        byDomain.inventory
      ),
      aging: metric(
        ageCurrent,
        null,
        '天',
        `${negativeBatchCount ? `已排除 ${negativeBatchCount} 批负库存；` : ageCurrent == null ? '有效批次库龄不足；' : ''}公司体系批次库存的数量加权平均货龄；各层超期量仅在明细中按各自阈值展示`,
        byDomain.aging,
        (agingByLayer.base ?? 0) > 0 || (agingByLayer.branch ?? 0) > 0
      ),
      fulfillment: metric(
        mixedLayers ? null : data.baseInventory.length || request.filters.base ? fulfillmentRate(factoryRows) : branchFulfillmentRate(data),
        null,
        '%',
        '基地：1－当月缺口/需求；分仓：运营事实表当月发货/订单。不同口径分别展示，不合成全国满足率；SKU/品类分仓履约未发布时留空',
        byDomain.orders,
        (orderShortage ?? 0) > 0
      ),
      orderGap: metric(
        currentShortage,
        0,
        '件',
        '当前缺货量：按基地/分仓、SKU计算备单中未占用需求减可用库存，负值取0；月度发运后缺口单独展示',
        latest([...(data.baseCurrentOrders ?? []).map(row => row.snapshotDate), ...data.pendingOrders.map(row => row.snapshotDate)]),
        (currentShortage ?? 0) > 0
      )
    },
    layerMetrics: {
      base: {
        averageAgeDays: weightedAverageAge(data.agingBatches.filter(row => row.layer === 'base')),
        turnoverDays: baseTurnover
      },
      branch: {
        averageAgeDays: weightedAverageAge(data.agingBatches.filter(row => row.layer === 'branch')),
        turnoverDays: branchTurnoverValue
      }
    },
    freshness: { minDate: allDates[0] ?? null, maxDate: allDates.at(-1) ?? null, byDomain },
    coverage: { coveredCustomers, activeCustomers: activeIds.size, rate: coverageRate },
    confidence: { level: confidenceLevel, summary: `${completenessSummary} ${confidenceSummary}` },
    structure: compactStructureRows(inventoryStructure, request.filters, data.agingBatches).map(row =>
      row.layer !== 'branch'
        ? row
        : {
            ...row,
            turnoverDemand30d: completeSum(
              data.branchOutbound
                ?.filter(
                  item => item.branch === row.objectName && (row.category === '全部品类' || item.category === row.category) && (row.sku === '全部SKU' || item.sku === row.sku)
                )
                .map(item => item.qty) ?? []
            ),
            turnoverDays: branchTurnover(data, row.objectName, row.category === '全部品类' ? undefined : row.category, row.sku === '全部SKU' ? undefined : row.sku)
          }
    ),
    categoryStructure: (request.filters.sku ? inventoryStructure : categoryStructureRows(inventoryStructure)).map(row =>
      row.layer !== 'branch'
        ? row
        : {
            ...row,
            turnoverDemand30d: completeSum(data.branchOutbound?.filter(item => item.branch === row.objectName && item.category === row.category).map(item => item.qty) ?? []),
            turnoverDays: branchTurnover(data, row.objectName, row.category, request.filters.sku)
          }
    ),
    agingDetails: buildAgingDetails(data, request.filters),
    orderDetails: buildOrderDetails(data, request.filters),
    orderExecution: {
      currentBaseShortageQty: completeSum((data.baseCurrentOrders ?? []).map(row => row.shortageQty)),
      currentBranchShortageQty: completeSum(data.pendingOrders.map(row => row.shortageQty)),
      currentOrderQty: completeSum([...(data.baseCurrentOrders ?? []).map(row => row.orderQty), ...data.pendingOrders.map(row => row.demandQty)]),
      currentBaseOrderQty: completeSum((data.baseCurrentOrders ?? []).map(row => row.orderQty)),
      currentBranchOrderQty: completeSum(data.pendingOrders.map(row => row.demandQty)),
      preparedBranchQty: completeSum(data.pendingOrders.map(row => row.preparedQty)),
      orderQty: completeSum(data.orders.map(row => row.orderQty)),
      orderCount: distinctOrderCount(data.orders),
      shippedQty: completeSum(data.orders.map(row => row.shippedQty)),
      orderQty7d: completeSum((data.orders7d ?? []).map(row => row.orderQty)),
      shippedQty7d: completeSum((data.orders7d ?? []).map(row => row.shippedQty)),
      shortageQty7d: completeSum((data.orders7d ?? []).map(row => row.shortageQty)),
      windowEnd: request.filters.month
        ? [
            request.now.toISOString().slice(0, 10),
            new Date(Date.UTC(Number(request.filters.month.slice(0, 4)), Number(request.filters.month.slice(5, 7)), 0)).toISOString().slice(0, 10)
          ].sort()[0]!
        : request.now.toISOString().slice(0, 10)
    },
    aging: {
      over30ByLayer: Object.fromEntries(
        (['base', 'branch', 'customer'] as const).map(layer => {
          const rows = companyAgingSample(data.agingBatches.filter(row => row.layer === layer))
          return [
            layer,
            rows.length && rows.every(row => row.qty === 0 || row.ageDays !== null) ? sum(rows.filter(row => row.ageDays !== null && row.ageDays > 30).map(row => row.qty)) : null
          ]
        })
      ) as AgingLayerValues,
      byLayer: agingByLayer,
      attentionByLayer,
      highRiskByLayer,
      projections: { day7: { byLayer: day7, state: projectionState(day7, includeCustomer) }, day14: { byLayer: day14, state: projectionState(day14, includeCustomer) } }
    },
    fulfillment: {
      factory: segment(factoryRows),
      branch: {
        ...segment(branchRows),
        rate: branchFulfillmentRate(data),
        orderQty: completeSum(data.branchFulfillment?.map(row => row.orderQty) ?? []),
        shippedQty: completeSum(data.branchFulfillment?.map(row => row.shippedQty) ?? [])
      },
      national: {
        ...segment(data.orders),
        rate: mixedLayers ? null : data.baseInventory.length || request.filters.base ? fulfillmentRate(factoryRows) : branchFulfillmentRate(data)
      }
    },
    pendingOrderGap: pendingGap,
    trends: {
      ...(data.historyDeferred ? { state: 'loading' as const } : {}),
      inventory: data.inventoryTrend.filter(row => includeCustomer || row.layer !== 'customer'),
      orders: data.historyDeferred
        ? []
        : [...orderTrend.entries()]
            .map(([snapshotDate, rows]) => {
              const demandQty = sum(rows.map(row => row.demandQty))
              const shortageQty = sum(rows.map(row => row.shortageQty))
              return { snapshotDate, demandQty, satisfiedQty: demandQty - shortageQty, shortageQty, fulfillmentRate: fulfillmentRate(rows) }
            })
            .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate)),
      aging: data.historyDeferred ? [] : agingTrend,
      historyPoints: inventoryDateCount
    },
    risks,
    customerObservationRisks,
    evidence: {
      ruleVersion: RULE_VERSION,
      sourceTables: includeCustomer ? [...COMPANY_SOURCE_TABLES, ...CUSTOMER_SOURCE_TABLES] : COMPANY_SOURCE_TABLES,
      customerAgeSources: includeCustomer
        ? [
            ...new Map(
              data.agingBatches
                .filter(row => row.layer === 'customer' && row.source)
                .map(row => [`${row.source}:${row.snapshotDate}`, { source: row.source!, snapshotDate: row.snapshotDate }])
            ).values()
          ]
        : [],
      dataNotes: [
        '分仓满足率源为运营事实表，历史订单明细和发运后缺口仍为履约明细表，不以两者互相替代。',
        '当前订单和缺货量使用最新备单快照：基地按业务状态及SKU可用库存，分仓按备单中未占用需求及可用库存；不以本月累计订单替代。',
        ...(data.orders.some(row => row.orderQty != null && row.shippedQty > row.orderQty)
          ? ['履约明细存在发货量超过订单量的源记录；保留异常提示，基地满足率仍按需求和缺口计算，分仓满足率独立使用运营事实。']
          : []),
        ...((data.customerQuantityGaps?.length ?? 0) > 0
          ? [`客户观察有 ${data.customerQuantityGaps!.length} 条库存数量缺失，仅汇总已提供数量的记录；未补零，观察量不代表客户完整库存。`]
          : []),
        '分仓当前库存独立于 SKU 计划覆盖；没有当前计划的分仓仍保留库存，目标和需求不补零。',
        '分仓目标库存单位为件：仅使用已就绪月计划，按（补货周期 + 3）×计划日均计算；月度预算金额不作为库存数量。',
        ...(data.pendingOrders.some(row => row.stageVerified !== true) ? ['备单新状态口径尚未完成同步，待分配缺口包含历史未标记订单，仅供核对，不等同发运后缺口。'] : []),
        ...(includeCustomer
          ? ['客户观察取最新统计批次并保留各客户实际上传日期；上传日期缺失或较旧不代表实时库存。客户趋势按统计日展示，不将重复上传快照跨统计日累加为同日库存。']
          : [])
      ],
      readOnly: true
    }
  }
}
