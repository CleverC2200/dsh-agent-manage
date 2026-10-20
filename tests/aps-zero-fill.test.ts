import { describe, expect, it } from 'vitest'
import { deriveMetrics, type MetricData } from '../src/aps-compute/metrics.js'
import { productionOutputMetric } from '../src/aps-compute/production-output.js'

const data = (sections: MetricData['sections']): MetricData => ({ start: '2026-10-01', end: '2026-10-20', granularity: 'month', missingValuePolicy: 'zero', sections })
const section = (id: string, rows: Record<string, unknown>[]) => ({ id, status: 'ready', rows })
describe('APS configured zero-fill policy', () => {
  it('sums each quantity independently, keeping values from incomplete rows', () => {
    const result = deriveMetrics(
      data([
        section('stock', [
          { inventory: 100, demand: null, missing_demand: 1 },
          { inventory: null, demand: 10 }
        ]),
        section('shippable', [
          { available: 80, demand: null, invalid: 1 },
          { available: null, demand: 10 }
        ]),
        section('orders', [
          { demand: 100, shortage: null, invalid: 1 },
          { demand: null, shortage: 20 }
        ])
      ])
    )
    expect(result['库存量'].value).toBe(0.01)
    expect(result['计划库存支撑天数'].value).toBe(10)
    expect(result['可发货天数'].value).toBe(8)
    expect(result['订单满足率'].value).toBe(80)
  })
  it('keeps production planned and actual totals rather than their complete-row intersection', () => {
    const rows = [
      { source_basis: 'MES_QUANTITY', planned: 100, actual: null, invalid: 1 },
      { source_basis: 'MES_QUANTITY', planned: null, actual: 50, invalid: 1 }
    ]
    expect(productionOutputMetric(rows, 'zero').value).toBe(50)
    expect(productionOutputMetric(rows).value).toBeNull()
    expect(productionOutputMetric([{ ...rows[0], planned: 0 }], 'zero').value).toBeNull()
  })
  it('uses independent income and budget totals despite missing data flags', () => {
    const metrics = deriveMetrics(
      data([
        section('finance', [
          { month: '202610', actual: 50, invalid: 1 },
          { month: '202610', actual: null }
        ]),
        section('sales-budget', [
          { month: '202610', budget: null, invalid: 1 },
          { month: '202610', budget: 100 }
        ])
      ])
    )
    expect(metrics['销售预算达成率'].value).toBe(50)
    expect(metrics['销售预算达成率'].note).toContain('缺失数值按0')
  })
  it('does not convert query failures, loading, or invalid numbers into zero', () => {
    for (const status of ['error', 'loading']) {
      expect(deriveMetrics(data([{ id: 'stock', status, rows: [{ inventory: 100 }] }]))['库存量'].value).toBeNull()
    }
    expect(deriveMetrics(data([section('stock', [{ inventory: NaN }])]))['库存量'].value).toBeNull()
    expect(deriveMetrics(data([{ id: 'stock', status: 'empty', rows: [] }]))['库存量'].value).toBe(0)
  })
  it('keeps zero denominators undefined and zero numerators valid', () => {
    const metrics = deriveMetrics(
      data([
        section('shippable', [{ available: 100, demand: null }]),
        section('sales-budget', [{ month: '202610', budget: 100 }]),
        section('finance', [{ month: '202610', actual: null }]),
        section('demand-accuracy', [{ month: '202610', initial_plan: 100, adjusted_plan: 0, actual: 10, initial_deviation: 90, adjusted_deviation: 10 }])
      ])
    )
    expect(metrics['可发货天数'].value).toBeNull()
    expect(metrics['销售预算达成率'].value).toBe(0)
    expect(metrics['需求预测准确率'].value).toBeNull()
    expect(metrics['需求预测达成率'].value).toBeNull()
  })
})
