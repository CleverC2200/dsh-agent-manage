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

test('有效大类调整向后传递年度分月环比，保留系统值并拒绝重复或负数', () => {
  const sample = fixture()
  sample.adjustments = [{ month: '2026-11', category: '汤圆', quantity: 200 }]
  const result = computeMpsCategoryDemand(sample)
  assert.deepEqual(
    result.rows.map(row => row.quantity),
    [125, 200, 300, 600]
  )
  assert.deepEqual(
    result.rows.map(row => row.systemQuantity),
    [125, 125, 187.5, 375]
  )
  assert.equal(result.rows[1].adjusted, true)
  sample.adjustments[0].quantity = -1
  assert.deepEqual(
    computeMpsCategoryDemand(sample).rows.map(row => row.quantity),
    [125, 125, 187.5, 375]
  )
  assert.match(computeMpsCategoryDemand(sample).adjustmentIssues.join(''), /调整/)
})

test('同比在最近三年中按有效年份等权平均，标明实际样本年份，其他系数不改口径', () => {
  for (const count of [3, 2, 1, 0]) {
    const sample = fixture()
    for (const row of sample.historical) {
      if (!row.month.endsWith('-10')) continue
      const index = Number(row.month.slice(0, 4)) - 2023
      row.quantity = (index + 1) * 100
      row.priorYearQuantity = index < 3 - count ? null : 100
    }
    const row = computeMpsCategoryDemand(sample).historical.find(row => row.month === '2026-10')
    assert.equal(row.yoy, [null, 3, 2.5, 2][count])
    assert.equal(row.yoyYears.length, count)
    assert.equal(row.mom, 2)
    assert.equal(row.share, 1 / 6)
  }
})

test('同比零分母和无效年度跳过，真实零分子仍参与平均', () => {
  const sample = fixture()
  const year = sample.historical.find(row => row.month === '2023-10')
  year.quantity = 0
  const factors = () => computeMpsCategoryDemand(sample).historical.find(row => row.month === '2026-10')
  assert.equal(factors().yoy, 2 / 3)
  assert.equal(factors().yoyYears.length, 3)
  year.priorYearQuantity = 0
  assert.equal(factors().yoy, 1)
  assert.deepEqual(factors().yoyYears, ['2025-10', '2024-10'])
  year.priorYearQuantity = 100
  year.valid = false
  assert.equal(factors().yoy, 1)
  assert.equal(factors().mom, null)
  assert.equal(factors().share, null)
})

test('同比给出两端年月、数量和排除原因，三组全部有效才齐备', () => {
  const sample = fixture()
  sample.historical.find(row => row.month === '2023-10').priorYearQuantity = 0
  sample.historical.find(row => row.month === '2024-10').quantity = null
  const factors = computeMpsCategoryDemand(sample).historical.find(row => row.month === '2026-10')
  assert.equal(factors.yoyValidCount, 1)
  assert.equal(factors.yoyComplete, false)
  assert.deepEqual(
    factors.years.map(row => [row.numeratorMonth, row.denominatorMonth]),
    [
      ['2025-10', '2024-10'],
      ['2024-10', '2023-10'],
      ['2023-10', '2022-10']
    ]
  )
  assert.equal(factors.years[0].ratio, 1)
  assert.equal(factors.years[0].valid, true)
  assert.deepEqual(factors.years[0].excludedReasons, [])
  assert.match(factors.years[1].excludedReasons.join(''), /分子/)
  assert.match(factors.years[2].excludedReasons.join(''), /分母.*0/)
})
