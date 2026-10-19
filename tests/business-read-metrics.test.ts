import { describe, expect, it } from 'vitest'
import { productionOutputMetric, productionOutputObservation } from '../src/aps-compute/production-output.js'
import { coveredStockComparison } from '../src/inventory-compute/covered-stock-comparison.js'
import { stockCoverageObservation } from '../src/aps-compute/classified-stock.js'

describe('governed business read metrics', () => {
  it('weights production quantities rather than averaging group percentages', () => {
    const rows = [
      { source_basis: 'MES_QUANTITY', records: 1, invalid: 0, planned: 10, actual: 10 },
      { source_basis: 'MES_QUANTITY', records: 9, invalid: 0, planned: 90, actual: 45 }
    ]
    expect(productionOutputMetric(rows).value).toBeCloseTo(55)
    expect(productionOutputMetric([{ ...rows[0], planned: 0 }]).value).toBeNull()
    expect(productionOutputMetric([{ ...rows[0], source_basis: 'FUTURE_PLAN' }]).value).toBeNull()
  })
  it('keeps incomplete production observations separate from the strict metric', () => {
    const rows = [{ source_basis: 'MES_QUANTITY', records: 3, valid_records: 2, invalid: 1, planned: null, actual: null, known_planned: 100, known_actual: 90 }]
    expect(productionOutputMetric(rows).value).toBeNull()
    expect(productionOutputObservation(rows)).toEqual({ value: 90, count: 2, total: 3, excluded: 1 })
    expect(productionOutputObservation([{ ...rows[0], valid_records: 4 }])).toBeNull()
  })
  it('uses a matched SKU cohort and keeps missing targets distinct from zero', () => {
    const result = coveredStockComparison([
      { inventory: 100, target: 80, demand: 10 },
      { inventory: 50, target: null, demand: 5 },
      { inventory: 0, target: 20, demand: 0 }
    ])
    expect(result).toMatchObject({ total: 3, gapCovered: 2, turnoverCovered: 2, gap: 0, turnover: 10, targetTurnover: 10, gapPartial: true, turnoverPartial: true })
    expect(coveredStockComparison([{ inventory: 0, target: 0, demand: 0 }]).turnover).toBeNull()
  })
  it('does not turn partial or rejected aggregate results into complete stock', () => {
    const data = {
      start: '2026-10-01',
      end: '2026-10-19',
      granularity: 'month',
      sections: [
        {
          id: 'stock',
          status: 'ready',
          rows: [{ base: 'A', records: 5, covered_shippable_count: 2, covered_shippable_quantity: 80, covered_shippable_demand: 10 }]
        }
      ]
    }
    expect(stockCoverageObservation(data)?.shippable).toEqual({ count: 2, total: 5, quantity: 80, demand: 10, days: 8 })
    expect(stockCoverageObservation(data, 'B')).toBeNull()
    expect(stockCoverageObservation({ ...data, sections: [{ ...data.sections[0], status: 'error' }] })).toBeNull()
  })
})
