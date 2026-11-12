import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsCategoryDemand } from '../src/mps-compute/category-demand.ts'
const fixture = (pull = 'monthly') => {
  const end = pull === 'monthly' ? 8 : 9
  return {
    month: '2026-10',
    pull,
    categories: ['汤圆'],
    shipment: [{ month: '2026-09', category: '汤圆', quantity: 100 }],
    submissions: ['2026-10', '2026-11'].map(month => ({ month, category: '汤圆', quantity: 150 })),
    historical: [2023, 2024, 2025].flatMap(year =>
      Array.from({ length: 8 }, (_, index) => ({
        month: new Date(Date.UTC(year, index + 5, 1)).toISOString().slice(0, 7),
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
test('only M+1 weights sales correction while all four months calculate both methods', () => {
  for (const pull of ['monthly', 'adjust']) {
    const result = computeMpsCategoryDemand(fixture(pull))
    assert.equal(result.bases[0].achievementRate, 0.8)
    assert.equal(result.bases[0].annualEstimate, 1200)
    assert.deepEqual(
      result.rows.map(row => row.quantity),
      [110, 100, 125, 200]
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
    [110, 100, null, null]
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

test('人工有效量不回流独立环比链，保留系统值并拒绝重复或负数', () => {
  const sample = fixture()
  sample.adjustments = [{ month: '2026-11', category: '汤圆', quantity: 200 }]
  const result = computeMpsCategoryDemand(sample)
  assert.deepEqual(
    result.rows.map(row => row.quantity),
    [110, 200, 125, 200]
  )
  assert.deepEqual(
    result.rows.map(row => row.systemQuantity),
    [110, 100, 125, 200]
  )
  assert.equal(result.rows[1].adjusted, true)
  sample.adjustments[0].quantity = -1
  assert.deepEqual(
    computeMpsCategoryDemand(sample).rows.map(row => row.quantity),
    [110, 100, 125, 200]
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

test('本月预估1200与占比1000先平均，再与1500提报的80%平均得到1150', () => {
  const input = fixture()
  input.shipment[0].quantity = 1200
  input.checks.forEach(row => {
    row.actual = 1000
    row.plan = 1250
  })
  input.submissions.forEach(row => (row.quantity = 1500))
  const result = computeMpsCategoryDemand(input)
  assert.equal(result.rows[0].momMethod, 1200)
  assert.equal(result.rows[0].shareMethod, 1000)
  assert.equal(result.rows[0].quantity, 1150)
  assert.deepEqual(
    result.rows.map(row => row.momMethod),
    [1200, 1200, 1800, 3600]
  )
  input.shipment[0].quantity = 600
  assert.equal(computeMpsCategoryDemand(input).rows[0].quantity, 1000)
})

test('历史环比逐月递推，来源缺项不污染独立链，真实零达成率保留为零', () => {
  const input = fixture()
  input.historical.forEach(row => {
    if (row.month.endsWith('-10')) row.priorMonthQuantity = 50
    if (row.month.endsWith('-11')) row.priorMonthQuantity = 25
  })
  input.adjustments = [{ month: '2026-10', category: '汤圆', quantity: 999 }]
  assert.deepEqual(
    computeMpsCategoryDemand(input).rows.map(row => row.momMethod),
    [200, 800, 1200, 2400]
  )
  input.submissions = []
  assert.deepEqual(
    computeMpsCategoryDemand(input).rows.map(row => row.quantity),
    [999, 450, 650, 1250]
  )
  input.shipment[0].month = '2026-10'
  assert.deepEqual(
    computeMpsCategoryDemand(input).rows.map(row => row.momMethod),
    [null, null, null, null]
  )
  const zero = fixture()
  zero.checks.forEach(row => (row.actual = 0))
  assert.equal(computeMpsCategoryDemand(zero).rows[0].quantity, 25)
  zero.shipment[0].quantity = 0
  assert.deepEqual(
    computeMpsCategoryDemand(zero).rows.map(row => row.quantity),
    [0, 0, 0, 0]
  )
})

test('missing sales submissions or allnum plans affect M+1 alone, while later historical shares remain required', () => {
  const input = fixture()
  input.submissions = []
  input.checks[0].complete = false
  let result = computeMpsCategoryDemand(input)
  assert.deepEqual(
    result.rows.map(row => row.quantity),
    [null, 100, 125, 200]
  )
  assert.deepEqual(
    result.rows.map(row => row.methodAverage),
    [100, 100, 125, 200]
  )
  assert.deepEqual(
    result.rows.map(row => row.weighted),
    [null, null, null, null]
  )
  assert.deepEqual(
    result.rows.map(row => row.salesCorrected),
    [null, null, null, null]
  )
  input.historical = input.historical.filter(row => row.month !== '2025-12')
  result = computeMpsCategoryDemand(input)
  assert.equal(result.rows[2].momMethod, 150)
  assert.equal(result.rows[2].shareMethod, null)
  assert.equal(result.rows[2].quantity, null)
  assert.equal(result.rows[3].quantity, 200)
})
