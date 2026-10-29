import { describe, expect, it } from 'vitest'
import { createMetricReader, comparisonValues } from '../src/aps-compute/adapter.js'
import type { MetricData } from '../src/aps-compute/metrics.js'

describe('immutable period metrics reuse', () => {
  it('does not rescan current rows when only a comparison snapshot changes', () => {
    let scans = 0
    const rows = [{ base: 'A', category: '甲', inventory: 10000, demand: 100, records: 1 }]
    const current: MetricData = {
      start: '2026-10-01',
      end: '2026-10-29',
      granularity: 'month',
      sections: [
        {
          id: 'stock',
          status: 'ready',
          get rows() {
            scans++
            return rows
          }
        }
      ]
    }
    const first = createMetricReader(current)({ base: 'A' })
    const before = scans
    const previous: MetricData = { ...current, sections: [{ id: 'stock', status: 'ready', rows: [{ ...rows[0], inventory: 5000 }] }] }
    const next = createMetricReader(current, previous)({ base: 'A' })
    expect(scans).toBe(before)
    expect(next.__comparison['库存量'].previous).toBe(0.5)
    expect(Number.isNaN(first.__comparison['库存量'].previous)).toBe(true)
    expect(next.__comparison).toEqual(comparisonValues(current, previous, null, { base: 'A' }))
    const fresh: MetricData = { ...current, sections: [{ id: 'stock', status: 'ready', rows: [{ ...rows[0], inventory: 20000 }] }] }
    expect(createMetricReader(fresh)({ base: 'A' })['库存量']).toBe(2)
    expect(Number.isNaN(createMetricReader(null)({ base: 'A' })['库存量'])).toBe(true)
    expect(Number.isNaN(createMetricReader(current)({ base: 'B' })['库存量'])).toBe(true)
  })
})
