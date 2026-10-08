import type { FullChainData, OrderRow } from './full-chain-types.js'

type Row = Record<string, unknown>
export type CompanySourceRows = Record<
  | 'base'
  | 'branch'
  | 'baseAge'
  | 'branchAge'
  | 'orders'
  | 'pending'
  | 'orders7d'
  | 'outbound'
  | 'branchFulfillment'
  | 'baseCurrentOrders'
  | 'trend'
  | 'orderHistory'
  | 'agingHistory',
  Row[]
>

function number(value: unknown): number {
  if (value == null || value === '') throw Error('Required numeric source value is missing')
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw Error('Required numeric source value is invalid')
  return parsed
}
const nullable = (value: unknown): number | null => (value == null || value === '' ? null : number(value))
const date = (value: unknown) =>
  value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value ?? '').slice(0, 10)
function orderIds(value: unknown): string[] {
  if (value == null) return []
  const items: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(items) || items.some(item => typeof item !== 'string')) throw Error('订单编号列表返回格式无效')
  return items
}
function zeroAgeBatches(rows: Row[]): Row[] {
  let total = 0
  return rows.flatMap(row => {
    const count = Number(row.batch_count)
    if (!Number.isSafeInteger(count) || count < 1 || count > 200000 || (total += count) > 200000) throw Error('货龄批次数缺失或超出完整返回上限')
    if (count > 1 && Number(row.qty ?? 0) !== 0) throw Error('非零货龄批次不得合并')
    return Array<Row>(count).fill(row)
  })
}

