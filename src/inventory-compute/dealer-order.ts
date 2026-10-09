type PolicyPeriod = { start?: string; end?: string }
export type DealerPolicyScope = PolicyPeriod & { productCode: string; verifiedPickupCodes?: string[]; pickupCode?: string }
export type DealerPolicy = PolicyPeriod & { mock?: boolean; customerCode: string; verifiedPickupCodes?: string[]; scopes?: DealerPolicyScope[] }
export type DealerOrderRow = { quantity: number; unitPrice?: number | null }
/** Browser-only counterpart of the original commerce policy guard. No inferred discounts. */
export function applicablePolicies<T extends DealerPolicy>(policies: T[], customerCode: string, sku: string, pickupCode: string, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
  const active = (p: PolicyPeriod) => (!p.start || p.start <= date) && (!p.end || p.end >= date)
  return policies.filter(
    p =>
      !p.mock &&
      p.customerCode === customerCode &&
      active(p) &&
      pickupCode &&
      Array.isArray(p.verifiedPickupCodes) &&
      p.verifiedPickupCodes.includes(pickupCode) &&
      p.scopes?.some(
        (scope: DealerPolicyScope) =>
          scope.productCode === sku &&
          active(scope) &&
          (Array.isArray(scope.verifiedPickupCodes) ? scope.verifiedPickupCodes.includes(pickupCode) : scope.pickupCode === pickupCode)
      )
  )
}
export function orderTotals(rows: DealerOrderRow[]) {
  const quantity = rows.reduce((total, r) => total + (Number.isFinite(r.quantity) ? r.quantity : 0), 0)
  const priceComplete = rows.length > 0 && rows.every(r => typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice) && r.unitPrice >= 0)
  return {
    count: rows.length,
    quantity,
    amount: priceComplete ? rows.reduce((sum, r) => sum + r.unitPrice! * r.quantity, 0) : null
  }
}
