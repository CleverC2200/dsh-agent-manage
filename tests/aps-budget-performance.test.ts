import { describe, expect, it } from 'vitest'
import { budgetPerformanceObservation } from '../src/aps-compute/budget-performance.js'
import { deriveMetrics, type MetricData } from '../src/aps-compute/metrics.js'
const row = {
  source_basis: 'MONTHLY_BUDGET_UNTAXED_INCOME',
  month: '202610',
  budget_keys: 10,
  income_keys: 8,
  matched_keys: 6,
  matched_budget: 100,
  matched_income: 80,
  budget_date: '2026-10-20',
  source_date: '20261019',
  invalid: 2,
  actual: null,
  budget: null
}
const data = (rows = [row]): MetricData => ({
  start: '2026-10-01',
  end: '2026-10-20',
  granularity: 'month',
  sections: [
    { id: 'finance', status: 'ready', rows },
    { id: 'sales-budget', status: 'ready', rows }
  ]
})
describe('customer-SKU budget observation', () => {
  it('shows a labeled intersection without changing strict full-company metrics', () => {
    expect(budgetPerformanceObservation(data())).toMatchObject({ value: 80, matchedKeys: 6, budgetKeys: 10, expectedMonths: 1, monthCount: 1 })
    expect(deriveMetrics(data())['销售预算达成率'].value).toBeNull()
  })
  it('preserves zero and net return amounts, rejects zero budgets', () => {
    expect(budgetPerformanceObservation(data([{ ...row, matched_income: 0 }]))?.value).toBe(0)
    expect(budgetPerformanceObservation(data([{ ...row, matched_income: -10 }]))?.value).toBe(-10)
    expect(budgetPerformanceObservation(data([{ ...row, matched_budget: 0 }]))).toBeNull()
  })
  it('does not allocate a company budget to a base or organization', () => {
    for (const scope of [{ base: '华东' }, { region: '华北' }, { category: '水饺' }]) expect(budgetPerformanceObservation(data(), scope)).toBeNull()
  })
  it('rejects denied, cropped, duplicate, impossible and future observations', () => {
    const denied = data()
    denied.sections[0].status = 'error'
    expect(budgetPerformanceObservation(denied)).toBeNull()
    expect(budgetPerformanceObservation(data([row, row]))).toBeNull()
    for (const patch of [
      { matched_income: null },
      { matched_keys: 11 },
      { budget_keys: -1 },
      { source_basis: 'other' },
      { source_date: '20261021' },
      { budget_date: '2026-11-01' },
      { month: '202609' }
    ])
      expect(budgetPerformanceObservation(data([{ ...row, ...patch } as typeof row]))).toBeNull()
  })
  it('annual observations average usable monthly rates and expose missing months', () => {
    const annual = data([
      { ...row, month: '202609', matched_income: 100, budget_date: '2026-09-30', source_date: '20260930' },
      { ...row, matched_budget: 300, matched_income: 150 }
    ])
    annual.start = '2026-01-01'
    annual.granularity = 'year'
    expect(budgetPerformanceObservation(annual)).toMatchObject({ value: 75, monthCount: 2, expectedMonths: 10, matchedBudget: 400, matchedIncome: 250 })
  })
})
