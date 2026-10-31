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

test('月度基地SKU范围限定分母与Top1，不把其他月份或产能复制为当月需求', () => {
  const sample = input()
  sample.productMonths = [
    { month: '2026-12', base: '甲', code: 'A' },
    { month: '2027-01', base: '乙', code: 'B' }
  ]
  sample.report = [sample.report[0], { month: '2027-01', base: '乙', code: 'B', quantity: 80 }]
  sample.history = [sample.history[0], { month: '2026-01', base: '乙', code: 'B', quantity: 40 }]
  sample.categoryDemand.push({ month: '2027-01', category: '点心', quantity: 200 })
  sample.capacities = [{ base: '丙', code: 'A', line: '一线', dailyPieces: 100, dailyTons: 10, missing: [] }]
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(
    result.rows.map(row => [row.month, row.base, row.code]),
    [
      ['2026-12', '甲', 'A'],
      ['2027-01', '乙', 'B']
    ]
  )
  assert.equal(result.rows[0].reportLayers.categoryQuantity, 30)
  assert.equal(result.rows[0].historyLayers.categoryQuantity, 60)
  assert.equal(result.rows[0].share, 1)
  assert.equal(result.rows[0].fallback, true)
  assert.equal(result.rows[0].demand, 120)
  assert.equal(result.rows[0].nextMonthDemand, null)
})

test('池外事实保留源分类，只阻断对应大类，未知分类仍阻断当月完整性', () => {
  const sample = input()
  sample.products[1].category = '汤圆'
  sample.products[1].group = '汤圆组'
  sample.productMonths = [{ month: '2026-12', base: '甲', code: 'A' }]
  sample.report.push({ month: '2026-12', base: '丙', code: 'C', category: '汤圆', quantity: 500 })
  const classified = computeMpsWorkflow(sample)
  assert.equal(classified.rows[0].reportShare, 1)
  assert.equal(classified.rows[0].historyShare, 1)
  assert.equal(classified.rows[0].demand, 120)
  assert.match(classified.missing.join(''), /2026-12.*汤圆.*池外/)
  sample.report.push({ month: '2026-12', base: '丁', code: 'X', quantity: 1 })
  const unknown = computeMpsWorkflow(sample)
  assert.equal(unknown.rows[0].reportShare, null)
  assert.equal(unknown.rows[0].historyShare, 1)
  assert.equal(unknown.rows[0].demand, null)
  assert.match(unknown.rows[0].missing.demand.join(''), /分类未知/)
})

test('月度正式归属范围内的缺行和NULL仍缺数，未证明全国时仅报告范围内结果', () => {
  const sample = input()
  sample.productMonths = sample.products.map(({ base, code }) => ({ month: '2026-12', base, code }))
  sample.report.pop()
  sample.history[1].quantity = null
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[1].reportQuantity, null)
  assert.equal(result.rows[1].historyQuantity, null)
  assert.equal(result.rows[0].share, null)
  assert.equal(result.scopeCoverage, 'in-scope')
  assert.match(result.missing.join(''), /全国覆盖.*实际证明.*范围内/)
  sample.scopeCoverage = 'national'
  assert.equal(computeMpsWorkflow(sample).scopeCoverage, 'national')
})

