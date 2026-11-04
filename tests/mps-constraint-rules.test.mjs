import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
const months = ['2026-12', '2027-01', '2027-02']
const sample = () => ({
  context: { id: 'rules', name: '规则验收', month: months[0] },
  products: [{ base: '甲', code: 'A', name: '产品A', category: '汤圆', group: '组', series: '系列' }],
  categoryDemand: [...months, '2027-03'].map(month => ({ month, category: '汤圆', quantity: 310 })),
  report: months.map(month => ({ month, base: '甲', code: 'A', quantity: 100 })),
  history: months.map(month => ({ month, base: '甲', code: 'A', quantity: 100 })),
  sourceIssues: { report: [], history: [] },
  openingInventory: [{ base: '甲', code: 'A', quantity: 0 }],
  capacities: [],
  constraints: { safetyDays: [{ base: '甲', days: 0 }], rules: { local: [] } },
  productionDays: months.map(month => ({ month, base: '甲', days: 25 })),
  unitWeights: [{ base: '甲', code: 'A', tonsPerPiece: 1 }],
  resources: [
    { id: 'T', base: '甲', kind: 'tunnel', name: '隧道', dailyTons: 20 },
    { id: 'F', base: '甲', kind: 'forming', name: '成型机', dailyTons: 20 }
  ],
  resourceAssignments: months.flatMap(month => ['T', 'F'].map(resourceId => ({ month, base: '甲', code: 'A', resourceId, share: 1 })))
})
const rule = (effect, extra = {}) => ({ id: 'R', description: '规则验证', strength: '硬', base: '甲', from: '2027-01', until: '2027-01', effect, ...extra })

test('inventory rules affect only their month and SKU, recompute production and carry closing stock; soft rules need adoption', () => {
  const input = sample()
  const original = structuredClone(input)
  input.constraints.rules.local = [rule({ kind: 'inventory-days', value: 12 }, { code: 'A' })]
  const result = computeMpsWorkflow(input)
  assert.equal(result.rows[0].requiredProduction, 310)
  assert.equal(result.rows[1].safetyDays, 12)
  assert.ok(Math.abs(result.rows[1].targetInventory - (310 * 12) / 28) < 1e-9)
  assert.equal(result.rows[2].openingInventory, result.rows[1].projectedClosing)
  assert.equal(result.rows[2].safetyDays, 0)
  assert.equal(result.ruleEvaluations.length, 1)
  assert.equal(result.ruleEvaluations[0].affected, 1)
  assert.equal(result.ruleEvaluations[0].status, 'applied')
  input.constraints.rules.local[0].strength = '软'
  assert.equal(computeMpsWorkflow(input).rows[1].safetyDays, 0)
  assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'warning')
  input.constraints.rules.local[0].accepted = true
  assert.equal(computeMpsWorkflow(input).rows[1].safetyDays, 12)
  input.constraints.rules.local[0].enabled = false
  assert.equal(computeMpsWorkflow(input).rows[1].safetyDays, 0)
  assert.deepEqual(input.constraints.safetyDays, original.constraints.safetyDays)
})

test('a stopped resource has zero capacity and a real gap only in its effective month, without removing demand or another resource', () => {
  const input = sample()
  input.constraints.rules.local = [rule({ kind: 'resource-unavailable', resourceId: 'T' })]
  const result = computeMpsWorkflow(input)
  const stopped = result.resourceLoads.find(row => row.resourceId === 'T' && row.month === '2027-01')
  assert.equal(stopped.dailyTons, 0)
  assert.equal(stopped.gapTons, 310)
  assert.equal(stopped.status, 'overload')
  assert.equal(result.resourceLoads.find(row => row.resourceId === 'T' && row.month === '2026-12').gapTons, 0)
  assert.equal(result.resourceLoads.find(row => row.resourceId === 'F' && row.month === '2027-01').dailyTons, 20)
  assert.equal(result.rows[1].demand, 310)
  assert.equal(result.ruleEvaluations[0].status, 'conflict')
  assert.equal(result.summary.evaluatedRows, 2)
})

test('production-day limits constrain known calendars, preserve unknown calendars and retain resulting capacity gaps', () => {
  const input = sample()
  input.constraints.rules.local = [rule({ kind: 'production-days', value: 5 })]
  const result = computeMpsWorkflow(input)
  assert.equal(result.rows[0].productionDays, 25)
  assert.equal(result.rows[1].productionDays, 5)
  assert.equal(result.resourceLoads.find(row => row.month === '2027-01').gapTons, 210)
  assert.equal(result.ruleEvaluations[0].status, 'conflict')
  input.productionDays[1].days = null
  assert.equal(computeMpsWorkflow(input).rows[1].productionDays, null)
  assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'pending')
})

test('self-only policy detects insufficient self capacity; missing transfer, cost and delivery evidence blocks a false pass', () => {
  const input = sample()
  input.productionDays[1].days = 1
  input.constraints.rules.local = [rule({ kind: 'self-only' })]
  assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'conflict')
  for (const kind of ['transfer-limit', 'cost-limit', 'lead-days']) {
    input.constraints.rules.local = [rule({ kind, value: 10 })]
    const result = computeMpsWorkflow(input)
    assert.equal(result.ruleEvaluations[0].status, 'pending')
    assert.equal(result.summary.evaluatedRows, 2)
    assert.match(result.rows[1].missing.mainPlan.join(''), /规则验证/)
  }
})

test('disabled, expired, duplicate and unstructured rules never silently affect computation', () => {
  const input = sample()
  input.constraints.rules.local = [rule({ kind: 'inventory-days', value: 30 }), rule({ kind: 'inventory-days', value: 5 })]
  const duplicate = computeMpsWorkflow(input)
  assert.equal(duplicate.rows[1].safetyDays, 0)
  assert.ok(duplicate.ruleEvaluations.every(row => row.status === 'draft'))
  input.constraints.rules.local = [rule({ kind: 'inventory-days', value: 30 }, { from: '2025-01', until: '2025-03' })]
  assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'expired')
  input.constraints.rules.local = [{ description: '自由文字停线', strength: '硬' }]
  assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'draft')
})

test('recorded monthly plan evidence is compared to transfer, cost and lead-time thresholds without reusing another month or missing sources', () => {
  for (const [kind, value, bad, good] of [
    ['transfer-limit', 400, 450, 380],
    ['cost-limit', 8, 9, 7],
    ['lead-days', 15, 10, 20]
  ]) {
    const input = sample()
    const current = rule({ kind, value })
    current.observations = [{ month: '2027-01', value: bad, source: '当前月方案核对' }]
    input.constraints.rules.local = [current]
    const failed = computeMpsWorkflow(input)
    assert.equal(failed.ruleEvaluations[0].status, 'conflict')
    current.observations[0].value = good
    assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'met')
    current.observations[0].month = '2026-12'
    assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'pending')
    current.observations[0].month = '2027-01'
    current.observations[0].source = ''
    assert.equal(computeMpsWorkflow(input).ruleEvaluations[0].status, 'pending')
  }
})
