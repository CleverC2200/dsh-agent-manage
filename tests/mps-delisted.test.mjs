import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
import { solveMpsPlan } from '../src/mps-compute/plan.ts'

const input = () => ({
  context: { id: 'delisted-v1', name: '下市品验收', month: '2026-11' },
  products: [{ base: '甲', code: 'A', name: '下市A', category: '点心', group: '组', series: '系列' }],
  categoryDemand: ['2026-11', '2026-12', '2027-01', '2027-02'].map(month => ({ month, category: '点心', quantity: 0 })),
  report: [{ month: '2026-11', base: '甲', code: 'A', quantity: 1 }],
  history: [{ month: '2026-11', base: '甲', code: 'A', quantity: 1 }],
  sourceIssues: { report: [], history: [] },
  openingInventory: [{ base: '甲', code: 'A', quantity: 50 }],
  capacities: [],
  constraints: { safetyDays: [], rules: {} },
  delistedProducts: [{ base: '甲', code: 'A', dailyShipment: 2 }]
})

test('下市品从评估当月停止自动新增需求与补货，缺周转及产能不阻断库存滚动', () => {
  for (const calculate of [computeMpsWorkflow, solveMpsPlan]) {
    const sample = input()
    const before = globalThis.structuredClone(sample)
    const result = calculate(sample)
    assert.deepEqual(
      result.rows.map(row => row.demand),
      [0, 0, 0]
    )
    assert.ok(result.rows.every(row => row.systemDemand === 0 && row.requiredProduction === 0))
    assert.equal(result.rows[0].openingInventory, 50)
    assert.equal(result.rows[0].projectedClosing, 50)
    if (calculate === solveMpsPlan) assert.ok(result.rows.every(row => row.mainPlan === 0 && !row.planMissing.length))
    assert.deepEqual(sample, before)
  }
})

test('当月沿用原拆分发货参考，后续直接日均乘自然日限库存，已有入库在途调拨继续入账', () => {
  const sample = input()
  sample.categoryDemand.forEach(row => {
    row.quantity = 10
  })
  sample.inventoryMovements = [
    { month: '2026-11', base: '甲', code: 'A', productionInbound: 10, inTransitInbound: 5, transferIn: 5, transferOut: 10 },
    { month: '2026-12', base: '甲', code: 'A', productionInbound: 5, inTransitInbound: 0, transferIn: 0, transferOut: 5 },
    { month: '2027-01', base: '甲', code: 'A', productionInbound: 0, inTransitInbound: 10, transferIn: 5, transferOut: 0 }
  ]
  for (const calculate of [computeMpsWorkflow, solveMpsPlan]) {
    const rows = calculate(sample).rows
    assert.deepEqual(
      rows.map(row => row.expectedShipment),
      [10, 50, 15]
    )
    assert.deepEqual(
      rows.map(row => row.openingInventory),
      [50, 50, 0]
    )
    assert.deepEqual(
      rows.map(row => row.projectedClosing),
      [50, 0, 0]
    )
    assert.deepEqual(
      rows.map(row => row.requiredProduction),
      [0, 0, 0]
    )
    assert.equal(rows[1].dailyShipment, 2)
    if (calculate === solveMpsPlan) {
      assert.deepEqual(
        rows.map(row => row.mainPlan),
        [0, 0, 0]
      )
      assert.deepEqual(
        rows.map(row => row.transferIn),
        [5, 0, 5]
      )
      assert.deepEqual(
        rows.map(row => row.transferOut),
        [10, 5, 0]
      )
    }
  }
})

test('下市品日均缺失仅计算补0，缺库存或当月发货依据仍待补', () => {
  const sample = input()
  sample.delistedProducts[0] = { base: '甲', code: 'A', dailyShipment: null, dailyShipmentIssue: '库存日报读取失败：访问拒绝' }
  sample.categoryDemand.forEach(row => {
    row.quantity = 10
  })
  for (const calculate of [computeMpsWorkflow, solveMpsPlan]) {
    const result = calculate(sample)
    assert.deepEqual(
      result.rows.map(row => row.projectedClosing),
      [40, 40, 40]
    )
    assert.equal(result.rows[1].dailyShipment, null)
    assert.equal(result.rows[1].dailyShipmentCalculation, 0)
    assert.match(result.rows[1].dailyShipmentIssue, /读取失败/)
    const missingStock = globalThis.structuredClone(sample)
    missingStock.openingInventory[0].quantity = null
    assert.ok(calculate(missingStock).rows.every(row => row.projectedClosing === null))
    const missingReference = globalThis.structuredClone(sample)
    missingReference.categoryDemand.forEach(row => {
      row.quantity = null
    })
    assert.equal(calculate(missingReference).rows[0].projectedClosing, null)
  }
})

test('下市基地SKU也不为其他基地自动新增生产，其他基地的有效需求保留缺口', () => {
  const sample = input()
  sample.products.push({ ...sample.products[0], base: '乙' })
  sample.report.push({ month: '2026-11', base: '乙', code: 'A', quantity: 1 })
  sample.history.push({ month: '2026-11', base: '乙', code: 'A', quantity: 1 })
  sample.categoryDemand.forEach(row => {
    row.quantity = 100
  })
  sample.openingInventory.push({ base: '乙', code: 'A', quantity: 0 })
  sample.constraints.safetyDays = [
    { base: '甲', days: 0 },
    { base: '乙', days: 0 }
  ]
  sample.unitWeights = [
    { base: '甲', code: 'A', tonsPerPiece: 1 },
    { base: '乙', code: 'A', tonsPerPiece: 1 }
  ]
  sample.resources = [{ id: 'R', base: '甲', kind: 'tunnel', name: '下市品旧产线', dailyTons: 10 }]
  sample.productionDays = sample.categoryDemand.map(row => ({ base: '甲', month: row.month, days: 25 }))
  sample.planCandidates = [{ base: '甲', code: 'A', resourceId: 'R' }]
  sample.transferRoutes = [{ from: '甲', to: '乙', code: 'A' }]
  const result = solveMpsPlan(sample)
  assert.equal(result.allocations.length, 0)
  assert.ok(result.rows.filter(row => row.base === '乙').every(row => row.planMissing.some(reason => /供应基地SKU已下市/.test(reason))))
  assert.ok(result.rows.filter(row => row.base === '乙').every(row => row.demand === 50))
})

test('后续自然月用库存来源日均2而非当月发货参考10推导日均', () => {
  const sample = input()
  sample.openingInventory[0].quantity = 300
  sample.categoryDemand.forEach(row => {
    row.quantity = 10
  })
  for (const calculate of [computeMpsWorkflow, solveMpsPlan]) {
    const rows = calculate(sample).rows
    assert.deepEqual(
      rows.map(row => row.expectedShipment),
      [10, 62, 62]
    )
    assert.deepEqual(
      rows.map(row => row.projectedClosing),
      [290, 228, 166]
    )
  }
})