test('M+4只供大类库存参考，该月事实不扩充或污染前三月SKU范围', () => {
  const sample = input()
  sample.productMonths = sample.products.map(({ base, code }) => ({ month: '2026-12', base, code }))
  sample.report.push({ month: '2027-03', base: '丙', code: 'C', quantity: 500 })
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows.length, 2)
  assert.equal(
    result.missing.some(reason => reason.includes('2027-03') && reason.includes('池外')),
    false
  )
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

test('预计结存允许负数，局部草稿不误报可执行主计划', () => {
  const sample = input()
  sample.openingInventory[0].quantity = -5
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.constraints.rules = { local: [{ description: '只作核对', strength: '硬' }] }
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows[0].openingInventory, -5)
  assert.equal(result.rows[0].safetyDays, 0)
  for (const field of ['mainPlan', 'gap', 'load', 'transfer']) assert.equal(result.rows[0][field], null)
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

test('两路分层占比展示物料组、大类、全国SKU与基地，零中间分母保持未知', () => {
  const sample = input()
  sample.products = [
    { ...sample.products[0], code: 'A', group: '一组' },
    { ...sample.products[0], base: '乙', code: 'A', group: '一组' },
    { ...sample.products[0], code: 'B', group: '一组' },
    { ...sample.products[0], code: 'C', group: '二组' }
  ]
  sample.report = sample.products.map((row, i) => ({ month: '2026-12', base: row.base, code: row.code, quantity: [20, 30, 30, 20][i] }))
  sample.history = sample.report.map(row => ({ ...row, month: '2025-12' }))
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(result.rows[0].reportLayers, {
    groupQuantity: 80,
    categoryQuantity: 100,
    skuQuantity: 50,
    baseQuantity: 20,
    groupShare: 0.8,
    skuShare: 0.625,
    baseShare: 0.4,
    product: 0.2
  })
  assert.equal(result.rows[0].share, 0.2)
  sample.report[3].quantity = 0
  sample.history[3].quantity = 0
  const zero = computeMpsWorkflow(sample).rows[3]
  assert.equal(zero.reportLayers.groupShare, 0)
  assert.equal(zero.reportLayers.skuShare, null)
  assert.equal(zero.reportLayers.baseShare, null)
  assert.equal(zero.share, 0)
})

test('全国物料组Top1托底承接有效占比，基地按两路占比并拒绝负托底', () => {
  const sample = input()
  sample.products = [
    { ...sample.products[0], code: 'A' },
    { ...sample.products[0], base: '乙', code: 'A' },
    { ...sample.products[0], code: 'B' }
  ]
  sample.report = sample.products.map((row, i) => ({ month: '2026-12', base: row.base, code: row.code, quantity: [20, 20, 60][i] }))
  sample.history = sample.report.map((row, i) => ({ ...row, month: '2025-12', quantity: [40, 40, 20][i] }))
  const first = computeMpsWorkflow(sample)
  assert.deepEqual(
    first.rows.slice(0, 3).map(row => row.fallback),
    [true, true, false]
  )
  sample.adjustments = { shares: [{ rowId: first.rows[2].id, share: 0.2 }], categoryDemand: [{ month: '2026-12', category: '点心', quantity: 200 }] }
  const adjusted = computeMpsWorkflow(sample)
  assert.deepEqual(
    adjusted.rows.slice(0, 3).map(row => row.share),
    [0.4, 0.4, 0.2]
  )
  assert.deepEqual(
    adjusted.rows.slice(0, 3).map(row => row.demand),
    [80, 80, 40]
  )
  assert.equal(adjusted.rows[2].systemShare, 0.4)
  assert.equal(adjusted.categoryRows.find(row => row.category === '点心').systemQuantity, 120)
  sample.adjustments.shares[0].share = 1.1
  const rejected = computeMpsWorkflow(sample)
  assert.match(rejected.adjustmentIssues.join(''), /托底|占比/)
  assert.equal(rejected.rows[2].share, 0.4)
})

test('全国Top1同量按编码稳定选择，缺去年来源不猜托底', () => {
  const sample = input()
  sample.history.forEach(row => {
    row.quantity = 50
  })
  assert.equal(computeMpsWorkflow(sample).rows[0].fallback, true)
  sample.history.pop()
  assert.equal(computeMpsWorkflow(sample).rows[0].fallback, false)
  assert.equal(computeMpsWorkflow(sample).rows[0].share, null)
})

test('安全库存使用下月自然月，负结存滚动无约束所需生产，M+4只作库存参考', () => {
  const sample = input()
  sample.products = [sample.products[0]]
  sample.report = ['2026-12', '2027-01', '2027-02'].map(month => ({ month, base: '甲', code: 'A', quantity: 1 }))
  sample.history = sample.report.map((row, i) => ({ ...row, month: ['2025-12', '2026-01', '2026-02'][i] }))
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02', '2027-03'].map((month, i) => ({ month, category: '点心', quantity: [100, 310, 280, 620][i] }))
  sample.openingInventory = [{ base: '甲', code: 'A', quantity: -5 }]
  sample.constraints.safetyDays = [{ base: '甲', days: 2 }]
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(
    result.rows.map(row => row.targetInventory),
    [20, 20, 40]
  )
  assert.deepEqual(
    result.rows.map(row => row.openingInventory),
    [-5, 20, 20]
  )
  assert.deepEqual(
    result.rows.map(row => row.requiredProduction),
    [125, 310, 300]
  )
  assert.deepEqual(
    result.rows.map(row => row.projectedClosing),
    [20, 20, 40]
  )
  assert.equal(result.rows[2].nextMonthDemand, 620)
  assert.equal(result.rows.length, 3)
  assert.equal(result.rows[0].evaluation, 'unconstrained')
  assert.equal(result.rows[0].mainPlan, null)
})

test('零安全天数不要求未知下月需求，缺失天数仍为未知', () => {
  const sample = input()
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  const row = computeMpsWorkflow(sample).rows[0]
  assert.equal(row.targetInventory, 0)
  assert.ok(Math.abs(row.requiredProduction - 54) < 1e-12)
  assert.equal(row.projectedClosing, 0)
  sample.constraints.safetyDays = []
  assert.equal(computeMpsWorkflow(sample).rows[0].targetInventory, null)
})

const resourceInput = () => {
  const sample = input()
  sample.products = ['A', 'B'].map(code => ({ ...sample.products[0], code }))
  sample.report = sample.products.map(row => ({ month: '2026-12', base: '甲', code: row.code, quantity: 50 }))
  sample.history = sample.report.map(row => ({ ...row, month: '2025-12' }))
  sample.categoryDemand[0].quantity = 100
  sample.openingInventory = sample.products.map(row => ({ base: '甲', code: row.code, quantity: 0 }))
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.unitWeights = sample.products.map(row => ({ base: '甲', code: row.code, tonsPerPiece: 0.1 }))
  sample.productionDays = [{ base: '甲', month: '2026-12', days: 10 }]
  sample.resources = [
    { id: 't1', base: '甲', kind: 'tunnel', name: '共享隧道', dailyTons: 1 },
    { id: 'f1', base: '甲', kind: 'forming', name: '共享成型机', dailyTons: 2 }
  ]
  sample.resourceAssignments = sample.products.flatMap(row =>
    sample.resources.map(resource => ({ month: '2026-12', base: '甲', code: row.code, resourceId: resource.id, share: 1 }))
  )
  return sample
}

test('共享资源按唯一ID汇总吨数评估，资源缺口及边界阈值来自同一结果', () => {
  const sample = resourceInput()
  const result = computeMpsWorkflow(sample)
  const tunnel = result.resourceLoads.find(row => row.month === '2026-12' && row.resourceId === 't1')
  assert.equal(tunnel.requiredTons, 10)
  assert.equal(tunnel.requiredDays, 10)
  assert.equal(tunnel.load, 1)
  assert.equal(tunnel.status, 'warning')
  assert.equal(tunnel.gapTons, 0)
  sample.productionDays[0].days = 8
  const overload = computeMpsWorkflow(sample).resourceLoads.find(row => row.month === '2026-12' && row.resourceId === 't1')
  assert.equal(overload.load, 1.25)
  assert.equal(overload.status, 'overload')
  assert.equal(overload.overloadDays, 2)
  assert.equal(overload.gapTons, 2)
  assert.equal(result.rows[0].requiredProductionTons, 5)
  assert.equal(result.rows[0].mainPlan, null)
})

test('缺重量、重复资源、未分配多产线不虚报正常或将日产吨件比作重量', () => {
  const sample = resourceInput()
  sample.unitWeights = []
  sample.capacities = sample.products.map(row => ({ ...row, line: '旧线', dailyPieces: 10, dailyTons: 1, missing: [] }))
  let result = computeMpsWorkflow(sample)
  assert.equal(result.rows[0].requiredProductionTons, null)
  assert.equal(result.resourceLoads[0].status, 'unknown')
  assert.equal(result.summary.requiredProductionTons, null)
  assert.equal(result.summary.knownRequiredProductionTons, 0)
  const candidates = resourceInput()
  candidates.resources.push({ ...candidates.resources[0], id: 't2' })
  candidates.resourceAssignments = candidates.resourceAssignments.filter(row => row.resourceId !== 't1')
  result = computeMpsWorkflow(candidates)
  assert.equal(result.resourceLoads.find(row => row.resourceId === 't2').load, null)
  assert.match(result.summary.missing.join(''), /分配/)
  const duplicate = resourceInput()
  duplicate.resources.push({ ...duplicate.resources[0] })
  assert.equal(computeMpsWorkflow(duplicate).resourceLoads[0].load, null)
})

test('完整输入无调整时保持直接两路占比，托底单基地也允许平衡调整', () => {
  const sample = input()
  sample.products = [
    { ...sample.products[0], code: 'A' },
    { ...sample.products[0], base: '乙', code: 'A' },
    { ...sample.products[0], code: 'B' }
  ]
  sample.report = sample.products.map((row, i) => ({ month: '2026-12', base: row.base, code: row.code, quantity: [30, 10, 60][i] }))
  sample.history = sample.report.map((row, i) => ({ ...row, month: '2025-12', quantity: [20, 60, 20][i] }))
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows[0].share, 0.25)
  assert.equal(result.rows[1].share, 0.35)
  sample.adjustments = { shares: [{ rowId: result.rows[2].id, share: 0.2 }] }
  const residual = computeMpsWorkflow(sample)
  assert.ok(Math.abs(residual.rows[0].share - 0.3333333333333333) < 1e-12)
  assert.ok(Math.abs(residual.rows[1].share - 0.4666666666666667) < 1e-12)
  const single = input()
  const before = computeMpsWorkflow(single)
  single.adjustments = {
    shares: [
      { rowId: before.rows[0].id, share: 0.6 },
      { rowId: before.rows[1].id, share: 0.4 }
    ]
  }
  const after = computeMpsWorkflow(single)
  assert.deepEqual(
    after.rows.slice(0, 2).map(row => row.share),
    [0.6, 0.4]
  )
  assert.deepEqual(after.adjustmentIssues, [])
})

test('产能与生产天数显式0保留可计算缺口，生产天数不得超出自然月', () => {
  const sample = resourceInput()
  sample.resources[0].dailyTons = 0
  let result = computeMpsWorkflow(sample)
  let tunnel = result.resourceLoads.find(row => row.resourceId === 't1' && row.month === '2026-12')
  assert.equal(tunnel.load, null)
  assert.equal(tunnel.gapTons, 10)
  sample.resources[0].dailyTons = 1
  sample.productionDays[0].days = 0
  result = computeMpsWorkflow(sample)
  tunnel = result.resourceLoads.find(row => row.resourceId === 't1' && row.month === '2026-12')
  assert.equal(tunnel.productionDays, 0)
  assert.equal(tunnel.gapTons, 10)
  sample.productionDays[0].days = 32
  assert.equal(computeMpsWorkflow(sample).rows[0].productionDays, null)
})

test('闰年二月自然天数和90%/105%产能阈值边界使用明确口径', () => {
  const leap = input()
  leap.context.month = '2028-01'
  leap.products = [leap.products[0]]
  leap.categoryDemand = [
    { month: '2028-01', category: '点心', quantity: 10 },
    { month: '2028-02', category: '点心', quantity: 290 }
  ]
  leap.report = ['2028-01', '2028-02'].map(month => ({ month, base: '甲', code: 'A', quantity: 1 }))
  leap.history = ['2027-01', '2027-02'].map(month => ({ month, base: '甲', code: 'A', quantity: 1 }))
  leap.constraints.safetyDays = [{ base: '甲', days: 1 }]
  assert.equal(computeMpsWorkflow(leap).rows[0].targetInventory, 10)
  for (const [quantity, status] of [
    [89, 'normal'],
    [90, 'warning'],
    [105, 'warning'],
    [106, 'overload']
  ]) {
    const sample = resourceInput()
    sample.categoryDemand[0].quantity = quantity
    assert.equal(computeMpsWorkflow(sample).resourceLoads.find(row => row.resourceId === 't1' && row.month === '2026-12').status, status)
  }
})
