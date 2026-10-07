import { describe, expect, it } from 'vitest'
import { orderTotals, applicablePolicies } from '../src/inventory-compute/dealer-order.js'
import { summarize, type ObjectData } from '../src/inventory-compute/personal.js'
import { replenishmentFacts, suggestedStockQuantity, skuExpiryFacts } from '../src/inventory-compute/dealer-recommendation.js'

describe('public inventory calculators', () => {
  it('preserves proven zero, missing price, and verified policy scope', () => {
    expect(
      orderTotals([
        { quantity: 2, unitPrice: 0 },
        { quantity: 3, unitPrice: 4 }
      ])
    ).toEqual({ count: 2, quantity: 5, amount: 12 })
    expect(orderTotals([{ quantity: 2, unitPrice: null }]).amount).toBeNull()
    const now = new Date('2026-10-06T17:00:00Z')
    const policies = [{ customerCode: 'C', start: '2026-10-07', end: '2026-10-07', verifiedPickupCodes: ['P'], scopes: [{ productCode: 'S', pickupCode: 'P' }] }]
    expect(applicablePolicies(policies, 'C', 'S', 'P', now)).toEqual(policies)
    for (const [customer, sku, pickup] of [
      ['D', 'S', 'P'],
      ['C', 'X', 'P'],
      ['C', 'S', ''],
      ['C', 'S', 'X']
    ])
      expect(applicablePolicies(policies, customer, sku, pickup, now)).toEqual([])
    expect(applicablePolicies(policies, 'C', 'S', 'P', new Date('2026-10-07T16:00:00Z'))).toEqual([])
  })

  it('retains source-specific partial totals and weighted age without inventing missing facts', () => {
    const objects: ObjectData[] = [
      { id: 'a', name: 'a', kind: 'base', inventory: 100, target: 80, age: 40, ageWeight: 100, shortage: 0, stagnant: 20, over30: 60, snapshot: '', risks: [] },
      { id: 'b', name: 'b', kind: 'branch', inventory: 0, target: null, age: 80, ageWeight: 50, shortage: null, stagnant: 0, snapshot: '', risks: [] }
    ]
    const result = summarize(objects)
    expect(result).toEqual({
      inventory: 100,
      target: 80,
      gap: 20,
      age: 160 / 3,
      over30: 60,
      shortage: 0,
      stagnant: null,
      mixedStagnant: true,
      partial: { inventory: false, target: true, age: false, shortage: true, stagnant: false, over30: true, gap: true }
    })
    expect(summarize([]).inventory).toBeNull()
  })

  it('uses original 20-day target and expiry rules', () => {
    expect(suggestedStockQuantity(30, 20, 0)).toBe(10)
    expect(suggestedStockQuantity(null, 20, 0)).toBeNull()
    expect(replenishmentFacts(20, 5, 0, 60).quantity).toBe(25)
    expect(skuExpiryFacts(366, 10)).toEqual({ near: 0, expired: 10, remaining: -1 })
    expect(skuExpiryFacts(null, 10)).toEqual({ near: 0, expired: 0, remaining: null })
  })
})
