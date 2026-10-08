/** DMS mock packet calculation only. No credentials, connection or mutable simulator state. */
import { Decimal } from 'decimal.js'

export type DmsMockSku = {
  skuCode: string
  qty: string
  addQty: string
  cutQty: string
}
export type DmsMockPlan = {
  planId: string
  versionId: string
  typeCode: string
  orderType: 'M' | 'Z'
  status: number
  skus: DmsMockSku[]
}
export type DmsMockPacket = {
  key: string
  PLANE_NUM: string
  sourceVersionId: string
  planTypeCode: string
  orderType: 'M' | 'Z'
  operation: 'MONTHLY' | 'ADD' | 'CUT'
  items: Array<{ skuCode: string; qty: string }>
}
function quantity(value: string): string {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) throw new Error('MOCK_INVALID_QUANTITY')
  const number = new Decimal(value)
  if (!number.isFinite() || number.isNegative()) throw new Error('MOCK_INVALID_QUANTITY')
  return number.toFixed(3)
}

/** 构造 mock 报文；只有 PLANE_NUM 映射是已确认的外部字段名。
 * Caller owns terminal approval and workflow validation; this calculation owns quantities and keys.
 */
export function buildDmsMockPackets(plan: DmsMockPlan): DmsMockPacket[] {
  if (!plan.planId || !plan.versionId || !plan.typeCode) throw new Error('MOCK_INVALID_PLAN')
  if (!plan.skus.length || new Set(plan.skus.map(sku => sku.skuCode)).size !== plan.skus.length) throw new Error('MOCK_INVALID_SKUS')
  for (const sku of plan.skus) {
    if (!sku.skuCode) throw new Error('MOCK_INVALID_SKUS')
    quantity(sku.qty)
    quantity(sku.addQty)
    quantity(sku.cutQty)
    if (plan.orderType === 'M' && (!new Decimal(sku.addQty).isZero() || !new Decimal(sku.cutQty).isZero())) throw new Error('MOCK_MONTHLY_ADJUSTMENTS')
  }
  if (plan.orderType !== 'M' && plan.orderType !== 'Z') throw new Error('MOCK_INVALID_ORDER_TYPE')
  const operations = plan.orderType === 'M' ? (['MONTHLY'] as const) : (['ADD', 'CUT'] as const)
  return operations.map(operation => ({
    key: JSON.stringify([plan.planId, plan.versionId, plan.orderType, operation]),
    PLANE_NUM: plan.planId,
    sourceVersionId: plan.versionId,
    planTypeCode: plan.typeCode,
    orderType: plan.orderType,
    operation,
    items: plan.skus.map(sku => ({
      skuCode: sku.skuCode,
      qty: quantity(operation === 'MONTHLY' ? sku.qty : operation === 'ADD' ? sku.addQty : sku.cutQty)
    }))
  }))
}