/** Original company source mappings and quantity/velocity rules; no identity or IO. */
export function normalizeCompanySource(rows: CompanySourceRows): FullChainData {
  if (rows.branch.some(row => Number(row.mapping_issue_count ?? 0) > 0)) throw Error('分仓目录映射缺失或存在编码/名称冲突，请核对计划、库存与货龄快照；未展示不完整的分仓汇总')
  const baseInventory = rows.base.map(row => ({
    snapshotDate: date(row.snapshot_date),
    base: String(row.base_name),
    category: String(row.category),
    sku: String(row.sku),
    currentQty: number(row.current_qty),
    targetQty: nullable(row.target_qty),
    sourceTargetTurnoverDays: nullable(row.source_target_turnover_days),
    plannedDailyQty: nullable(row.planned_daily_qty),
    externalDemand30d: nullable(row.external_demand_30d),
    confirmedTransferOut30d: nullable(row.transfer_out_30d)
  }))
  const branchInventory = rows.branch
    .filter(row => row.sku != null)
    .map(row => ({
      snapshotDate: date(row.snapshot_date),
      base: null,
      branch: String(row.branch),
      category: String(row.category),
      sku: String(row.sku),
      currentQty: number(row.current_qty),
      availableQty: nullable(row.available_qty),
      targetQty: nullable(row.target_qty),
      plannedDailyQty: nullable(row.planned_daily_qty),
      forecastInventoryQty: nullable(row.forecast_inventory_qty),
      externalDemand30d: nullable(row.external_demand_30d)
    }))
  const branchOutbound = rows.outbound.map(row => ({
    branch: String(row.branch),
    sku: String(row.sku),
    category: row.category == null ? undefined : String(row.category),
    snapshotDate: date(row.snapshot_date),
    qty: nullable(row.outbound_qty)
  }))
  const outboundBySku = new Map(branchOutbound.map(row => [`${row.branch}\u0000${row.sku}`, row.qty]))
  for (const row of branchInventory) row.externalDemand30d = outboundBySku.get(`${row.branch}\u0000${row.sku}`) ?? null
  const baseVelocity = new Map(baseInventory.map(row => [`${row.base}\u0000${row.sku}`, row.externalDemand30d == null ? null : row.externalDemand30d / 30]))
  const branchVelocity = new Map(branchInventory.map(row => [`${row.branch}\u0000${row.sku}`, row.plannedDailyQty ?? null]))
  const mapOrder = (row: Row): OrderRow => ({
    snapshotDate: date(row.snapshot_date),
    month: String(row.month),
    pickupType: String(row.pickup_type) === 'factory' ? 'factory' : 'branch',
    objectName: row.object_name == null ? undefined : String(row.object_name),
    category: row.category == null ? undefined : String(row.category),
    sku: row.sku == null ? undefined : String(row.sku),
    orderQty: nullable(row.order_qty),
    orderIds: orderIds(row.order_ids),
    affectedOrderIds: orderIds(row.affected_order_ids),
    demandQty: number(row.demand_qty),
    shortageQty: number(row.shortage_qty),
    shippedQty: number(row.shipped_qty),
    affectedOrders: number(row.affected_orders)
  })
  return {
    baseInventory,
    branchInventory,
    customerInventory: [],
    customerPlanInventory: [],
    activeCustomerIds30d: [],
    baseCurrentOrders: rows.baseCurrentOrders.map(row => ({
      base: String(row.base_name),
      snapshotDate: date(row.snapshot_date),
      orderQty: nullable(row.order_qty),
      shortageQty: nullable(row.shortage_qty)
    })),
    branchOutbound,
    branchFulfillment: rows.branchFulfillment.map(row => ({
      branch: String(row.branch),
      snapshotDate: date(row.snapshot_date),
      orderQty: nullable(row.order_qty),
      shippedQty: nullable(row.shipped_qty)
    })),
    agingBatches: [
      ...rows.baseAge.map(row => ({
        snapshotDate: date(row.snapshot_date),
        layer: 'base' as const,
        objectName: String(row.object_name),
        category: String(row.category),
        sku: String(row.sku),
        batch: String(row.batch),
        qty: number(row.qty),
        ageDays: nullable(row.age_days),
        dailyVelocity: baseVelocity.get(`${row.object_name}\u0000${row.sku}`) ?? null,
        source: '基地库龄'
      })),
      ...zeroAgeBatches(rows.branchAge).map(row => ({
        snapshotDate: date(row.snapshot_date),
        layer: 'branch' as const,
        objectName: String(row.object_name),
        category: String(row.category),
        sku: String(row.sku),
        batch: String(row.batch),
        qty: number(row.qty),
        ageDays: nullable(row.age_days),
        dailyVelocity: branchVelocity.get(`${row.object_name}\u0000${row.sku}`) ?? null,
        source: '分仓批次'
      }))
    ],
    orders: rows.orders.map(mapOrder),
    orders7d: rows.orders7d.map(mapOrder),
    pendingOrders: rows.pending.map(row => ({
      snapshotDate: date(row.snapshot_date),
      shortageQty: nullable(row.shortage_qty),
      stageVerified: row.legacy_count != null && Number(row.legacy_count) === 0,
      branch: String(row.branch),
      sku: row.sku == null ? undefined : String(row.sku),
      demandQty: number(row.demand_qty),
      allocatedQty: number(row.allocated_qty),
      preparedQty: nullable(row.prepared_qty)
    })),
    inventoryTrend: rows.trend
      .filter(row => row.qty != null)
      .map(row => ({ snapshotDate: date(row.snapshot_date), layer: String(row.layer) as 'base' | 'branch', qty: number(row.qty) })),
    orderHistory: rows.orderHistory.map(row => ({
      snapshotDate: date(row.snapshot_date),
      month: String(row.month),
      pickupType: String(row.pickup_type) === 'factory' ? 'factory' : 'branch',
      orderQty: nullable(row.order_qty),
      demandQty: number(row.demand_qty),
      shortageQty: number(row.shortage_qty),
      shippedQty: number(row.shipped_qty),
      affectedOrders: number(row.affected_orders)
    })),
    agingHistory: rows.agingHistory.map(row => ({
      snapshotDate: date(row.snapshot_date),
      layer: String(row.layer) === 'base' ? ('base' as const) : ('branch' as const),
      averageAge: nullable(row.average_age)
    }))
  }
}
