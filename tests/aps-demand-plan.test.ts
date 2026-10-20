import { describe, expect, it } from 'vitest'
import { deriveMetrics, type MetricData } from '../src/aps-compute/metrics.js'
import { metricValues } from '../src/aps-compute/adapter.js'

const fixture = (): MetricData => ({
  start: '2026-10-01',
  end: '2026-10-20',
  granularity: 'month',
  missingValuePolicy: 'zero',
  sections: [
    {
      id: 'demand-accuracy',
      status: 'ready',
      rows: [
        { month: '202610', base: 'A', category: '甲', initial_plan: 100, adjusted_plan: 0, actual: 80, initial_deviation: 40, adjusted_deviation: 80 },
        { month: '202610', base: 'B', category: '乙', initial_plan: 200, adjusted_plan: 0, actual: 100, initial_deviation: 100, adjusted_deviation: 100 }
      ]
    },
    {
      id: 'plans',
      status: 'ready',
      rows: [
        { month: '202610', base: 'A', category: null, demand_initial_plan: 100, demand_adjusted_plan: 120 },
        { month: '202610', base: 'B', category: null, demand_initial_plan: 200, demand_adjusted_plan: 240 },
        { month: '202610', base: null, category: null, demand_initial_plan: 0, demand_adjusted_plan: 0 }
      ]
    }
  ]
})
describe('demand attainment fallback from reconciled monthly base plans', () => {
  it('accepts the ISO date month returned by the configured GEA queries', () => {
    const data = fixture()
    data.sections.forEach(section =>
      section.rows.forEach(row => {
        row.month = '2026-10-01'
      })
    )
    expect(deriveMetrics(data)['需求预测达成率'].value).toBe(50)
  })
  it('uses separate aggregates for attainment only; does not invent SKU deviations', () => {
    const data = fixture(),
      metrics = deriveMetrics(data)
    expect(metrics['需求预测达成率'].value).toBe(50)
    expect(metrics['需求预测达成率'].detail).toContain('计划表纠偏需求')
    expect(metrics['需求预测准确率'].value).toBeNull()
    expect(metrics['需求预测准确率'].detail).toContain('月初阶段准确率 53.33%')
    expect(metricValues(data, { base: 'A' })['需求预测达成率']).toBeCloseTo((80 / 120) * 100)
    expect(metricValues(data, { category: '甲' })['需求预测达成率']).toBeNaN()
  })
  it('rejects mismatched bases even when company initial totals match', () => {
    const data = fixture()
    data.sections[1].rows[0].demand_initial_plan = 110
    data.sections[1].rows[1].demand_initial_plan = 190
    expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
  })
  it('rejects unavailable, denied, partially returned and nonmatching month sources', () => {
    for (const status of ['error', 'loading', 'empty']) {
      const data = fixture()
      data.sections[1].status = status
      expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
    }
    for (const patch of [{ demand_adjusted_plan: undefined }, { month: '202609' }, { demand_adjusted_plan: -1 }]) {
      const data = fixture()
      Object.assign(data.sections[1].rows[0], patch)
      expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
    }
    const data = fixture()
    data.sections[0].status = 'error'
    expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
  })
  it('keeps the authoritative adjusted plan when present and rejects undefined denominator', () => {
    const data = fixture()
    data.sections[0].rows[0].adjusted_plan = 200
    expect(deriveMetrics(data)['需求预测达成率'].value).toBe(90)
    data.sections[0].rows[0].adjusted_plan = 0
    data.sections[1].rows.forEach(row => {
      row.demand_adjusted_plan = 0
    })
    expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
  })
  it('does not silently extend fallback to annual periods or legacy policy', () => {
    const data = fixture()
    data.granularity = 'year'
    expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
    data.granularity = 'month'
    delete data.missingValuePolicy
    expect(deriveMetrics(data)['需求预测达成率'].value).toBeNull()
  })
})
