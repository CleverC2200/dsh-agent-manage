import { describe, expect, it } from 'vitest'
import { buildDmsMockPackets } from '../src/inventory-compute/dms-mock-packets.js'

describe('DMS mock supplied-input packet calculation', () => {
  it('keeps the original M quantity and two independent Z legs with their original keys', () => {
    const plan = { planId: 'mock-p', versionId: 'mock-v1', typeCode: 'Y', orderType: 'M' as const, status: 5, skus: [{ skuCode: 's', qty: '0.300', addQty: '0', cutQty: '0' }] }
    expect(buildDmsMockPackets(plan)).toEqual([
      {
        key: '["mock-p","mock-v1","M","MONTHLY"]',
        PLANE_NUM: 'mock-p',
        sourceVersionId: 'mock-v1',
        planTypeCode: 'Y',
        orderType: 'M',
        operation: 'MONTHLY',
        items: [{ skuCode: 's', qty: '0.300' }]
      }
    ])
    const packets = buildDmsMockPackets({ ...plan, orderType: 'Z', skus: [{ skuCode: 's', qty: '0.300', addQty: '2.500', cutQty: '1.250' }] })
    expect(packets.map(packet => [packet.key, packet.operation, packet.items[0].qty])).toEqual([
      ['["mock-p","mock-v1","Z","ADD"]', 'ADD', '2.500'],
      ['["mock-p","mock-v1","Z","CUT"]', 'CUT', '1.250']
    ])
    expect(buildDmsMockPackets({ ...plan, orderType: 'Z' }).map(packet => packet.items[0].qty)).toEqual(['0.000', '0.000'])
    expect(() => buildDmsMockPackets({ ...plan, skus: [{ ...plan.skus[0], qty: '1.0001' }] })).toThrow('MOCK_INVALID_QUANTITY')
  })
})
