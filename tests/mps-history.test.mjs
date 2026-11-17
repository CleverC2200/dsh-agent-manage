import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'

const sample = () => ({
  context: { id: 'history-v1', name: '历史核对', month: '2026-12' },
  products: [
    { base: '甲', code: 'A', name: 'A', category: '点心', group: '包点', series: '系列', historyCode: 'OLD', historyFactor: 2 },
    { base: '甲', code: 'B', name: 'B', category: '点心', group: '包点', series: '系列' }
  ],
  categoryDemand: [{ month: '2026-12', category: '点心', quantity: 120 }],
  report: [
    { month: '2026-12', base: '甲', code: 'A', quantity: 60 },
    { month: '2026-12', base: '甲', code: 'B', quantity: 60 }
  ],
  history: [
    { month: '2026-12', base: '甲', code: 'A', quantity: null },
    { month: '2026-12', base: '甲', code: 'OLD', quantity: 30 },
    { month: '2026-12', base: '甲', code: 'B', quantity: 40 }
  ],
  sourceIssues: { report: [], history: [] },
  openingInventory: [],
  capacities: [],
  constraints: { safetyDays: [], rules: {} }
})

test('历史缺失按用途补0，保留自身及替换品独立有效数量并用于占比和需求', () => {
  const input = sample()
  const raw = globalThis.structuredClone(input)
  const row = computeMpsWorkflow(input).rows[0]
  assert.equal(row.historyQuantity, 60)
  assert.equal(row.historyOwnQuantity, null)
  assert.equal(row.historyReferenceQuantity, 30)
  assert.equal(row.historyShare, 0.6)
  assert.equal(row.demand, 66)
  assert.equal(row.historyAudit.zeroFilled, true)
  assert.match(row.historyAudit.reasons.join('；'), /自身/)
  assert.deepEqual(input, raw)
})

const months = Array.from({ length: 24 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 10 - i, 1))
  return date.toISOString().slice(0, 7)
})
const evidence = value => months.map((month, i) => ({ month, status: 'ready', issues: [], rows: [{ month, base: '甲', code: 'A', quantity: value(i) }] }))

test('连续十二完整月无原始发货报告疑似新品并保留近二十四月核对依据', () => {
  const input = sample()
  input.products[0].historyCode = undefined
  input.historyPeriods = evidence(i => (i < 12 ? 0 : 9))
  const audit = computeMpsWorkflow(input).rows[0].historyAudit
  assert.equal(audit.classification, '疑似新品或重新上市')
  assert.equal(audit.months.length, 24)
  assert.equal(audit.months[0].month, '2026-11')
  assert.equal(audit.months[12].quantity, 9)
})

test('缺失或失败月份先报来源异常，不能用补0分类新品，最近一到两月断档另报', () => {
  const input = sample()
  input.products[0].historyCode = undefined
  input.historyPeriods = evidence(i => (i < 2 ? 0 : 9))
  assert.equal(computeMpsWorkflow(input).rows[0].historyAudit.classification, '短期断档数据异常')
  input.historyPeriods[0] = { month: months[0], status: 'failed', issues: ['源端拒绝'], rows: [] }
  let audit = computeMpsWorkflow(input).rows[0].historyAudit
  assert.equal(audit.classification, '来源异常或其他历史异常')
  assert.match(audit.months[0].reasons.join('；'), /源端拒绝/)
  input.historyPeriods = evidence(() => 0)
  input.historyPeriods.pop()
  audit = computeMpsWorkflow(input).rows[0].historyAudit
  assert.equal(audit.classification, '来源异常或其他历史异常')
  input.historyPeriods = evidence(() => 0)
  input.history = []
  const row = computeMpsWorkflow(input).rows[0]
  assert.equal(row.historyQuantity, 0)
  assert.equal(row.historyShare, null)
  assert.equal(row.demand, null)
  assert.match(row.missing.historyShare.join('；'), /合计为0/)
})

test('未来评估只使用实际已结束月份，月度来源无记录可确认零但部分读取仍待核', () => {
  const input = sample()
  input.context.month = '2027-01'
  input.historyAsOfMonth = '2026-11'
  input.historyPeriods = evidence(() => 0).filter(period => period.month <= '2026-10')
  input.historyPeriods.push({ month: '2024-11', status: 'ready', rows: [], issues: [] })
  const row = computeMpsWorkflow(input).rows[0]
  assert.equal(row.historyAudit.months[0].month, '2026-10')
  assert.equal(row.historyAudit.months[0].quantity, 0)
  assert.equal(row.historyAudit.classification, '疑似新品或重新上市')
  input.historyPeriods[0].status = 'partial'
  assert.equal(computeMpsWorkflow(input).rows[0].historyAudit.classification, '来源异常或其他历史异常')
})

test('同一历史分量部分无效仍保留可独立确认的数量，未知替换系数不补造', () => {
  const input = sample()
  input.history.push({ month: input.context.month, base: '甲', code: 'A', quantity: 20 })
  let row = computeMpsWorkflow(input).rows[0]
  assert.equal(row.historyOwnQuantity, null)
  assert.equal(row.historyOwnCalculationQuantity, 20)
  assert.equal(row.historyReferenceCalculationQuantity, 30)
  assert.equal(row.historyQuantity, 80)
  input.products[0].historyFactor = null
  row = computeMpsWorkflow(input).rows[0]
  assert.equal(row.historyOwnCalculationQuantity, 20)
  assert.equal(row.historyQuantity, null)
  assert.equal(row.historyShare, null)
})
