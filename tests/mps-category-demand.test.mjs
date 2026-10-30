import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsCategoryDemand } from '../src/mps-compute/category-demand.ts'
const fixture = (pull = 'monthly') => {
  const end = pull === 'monthly' ? 8 : 9
  return {
    month: '2026-10',
    pull,
    categories: ['汤圆'],
    historical: [2023, 2024, 2025].flatMap(year =>
      [6, 7, 8, 9, 10, 11].map(month => ({
        month: `${year}-${String(month).padStart(2, '0')}`,
        category: '汤圆',
        base: '华东',
        quantity: 100,
        priorYearQuantity: 100,
        priorMonthQuantity: 100,
        annualQuantity: 1200,
        fiscalYear: String(year),
        valid: true
      }))
    ),
    checks: [end - 2, end - 1, end].map(month => ({ month: `2026-${String(month).padStart(2, '0')}`, category: '汤圆', actual: 100, plan: 125, complete: true })),
    annual: [10, 11, 12, 1].map((month, index) => ({ month: month === 1 ? '2027-01' : `2026-${month}`, category: '汤圆', quantity: [100, 100, 150, 300][index] }))
  }
}
test('confirmed three-month windows produce both methods and extend M+3/M+4 by annual ratios', () => {
  for (const pull of ['monthly', 'adjust']) {
    const result = computeMpsCategoryDemand(fixture(pull))
    assert.equal(result.bases[0].achievementRate, 0.8)
    assert.equal(result.bases[0].annualEstimate, 1200)
    assert.deepEqual(
      result.rows.map(row => row.quantity),
      [125, 125, 187.5, 375]
    )
    assert.equal(result.rows[0].momMethod, 100)
    assert.equal(result.rows[0].shareMethod, 100)
  }
})
test('missing a historical year or zero denominators stop only dependent results, preserving real zeros', () => {
  const missing = fixture()
  missing.historical = missing.historical.filter(row => row.month !== '2024-10')
  assert.equal(computeMpsCategoryDemand(missing).rows[0].quantity, null)
  const zero = fixture()
  zero.checks.forEach(row => (row.plan = 0))
  assert.equal(computeMpsCategoryDemand(zero).bases[0].achievementRate, null)
  assert.equal(computeMpsCategoryDemand(zero).rows[0].quantity, null)
  const annual = fixture()
  annual.annual = annual.annual.filter(row => row.month !== '2026-12')
  assert.deepEqual(
    computeMpsCategoryDemand(annual).rows.map(row => row.quantity),
    [125, 125, null, null]
  )
  const noMix = fixture()
  noMix.checks[0].month = '2026-09'
  assert.equal(computeMpsCategoryDemand(noMix).rows[0].quantity, null)
})

test('incomplete DMS classification does not hide valid BI methods', () => {
  const input = fixture()
  input.checks[0].complete = false
  const result = computeMpsCategoryDemand(input)
  assert.equal(result.bases[0].annualEstimate, 1200)
  assert.equal(result.rows[0].momMethod, 100)
  assert.equal(result.rows[0].shareMethod, 100)
  assert.equal(result.rows[0].quantity, null)
})
