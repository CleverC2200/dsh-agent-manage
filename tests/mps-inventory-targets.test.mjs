import test from 'node:test'
import assert from 'node:assert/strict'
import { inventoryTargetIndex } from '../src/mps-compute/inventory-targets.ts'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
const fact = (code, month, version, finalTarget, dailyDemand, extra = {}) => ({ base: '甲', code, month, version, finalTarget, dailyDemand, sourceRows: 1, ...extra })
const at = (code, month = '2026-11', base = '甲') => ({ code, month, base })

test('monthly inventory targets select one version per base and month without SKU, month or base fallback', () => {
  const source = [
    fact('A', '2026-11', '月初', 900, 10),
    fact('B', '2026-11', '月初', 300, 10),
    fact('A', '2026-11', '纠偏', 120, 10),
    fact('A', '2026-12', '滚动', 200, 10),
    fact('A', '2026-11', '月初', 80, 10, { base: '乙' })
  ]
  const resolve = inventoryTargetIndex(source)
  assert.equal(resolve(at('A')).days, 12)
  assert.equal(resolve(at('B')).days, null)
  assert.equal(resolve(at('B')).version, '纠偏')
  assert.equal(resolve(at('A', '2026-12')).days, 20)
  assert.equal(resolve(at('A', '2027-01')).days, null)
  assert.equal(resolve(at('A', '2026-11', '乙')).days, 8)
  assert.equal(inventoryTargetIndex(source, '月初')(at('B')).days, 30)
  assert.equal(inventoryTargetIndex(source, '滚动')(at('A')).days, null)
})

test('missing, zero denominators, duplicate records and failed reads never become valid source days', () => {
  const source = [
    fact('A', '2026-11', '纠偏', 0, 10),
    fact('B', '2026-11', '纠偏', 50, 0),
    fact('C', '2026-11', '纠偏', null, 10),
    fact('D', '2026-11', '纠偏', 50, 10, { sourceRows: 2 }),
    fact('E', '2026-11', '纠偏', 30, 10),
    fact('E', '2026-11', '纠偏', 30, 10)
  ]
  const resolve = inventoryTargetIndex(source)
  assert.equal(resolve(at('A')).days, 0)
  for (const code of ['B', 'C', 'D', 'E', 'missing']) assert.equal(resolve(at(code)).days, null)
  const failed = inventoryTargetIndex(source, 'auto', ['来源读取失败'])(at('A'))
  assert.equal(failed.days, null)
  assert.equal(failed.finalTarget, null)
  assert.deepEqual(failed.missing, ['来源读取失败'])
})

test('source days drive SKU inventory and production while base overrides and monthly minimum rules remain explicit', () => {
  const months = ['2026-11', '2026-12', '2027-01']
  const input = {
    context: { id: 'v', name: 'v', month: months[0] },
    products: [{ base: '甲', code: 'A', name: 'A', category: '汤圆', series: '系列', group: '组' }],
    categoryDemand: [...months, '2027-02'].map(month => ({ month, category: '汤圆', quantity: 310 })),
    report: months.map(month => ({ ...at('A', month), quantity: 310 })),
    history: months.map(month => ({ ...at('A', month), quantity: 310 })),
    sourceIssues: { report: [], history: [] },
    capacities: [],
    openingInventory: [{ base: '甲', code: 'A', quantity: 0 }],
    constraints: { safetyDays: [], rules: { local: [] } },
    inventoryTargets: months.map((month, i) => fact('A', month, i === 0 ? '纠偏' : '滚动', 100 + i * 100, 10))
  }
  let result = computeMpsWorkflow(input)
  assert.deepEqual(
    result.rows.map(row => row.safetyDays),
    [10, 20, 30]
  )
  assert.equal(result.rows[0].safetyDaysSource, 'source')
  assert.equal(result.rows[0].targetInventory, 100)
  assert.equal(result.rows[0].requiredProduction, 410)
  assert.equal(result.rows[1].openingInventory, 100)
  input.constraints.safetyDays = [{ base: '甲', days: 0 }]
  result = computeMpsWorkflow(input)
  assert.equal(result.rows[0].targetInventory, 0)
  assert.equal(result.rows[0].safetyDaysSource, 'manual')
  input.constraints.safetyDays = []
  input.constraints.rules.local = [{ id: 'min', description: '月库存下限', strength: '硬', from: '2026-11', until: '2026-11', effect: { kind: 'inventory-days', value: 15 } }]
  result = computeMpsWorkflow(input)
  assert.equal(result.rows[0].safetyDays, 15)
  assert.equal(result.rows[0].inventoryTarget.days, 10)
  assert.equal(result.rows[0].safetyDaysSource, 'rule')
  assert.equal(result.rows[1].safetyDays, 20)
})
