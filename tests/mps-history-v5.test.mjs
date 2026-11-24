import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'

const sample = () => ({
  context: { id: 'history-v5', name: '三月零发货', month: '2026-12' },
  products: [
    { base: '甲', code: 'A', name: 'A', category: '点心', group: '包点', series: '系列' },
    { base: '甲', code: 'B', name: 'B', category: '点心', group: '包点', series: '系列' },
    { base: '甲', code: 'C', name: 'C', category: '点心', group: '其他', series: '系列' }
  ],
  categoryDemand: [{ month: '2026-12', category: '点心', quantity: 200 }],
  report: ['A', 'B', 'C'].map((code, index) => ({ month: '2026-12', base: '甲', code, quantity: [60, 40, 100][index] })),
  history: ['A', 'B', 'C'].map((code, index) => ({ month: '2026-12', base: '甲', code, quantity: [60, 40, 100][index] })),
  historySourceStatus: 'ready',
  historyAsOfMonth: '2026-11',
  historyPeriods: ['2026-10', '2026-09', '2026-08'].map(month => ({
    month,
    status: 'ready',
    issues: [],
    rows: ['A', 'B', 'C'].map(code => ({ month, base: '甲', code, quantity: code === 'A' ? 0 : 1 }))
  })),
  sourceIssues: { report: [], history: [] },
  openingInventory: [],
  capacities: [],
  constraints: { safetyDays: [], rules: {} }
})
const december = input => computeMpsWorkflow(input).rows.filter(row => row.month === '2026-12')

test('最近三已结束月确认零发货只归零历史份额，物料组最大合格SKU承接同层差额', () => {
  const input = sample()
  const raw = structuredClone(input)
  const rows = december(input)
  const [a, b, c] = rows
  assert.deepEqual(
    rows.map(row => row.historyQuantity),
    [60, 40, 100]
  )
  assert.deepEqual(
    rows.map(row => row.reportShare),
    [0.3, 0.2, 0.5]
  )
  assert.deepEqual(
    rows.map(row => row.historyShare),
    [0, 0.5, 0.5]
  )
  assert.deepEqual(
    rows.map(row => row.demand),
    [30, 70, 100]
  )
  assert.equal(a.historyAudit.shareZeroed, true)
  assert.equal(a.historyAudit.months[0].month, '2026-10')
  assert.equal(b.historyLayers.groupShare, 0.5)
  assert.equal(b.historyLayers.skuShare, 1)
  assert.equal(b.historyLayers.baseShare, 1)
  assert.equal(c.historyLayers.groupShare, 0.5)
  assert.equal(
    rows.reduce((sum, row) => sum + row.historyShare, 0),
    1
  )
  assert.match(b.coefficientFallback.join('；'), /历史SKU.*承接.*0.6/)
  assert.deepEqual(input, raw)
})

test('整组都确认零发货且没有承接SKU时保留待核，不把总需求塞回已归零行', () => {
  const input = sample()
  input.historyPeriods.forEach(period =>
    period.rows.forEach(row => {
      row.quantity = 0
    })
  )
  const rows = december(input)
  assert.ok(rows.every(row => row.historyShare === 0))
  assert.ok(rows.every(row => row.demand === null && row.share === null))
  assert.ok(rows.every(row => row.missing.historyShare.some(reason => /没有合格/.test(reason))))
})

test('待承接SKU的三月发货数量不完整时，确认归零行保留零占比且组内差额待核', () => {
  const input = sample()
  input.historyPeriods[0].rows.find(row => row.code === 'B').quantity = null
  const [a, b, c] = december(input)
  assert.equal(a.historyShare, 0)
  assert.equal(b.historyShare, null)
  assert.equal(a.demand, null)
  assert.equal(b.demand, null)
  assert.equal(c.historyShare, 0.5)
})

