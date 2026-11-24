import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
import { solveMpsPlan } from '../src/mps-compute/plan.ts'
import { confirmNoExistingInventoryMovements } from './helpers/confirmed-inventory.mjs'

const input = () =>
  confirmNoExistingInventoryMovements({
    context: { id: 'v5-inventory', name: '库存收支', month: '2026-12' },
    products: [{ base: '甲', code: 'A', name: 'A', category: '点心', group: '组', series: '系列' }],
    categoryDemand: ['2026-12', '2027-01', '2027-02', '2027-03'].map(month => ({ month, category: '点心', quantity: 0 })),
    report: [],
    history: [],
    sourceIssues: { report: [], history: [] },
    openingInventory: [{ base: '甲', code: 'A', quantity: 500 }],
    capacities: [],
    constraints: { safetyDays: [{ base: '甲', days: 0 }], rules: {} }
  })

test('同一评估已确认无进出时，需求参考与实际计划逐月保留500期末库存', () => {
  const sample = input()
  for (const result of [computeMpsWorkflow(sample), solveMpsPlan(sample)]) {
    assert.deepEqual(
      result.rows.map(row => [row.openingInventory, row.requiredProduction, row.expectedShipment, row.projectedClosing]),
      [
        [500, 0, 0, 500],
        [500, 0, 0, 500],
        [500, 0, 0, 500]
      ]
    )
    if ('status' in result)
      assert.deepEqual(
        result.rows.map(row => row.closingInventory),
        [500, 500, 500]
      )
  }
})

test('既有生产入库在途和双向调拨逐列入账，未知库存移动继续阻断结存', () => {
  const sample = input()
  Object.assign(sample.inventoryMovements[0], { productionInbound: 20, inTransitInbound: 15, transferIn: 7, transferOut: 2 })
  Object.assign(sample.inventoryMovements[1], { productionInbound: 5, inTransitInbound: 0, transferIn: 0, transferOut: 10 })
  for (const calculate of [computeMpsWorkflow, solveMpsPlan]) {
    const rows = calculate(sample).rows
    assert.deepEqual(
      rows.map(row => [row.openingInventory, row.existingProductionInbound, row.existingInTransitInbound, row.existingTransferIn, row.existingTransferOut, row.projectedClosing]),
      [
        [500, 20, 15, 7, 2, 540],
        [540, 5, 0, 0, 10, 535],
        [535, 0, 0, 0, 0, 535]
      ]
    )
    const unknown = globalThis.structuredClone(sample)
    unknown.inventoryMovements[0].inTransitInbound = null
    const failed = calculate(unknown).rows
    assert.ok(
      failed.every(row => row.projectedClosing === null),
      JSON.stringify(failed.map(row => ({ month: row.month, projectedClosing: row.projectedClosing })))
    )
  }
})
