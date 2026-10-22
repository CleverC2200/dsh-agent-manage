import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'

const input = () => ({
  context: { id: 'v1', name: '试算', month: '2026-12' },
  products: [
    { base: '甲', code: 'A', name: '甲产品', category: '点心', group: '包点', series: '系列一' },
    { base: '乙', code: 'B', name: '乙产品', category: '点心', group: '包点', series: '系列一' }
  ],
  categoryDemand: [{ month: '2026-12', category: '点心', quantity: 120 }],
  report: [
    { month: '2026-12', base: '甲', code: 'A', quantity: 30 },
    { month: '2026-12', base: '乙', code: 'B', quantity: 70 }
  ],
  history: [
    { month: '2025-12', base: '甲', code: 'A', quantity: 60 },
    { month: '2025-12', base: '乙', code: 'B', quantity: 40 }
  ],
  sourceIssues: { report: [], history: [] },
  openingInventory: [{ base: '甲', code: 'A', quantity: 0 }],
  capacities: [],
  constraints: { safetyDays: [], rules: {} }
})

test('两套占比平均拆分使用同月大类需求并保留四月大类', () => {
  const result = computeMpsWorkflow(input())
  assert.deepEqual(result.months, ['2026-12', '2027-01', '2027-02', '2027-03'])
  assert.equal(result.shipmentMonth, '2026-11')
  const rows = result.rows.filter(row => row.month === '2026-12')
  assert.ok(Math.abs(rows[0].demand - 54) < 1e-12)
  assert.ok(Math.abs(rows[1].demand - 66) < 1e-12)
  assert.equal(
    rows.reduce((sum, row) => sum + row.demand, 0),
    120
  )
  assert.ok(Math.abs(rows[0].share - 0.45) < 1e-12)
  assert.ok(Math.abs(rows[1].share - 0.55) < 1e-12)
  assert.equal(
    result.rows.some(row => row.month === '2027-03'),
    false
  )
  assert.equal(result.categoryRows.find(row => row.month === '2027-03').quantity, null)
  assert.equal(rows[0].openingInventory, 0)
})

test('缺产品与模型不抹去显式大类需求，缺大数不抹去有效拆分系数', () => {
  const withoutProducts = input()
  withoutProducts.products = []
  assert.equal(computeMpsWorkflow(withoutProducts).categoryRows.find(row => row.category === '点心').quantity, 120)
  const withoutDemand = input()
  withoutDemand.categoryDemand = []
  const row = computeMpsWorkflow(withoutDemand).rows[0]
  assert.equal(row.demand, null)
  assert.ok(Math.abs(row.share - 0.45) < 1e-12)
  assert.match(row.missing.demand.join(''), /缺大类需求/)
})

test('真实0保留，缺行或零分母不补0，不影响独立源产能', () => {
  const zero = input()
  zero.categoryDemand[0].quantity = 0
  zero.report[0].quantity = 0
  zero.history[0].quantity = 0
  const rows = computeMpsWorkflow(zero).rows
  assert.equal(rows[0].reportQuantity, 0)
  assert.equal(rows[0].historyQuantity, 0)
  assert.equal(rows[0].share, 0)
  assert.equal(rows[0].demand, 0)
  assert.equal(rows[1].demand, 0)
  const absent = input()
  absent.history.pop()
  absent.capacities = [{ base: '甲', code: 'A', line: '一线', dailyPieces: 0, dailyTons: 10, missing: [] }]
  const limited = computeMpsWorkflow(absent).rows[0]
  assert.equal(limited.historyShare, null)
  assert.equal(limited.demand, null)
  assert.equal(limited.reportShare, 0.3)
  assert.equal(limited.capacities[0].dailyPieces, 0)
  assert.equal(limited.monthlyCapacity, null)
  const denominator = input()
  denominator.history.forEach(row => {
    row.quantity = 0
  })
  assert.match(computeMpsWorkflow(denominator).rows[0].missing.historyShare.join(''), /合计为0/)
})

test('拆分范围漏掉源记录或产品键重复时拒绝缩小分母', () => {
  const unmatched = input()
  unmatched.report.push({ month: '2026-12', base: '丙', code: 'C', quantity: 100 })
  assert.equal(computeMpsWorkflow(unmatched).rows[0].reportShare, null)
  const duplicate = input()
  duplicate.products.push({ ...duplicate.products[0] })
  assert.match(computeMpsWorkflow(duplicate).rows[0].missing.demand.join(''), /重复/)
})

test('预计结存允许负数，待定规则仍不生成主计划和缺口', () => {
  const sample = input()
  sample.openingInventory[0].quantity = -5
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.constraints.rules = { local: [{ description: '只作核对', strength: '硬' }] }
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows[0].openingInventory, -5)
  assert.equal(result.rows[0].safetyDays, 0)
  for (const field of ['targetInventory', 'mainPlan', 'gap', 'load', 'transfer']) assert.equal(result.rows[0][field], null)
  assert.deepEqual(result.constraints.rules, sample.constraints.rules)
})

test('真实空产品与无显式大数仍保留八大类四个月缺项', () => {
  const sample = input()
  sample.products = []
  sample.categoryDemand = []
  const result = computeMpsWorkflow(sample)
  assert.equal(result.categoryRows.length, 32)
  assert.equal(
    result.categoryRows.every(row => row.quantity === null),
    true
  )
  assert.deepEqual(
    result.categoryRows.filter(row => row.month === '2026-12').map(row => row.category),
    ['饺子', '调理肉制品', '汤圆', '面点', '休闲', '馄饨', '粽子', '饼类']
  )
})

test('浮点尾差对平不把真实零权重变成非零需求', () => {
  const sample = input()
  sample.categoryDemand[0].quantity = 100
  sample.products = ['A', 'B', 'C', 'D'].map(code => ({ base: '甲', code, name: code, category: '点心', group: '包点', series: '系列' }))
  sample.report = sample.products.map((row, index) => ({ month: '2026-12', base: row.base, code: row.code, quantity: index === 3 ? 0 : 1 }))
  sample.history = sample.report.map(row => ({ ...row, month: '2025-12' }))
  const rows = computeMpsWorkflow(sample).rows.filter(row => row.month === '2026-12')
  assert.equal(rows[3].demand, 0)
  assert.equal(
    rows.reduce((sum, row) => sum + row.demand, 0),
    100
  )
})