test('同码其他基地按各自资格参与，已归零与下市基地不成为最大历史承接者', () => {
  const input = sample()
  input.products = [input.products[0], { ...input.products[0], base: '乙' }, input.products[1], { ...input.products[1], code: 'D' }]
  input.history = [
    ['甲', 'A', 60],
    ['乙', 'A', 10],
    ['甲', 'B', 30],
    ['甲', 'D', 900]
  ].map(([base, code, quantity]) => ({ month: '2026-12', base, code, quantity }))
  input.report = input.history.map(row => ({ ...row }))
  input.delistedProducts = [{ base: '甲', code: 'D', dailyShipment: 0 }]
  input.historyPeriods.forEach(period => {
    period.rows = [
      ['甲', 'A', 0],
      ['乙', 'A', 1],
      ['甲', 'B', 1],
      ['甲', 'D', 1]
    ].map(([base, code, quantity]) => ({ month: period.month, base, code, quantity }))
  })
  const rows = december(input)
  assert.deepEqual(
    rows.map(row => row.historyShare),
    [0, 0.1, 0.9, 0]
  )
  assert.deepEqual(
    rows.map(row => row.reportShare),
    [0.6, 0.1, 0.3, 0]
  )
  assert.equal(rows[0].fallback, false)
  assert.equal(rows[1].historyAudit.shareZeroed, false)
  assert.equal(rows[2].fallback, true)
  assert.deepEqual(
    rows[2].coefficientFallback.filter(reason => reason.startsWith('历史SKU')),
    ['历史SKU Top1承接组内剩余占比0.6']
  )
  assert.equal(rows[3].fallback, false)
})

test('最大有效历史并列沿物料编码排序，全部在同一历史层核对差额', () => {
  const input = sample()
  input.products[2].group = '包点'
  input.history = input.history.map(row => ({ ...row, quantity: row.code === 'A' ? 60 : 20 }))
  const rows = december(input)
  assert.deepEqual(
    rows.map(row => row.historyShare),
    [0, 0.8, 0.2]
  )
  assert.match(rows[1].coefficientFallback.join('；'), /历史SKU/)
  assert.ok(!rows[2].coefficientFallback.some(reason => /历史SKU/.test(reason)))
})

test('自身和池内替换品按系数核三月，池外替换与其他基地发货不影响该基地归零', () => {
  const input = sample()
  input.products[0].historyCode = 'OLD'
  input.products[0].historyFactor = 2
  input.historyPeriods.forEach(period =>
    period.rows.push({ month: period.month, base: '甲', code: 'OLD', quantity: 3 }, { month: period.month, base: '乙', code: 'A', quantity: 999 })
  )
  let a = december(input)[0]
  assert.equal(a.historyAudit.shareZeroed, true)
  input.products.push({ ...input.products[2], code: 'OLD' })
  a = december(input)[0]
  assert.equal(a.historyAudit.months[0].ownQuantity, 0)
  assert.equal(a.historyAudit.months[0].referenceQuantity, 3)
  assert.equal(a.historyAudit.months[0].quantity, 6)
  assert.equal(a.historyAudit.shareZeroed, false)
  assert.equal(a.historyShare, 0.3)
  input.products[0].historyFactor = null
  a = december(input)[0]
  assert.equal(a.historyAudit.shareZeroed, false)
  assert.equal(a.historyAudit.months[0].quantity, null)
})

test('近三月读取失败或部分读取不归零，财年来源失败时确认零行的组内差额待核', () => {
  for (const status of ['failed', 'partial', 'unread']) {
    const input = sample()
    input.historyPeriods[0].status = status
    const [a, b] = december(input)
    assert.equal(a.historyAudit.shareZeroed, false)
    assert.equal(a.historyShare, 0.3)
    assert.equal(b.historyShare, 0.2)
  }
  const input = sample()
  input.historySourceStatus = 'failed'
  const [a, b] = december(input)
  assert.equal(a.historyQuantity, 60)
  assert.equal(a.historyShare, 0)
  assert.equal(b.historyShare, null)
  assert.equal(a.demand, null)
})

test('财年读取带未完整来源原因时不把已知小计用作差额承接依据', () => {
  const input = sample()
  input.historySourceIssues = ['财年来源只返回已知小计']
  const [a, b] = december(input)
  assert.equal(a.historyShare, 0)
  assert.equal(b.historyShare, null)
  assert.equal(b.demand, null)
})
