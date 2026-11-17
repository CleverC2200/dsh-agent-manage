import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
import { solveMpsPlan } from '../src/mps-compute/plan.ts'

const input = () => ({
  context: { id: 'stock-v1', name: '库存验收', month: '2026-11' },
  products: ['A', 'B'].map(code => ({ base: '甲', code, name: code, category: '点心', group: '组', series: '系列' })),
  categoryDemand: ['2026-11', '2026-12', '2027-01', '2027-02'].map(month => ({ month, category: '点心', quantity: 0 })),
  report: [],
  history: [],
  sourceIssues: { report: [], history: [] },
  openingInventory: [
    { base: '甲', code: 'A', quantity: -20 },
    { base: '甲', code: 'B', quantity: 100 }
  ],
  capacities: [],
  constraints: { safetyDays: [{ base: '甲', days: 0 }], rules: {} }
})

test('负期初逐SKU归0并承接，保留原值和待核原因，不借正库存抵消异常', () => {
  const sample = input()
  for (const result of [computeMpsWorkflow(sample), solveMpsPlan(sample)]) {
    const a = result.rows.filter(row => row.code === 'A')
    const b = result.rows.filter(row => row.code === 'B')
    assert.deepEqual(
      a.map(row => row.openingInventory),
      [0, 0, 0]
    )
    assert.equal(a[0].rawOpeningInventory, -20)
    assert.equal(a[0].requiredProduction, 0)
    assert.equal(a[0].inventoryIssues[0].rawValue, -20)
    assert.equal(a[0].inventoryIssues[0].calculationValue, 0)
    assert.match(a[0].inventoryIssues[0].reason, /待核/)
    assert.ok(b.every(row => row.openingInventory === 100))
    assert.equal(
      result.rows.filter(row => row.month === '2026-11').reduce((sum, row) => sum + row.openingInventory, 0),
      100
    )
  }
  assert.equal(sample.openingInventory[0].quantity, -20)
})

test('上一环节已归0的结存仍将原始负数传入期初报告', () => {
  const sample = input()
  sample.openingInventory[0] = { base: '甲', code: 'A', quantity: 0, rawQuantity: -20 }
  const row = computeMpsWorkflow(sample).rows[0]
  assert.equal(row.openingInventory, 0)
  assert.equal(row.rawOpeningInventory, -20)
  assert.equal(row.inventoryIssues[0].rawValue, -20)
})

test('负库存归0后仍保留产能不足形成的供需缺口', () => {
  const sample = input()
  sample.products = [sample.products[0]]
  sample.openingInventory = [sample.openingInventory[0]]
  sample.categoryDemand = sample.categoryDemand.map(row => ({ ...row, quantity: 100 }))
  sample.report = sample.categoryDemand.map(row => ({ month: row.month, base: '甲', code: 'A', quantity: 1 }))
  sample.history = structuredClone(sample.report)
  sample.resources = [{ id: 'R', base: '甲', kind: 'tunnel', name: '隧道', dailyTons: 1 }]
  sample.productionDays = sample.categoryDemand.map(row => ({ base: '甲', month: row.month, days: 25 }))
  sample.unitWeights = [{ base: '甲', code: 'A', tonsPerPiece: 1 }]
  sample.planCandidates = [{ base: '甲', code: 'A', resourceId: 'R' }]
  const result = solveMpsPlan(sample)
  assert.equal(result.rows[0].rawOpeningInventory, -20)
  assert.equal(result.rows[0].openingInventory, 0)
  assert.ok(
    result.rows.every(row => Math.abs(row.mainPlan - 25) < 1e-6 && Math.abs(row.unfulfilled - 75) < 1e-6 && row.closingInventory === 0),
    JSON.stringify(result.rows.map(({ mainPlan, unfulfilled, closingInventory, planMissing }) => ({ mainPlan, unfulfilled, closingInventory, planMissing })))
  )
})
