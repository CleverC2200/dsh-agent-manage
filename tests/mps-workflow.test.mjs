import { inventoryTargetIndex, inventoryTurnoverIndex } from '../src/mps-compute/inventory-targets.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { computeMpsWorkflow } from '../src/mps-compute/workflow.ts'
import { fairAllocate } from '../src/mps-compute/fair-allocation.ts'
import { solveMpsPlan } from '../src/mps-compute/plan.ts'
import { buildCapacityReport, capacityLoadBand } from '../src/mps-compute/capacity-report.ts'

test('RCCP无归属需求单列，系列配额对平，物理产能不随SKU重复累计', () => {
  const sample = planInput()
  sample.products.push({ base: '甲', code: 'C', name: '无归属产品', category: '点心', group: '无归属组', series: '无归属系列' })
  sample.report.push({ month: '2026-12', base: '甲', code: 'C', quantity: 100 })
  sample.history = structuredClone(sample.report)
  sample.categoryDemand = sample.categoryDemand.map(row => ({ ...row, quantity: 200 }))
  sample.unitWeights.push({ base: '甲', code: 'C', tonsPerPiece: 0.1 })
  sample.openingInventory.push({ base: '甲', code: 'C', quantity: 0 })
  const report = buildCapacityReport(sample, solveMpsPlan(sample))
  const row = report.rccp.find(row => row.month === '2026-12')
  assert.ok(Math.abs(row.demand.value - 10) < 1e-8)
  assert.ok(Math.abs(row.unassigned.value - 10) < 1e-8)
  assert.equal(row.capacity, 5)
  assert.ok(Math.abs(row.load - 2) < 1e-8)
  assert.ok(Math.abs(row.margin + 5) < 1e-8)
  assert.ok(Math.abs(row.gap - 5) < 1e-8)
  assert.equal(row.series.reduce((total, row) => total + row.quota, 0), 5)
  assert.ok(Math.abs(row.series.reduce((total, row) => total + row.excess, 0) - 5) < 1e-8)
  assert.equal(report.totals.find(row => row.month === '2026-12' && row.base === '全国').capacity, 5)
  assert.equal(report.fiscalMonths.length, 12)
  assert.equal(report.totals.find(row => row.month === '2026-07' && row.base === '甲').demand.value, null)
  const annual = buildCapacityReport(sample, solveMpsPlan(sample), { rows: [{ month: '2026-12', base: '甲', code: 'A', quantity: 30 }] })
  const annualMonth = annual.annualTotals.find(row => row.month === '2026-12' && row.base === '甲')
  assert.equal(annualMonth.demand.value, 3)
  assert.equal(annualMonth.load, 0.6)
  assert.equal(annual.annualSource.records, 1)
  sample.productionDays.push({ base: '甲', month: '2026-11', days: 1 })
  const reference = buildCapacityReport(sample, solveMpsPlan(sample), { referenceMonth: '2026-11', rows: [{ month: '2026-11', base: '甲', code: 'A', quantity: 30 }] })
  assert.equal(reference.referenceMonth, '2026-11')
  assert.equal(reference.totals.find(row => row.month === '2026-11' && row.base === '甲').demand.value, 3)
  assert.equal(reference.rccp.find(row => row.month === '2026-11' && row.base === '甲').demand.value, 3)
  const unresolved = buildCapacityReport(sample, solveMpsPlan(sample), { rows: [{ month: '2026-12', base: '甲', code: 'A', quantity: 30 }], unmapped: [{ month: '2026-12', code: 'X', reason: 'belong_base为空' }] })
  const incomplete = unresolved.annualTotals.find(row => row.month === '2026-12' && row.base === '甲')
  assert.equal(incomplete.demand.value, null)
  assert.equal(incomplete.demand.known, 3)
  assert.equal(incomplete.load, null)
  assert.deepEqual([0.899, 0.9, 1.05, 1.051, null].map(capacityLoadBand), ['normal', 'warning', 'warning', 'overload', 'unknown'])
})

test('确认后的库存版本按期间选择，不因单品缺失或字段为空切到另一版本', () => {
  const common = { month: '2026-11', base: '遂平', code: 'A', finalTarget: 100, dailyDemand: 10, sourceRows: 1 }
  const source = [
    { ...common, version: '月初', finalTurnoverDays: null, conflictFields: ['finalTurnoverDays'] },
    { ...common, version: '滚动', finalTurnoverDays: 15.551567 },
    { ...common, code: 'B', version: '滚动', finalTurnoverDays: 12 }
  ]
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], 'auto', [], ['纠偏', '月初'])(common).sourceDays, null)
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], '滚动')(common).sourceDays, 15.551567)
  const selected = inventoryTargetIndex(source, 'auto', [], ['纠偏', '月初'])({ ...common, code: 'B' })
  assert.equal(selected.version, '月初')
  assert.ok(selected.missingCodes.includes('missing-selected-version'))
  source[0] = { ...common, version: '月初', finalTurnoverDays: null }
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], 'auto', [], ['纠偏', '月初'])(common).sourceDays, null)
})

test('缺周转天数按授权临时取零，来源缺项保留，补充和源值优先', () => {
  const sample = input()
  sample.requireSourceTurnoverDays = true
  sample.missingTurnoverDaysAsZero = true
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02', '2027-03'].map(month => ({ month, category: '点心', quantity: 120 }))
  const result = computeMpsWorkflow(sample)
  assert.ok(result.rows.every(row => row.safetyDays === 0 && row.targetInventory === 0 && row.safetyDaysSource === 'missing-turnover-days-zero'))
  assert.ok(result.rows.every(row => row.turnoverPolicy.sourceDays === null && row.turnoverPolicy.missing.length > 0))
  sample.constraints.turnoverDays = [{ base: '甲', code: 'A', days: 15 }]
  assert.ok(computeMpsWorkflow(sample).rows.filter(row => row.base === '甲').every(row => row.safetyDays === 15 && row.safetyDaysSource === 'manual-turnover-days'))
  sample.inventoryTargets = [{ month: '2026-12', base: '甲', code: 'A', version: '月初', finalTarget: 0, dailyDemand: 0, finalTurnoverDays: 22, sourceRows: 1 }]
  assert.ok(computeMpsWorkflow(sample).rows.filter(row => row.base === '甲').every(row => row.safetyDays === 22 && row.safetyDaysSource === 'target-turnover-days'))
})

test('要求源周转天数时缺项不套基地天数，人工补充后重新纳入计算', () => {
  const sample = input()
  sample.constraints.safetyDays = [{ base: '甲', days: 25 }, { base: '乙', days: 25 }]
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02', '2027-03'].map(month => ({ month, category: '点心', quantity: 120 }))
  sample.requireSourceTurnoverDays = true
  let result = computeMpsWorkflow(sample)
  assert.ok(result.rows.every(row => row.safetyDays === null && row.targetInventory === null))
  sample.constraints.turnoverDays = [{ base: '甲', code: 'A', days: 15 }]
  result = computeMpsWorkflow(sample)
  assert.ok(result.rows.filter(row => row.base === '甲' && row.code === 'A').every(row => row.safetyDays === 15 && row.targetInventory !== null))
  assert.ok(result.rows.filter(row => row.base === '乙').every(row => row.safetyDays === null))
})

const planInput = () => {
  const sample = input()
  sample.products[1].base = '甲'
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02'].map(month => ({
    month,
    category: '点心',
    quantity: 100
  }))
  sample.report = sample.categoryDemand.flatMap(({ month }) => [
    { month, base: '甲', code: 'A', quantity: 80 },
    { month, base: '甲', code: 'B', quantity: 20 }
  ])
  sample.history = structuredClone(sample.report)
  sample.openingInventory = [
    { base: '甲', code: 'A', quantity: 0 },
    { base: '甲', code: 'B', quantity: 0 }
  ]
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.unitWeights = sample.products.map(row => ({
    base: row.base,
    code: row.code,
    tonsPerPiece: 0.1
  }))
  sample.productionDays = sample.categoryDemand.map(({ month }) => ({
    base: '甲',
    month,
    days: 1
  }))
  sample.resources = [{ id: 'R', base: '甲', name: '共享隧道', kind: 'tunnel', dailyTons: 5 }]
  sample.planCandidates = sample.products.map(row => ({
    base: row.base,
    code: row.code,
    resourceId: 'R'
  }))
  return sample
}

test('三月计划按共同满足率不超产，未满足量与原需求分开且缺成型机不阻断', () => {
  const result = solveMpsPlan(planInput())
  const first = result.rows.filter(row => row.month === '2026-12')
  assert.ok(Math.abs(first[0].mainPlan - 40) < 1e-6)
  assert.ok(Math.abs(first[1].mainPlan - 10) < 1e-6)
  assert.equal(first[0].demand, 80)
  assert.ok(Math.abs(first[0].unfulfilled - 40) < 1e-6)
  assert.ok(first.every(row => row.closingInventory === 0))
  assert.ok(result.resourceSchedules.every(row => row.scheduledTons <= row.capacity && row.load <= 1))
  assert.ok(result.rows.every(row => !row.planMissing.some(reason => /成型机/.test(reason))))
})

test('后月承接实际库存，不假定前月达到目标；未知输入不改为零排产', () => {
  const sample = planInput()
  sample.constraints.safetyDays = [{ base: '甲', days: 5 }]
  const result = solveMpsPlan(sample)
  const first = result.rows.find(row => row.month === '2026-12' && row.code === 'A')
  const next = result.rows.find(row => row.month === '2027-01' && row.code === 'A')
  assert.ok(first.targetInventory > 0)
  assert.equal(first.closingInventory, 0)
  assert.equal(next.openingInventory, 0)
  sample.unitWeights.pop()
  const partial = solveMpsPlan(sample)
  assert.equal(partial.rows.find(row => row.code === 'B').mainPlan, null)
  assert.equal(partial.status, 'partial')
  assert.ok(partial.resourceSchedules.every(row => row.scheduledTons <= row.capacity))
})

test('合法调拨只使用发出基地剩余能力，无方向资格不生成调拨', () => {
  const sample = planInput()
  sample.unitWeights.push({ base: '乙', code: 'A', tonsPerPiece: 0.1 }, { base: '乙', code: 'B', tonsPerPiece: 0.1 })
  sample.resources.push({ id: 'S', base: '乙', name: '承接隧道', kind: 'tunnel', dailyTons: 3 })
  sample.productionDays.push(...sample.categoryDemand.map(({ month }) => ({ base: '乙', month, days: 1 })))
  sample.planCandidates.push({ base: '乙', code: 'A', resourceId: 'S' }, { base: '乙', code: 'B', resourceId: 'S' })
  assert.equal(solveMpsPlan(sample).transfers.length, 0)
  sample.transferRoutes = [
    { from: '乙', to: '甲', code: 'A' },
    { from: '乙', to: '甲', code: 'B' }
  ]
  const result = solveMpsPlan(sample)
  const shipments = result.transfers.filter(row => row.month === '2026-12')
  assert.ok(Math.abs(shipments.reduce((sum, row) => sum + row.tons, 0) - 3) < 1e-7)
  assert.ok(result.rows.filter(row => row.month === '2026-12').every(row => Math.abs(row.fulfillment - 0.8) < 1e-7))
  assert.ok(result.resourceSchedules.every(row => row.scheduledTons <= row.capacity))
})

test('实际求解执行停线、月历上限及已采用库存规则，月份外保持原规则', () => {
  const sample = planInput()
  sample.constraints.rules.local = [
    {
      id: 'days',
      description: '首月半天',
      strength: '硬',
      base: '甲',
      from: '2026-12',
      until: '2026-12',
      effect: { kind: 'production-days', value: 0.5 }
    },
    {
      id: 'stop',
      description: '次月停线',
      strength: '硬',
      base: '甲',
      from: '2027-01',
      until: '2027-01',
      effect: { kind: 'resource-unavailable', resourceId: 'R' }
    },
    {
      id: 'stock',
      description: '库存下限',
      strength: '软',
      accepted: true,
      base: '甲',
      code: 'A',
      from: '2026-12',
      until: '2026-12',
      effect: { kind: 'inventory-days', value: 5 }
    }
  ]
  const result = solveMpsPlan(sample)
  assert.deepEqual(
    result.resourceSchedules.map(row => row.capacity),
    [2.5, 0, 5]
  )
  assert.ok(result.resourceSchedules.every(row => row.scheduledTons <= row.capacity))
  assert.ok(result.rows.find(row => row.code === 'A').targetInventory > 0)
  assert.equal(result.rows.find(row => row.code === 'B').targetInventory, 0)
  assert.ok(result.rows.filter(row => row.month === '2027-01').every(row => row.mainPlan === 0))
  sample.planCandidates = sample.planCandidates.map(row => ({ ...row, month: '2026-12' }))
  assert.ok(
    solveMpsPlan(sample)
      .rows.filter(row => row.month === '2027-02')
      .every(row => row.mainPlan === null)
  )
})

test('共享资源按相同满足率分配，逐资源实际占用严格不超上限', () => {
  const result = fairAllocate(
    [
      { id: 'A', quantity: 80, resources: ['R'] },
      { id: 'B', quantity: 20, resources: ['R'] }
    ],
    [{ id: 'R', quantity: 50 }]
  )
  assert.ok(Math.abs(result.demands[0].allocated - 40) < 1e-7)
  assert.ok(Math.abs(result.demands[1].allocated - 10) < 1e-7)
  assert.ok(Math.abs(result.demands[0].rate - result.demands[1].rate) < 1e-9)
  assert.ok(result.allocations.reduce((sum, row) => sum + row.quantity, 0) <= 50)
})

test('替代资源可重分配，不让柔性SKU挤占只有唯一资源的SKU', () => {
  const result = fairAllocate(
    [
      { id: 'A', quantity: 100, resources: ['X', 'Y'] },
      { id: 'B', quantity: 100, resources: ['X'] }
    ],
    [
      { id: 'X', quantity: 100 },
      { id: 'Y', quantity: 100 }
    ]
  )
  assert.ok(result.demands.every(row => Math.abs(row.allocated - 100) < 1e-7))
  assert.ok(result.allocations.filter(row => row.demandId === 'A' && row.resourceId === 'Y').length)
  result.resources.forEach(row => assert.ok(row.allocated <= row.capacity))
})

test('受限SKU冻结满足率，其他资源余量继续分配且不突破任何资源', () => {
  const result = fairAllocate(
    [
      { id: 'A', quantity: 100, resources: ['X'] },
      { id: 'B', quantity: 100, resources: ['Y'] },
      { id: 'C', quantity: 0, resources: [] }
    ],
    [
      { id: 'X', quantity: 20 },
      { id: 'Y', quantity: 100 }
    ]
  )
  assert.ok(Math.abs(result.demands[0].rate - 0.2) < 1e-7)
  assert.ok(Math.abs(result.demands[1].rate - 1) < 1e-7)
  assert.equal(result.demands[2].allocated, 0)
  assert.equal(result.demands[2].rate, 1)
})

test('多资源共同约束公平率，输入次序不改变满足率，零产能不生成产量', () => {
  const demands = [
    { id: 'A', quantity: 80, resources: ['X'] },
    { id: 'B', quantity: 80, resources: ['X', 'Y'] },
    { id: 'C', quantity: 80, resources: ['Y'] }
  ]
  const capacities = [
    { id: 'X', quantity: 100 },
    { id: 'Y', quantity: 100 }
  ]
  const result = fairAllocate(demands, capacities)
  result.demands.forEach(row => assert.ok(Math.abs(row.rate - 200 / 240) < 1e-7))
  const reversed = fairAllocate([...demands].reverse(), [...capacities].reverse())
  result.demands.forEach(row => assert.equal(row.rate, reversed.demands.find(item => item.id === row.id).rate))
  const empty = fairAllocate(
    demands,
    capacities.map(row => ({ ...row, quantity: 0 }))
  )
  assert.ok(empty.demands.every(row => row.allocated === 0))
})

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
    { month: '2026-12', base: '甲', code: 'A', quantity: 60 },
    { month: '2026-12', base: '乙', code: 'B', quantity: 40 }
  ],
  sourceIssues: { report: [], history: [] },
  openingInventory: [{ base: '甲', code: 'A', quantity: 0 }],
  capacities: [],
  constraints: { safetyDays: [], rules: {} }
})

test('后月库存缺源诊断不按单品重复遍历整张来源', () => {
  let sourceMonthReads = 0
  const source = Array.from({ length: 400 }, (_, i) => ({
    get month() { sourceMonthReads++; return '2026-11' },
    base: '甲', code: String(i), version: '月初', finalTarget: 100, dailyDemand: 10, sourceRows: 1
  }))
  const resolve = inventoryTargetIndex(source)
  for (let i = 0; i < 400; i++) {
    const result = resolve({ month: '2026-12', base: '甲', code: String(i) })
    assert.equal(result.status, 'missing')
    assert.deepEqual(result.missingCodes, ['missing-record'])
  }
  assert.ok(sourceMonthReads <= source.length * 10, `来源月份被读取${sourceMonthReads}次，缺行诊断应复用已建索引`)
})

test('基地安全天数策略用于三个月，SKU月表只作对照且不能替代缺失策略', () => {
  const sample = input()
  sample.products = [sample.products[0]]
  sample.report = [sample.report[0]]
  sample.history = [sample.history[0]]
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02', '2027-03'].map((month, index) => ({ month, category: '点心', quantity: [100, 200, 300, 400][index] }))
  sample.inventoryTargets = [{ month: '2026-12', base: '甲', code: 'A', version: '月初', finalTarget: 120, dailyDemand: 10, sourceRows: 1 }]
  let result = computeMpsWorkflow(sample)
  assert.equal(result.rows[0].inventoryTarget.days, 12)
  assert.ok(result.rows.every(row => row.safetyDays === null && row.targetInventory === null))
  sample.constraints.safetyDays = [{ base: '甲', days: 10 }]
  result = computeMpsWorkflow(sample)
  assert.deepEqual(result.rows.map(row => row.nextMonthDays), [31, 28, 31])
  assert.deepEqual(result.rows.map(row => row.baseSafetyDays), [10, 10, 10])
  assert.ok(result.rows.every(row => row.safetyDaysSource === 'base-policy'))
  result.rows.forEach((row, index) => assert.ok(Math.abs(row.targetInventory - [2000 / 31, 3000 / 28, 4000 / 31][index]) < 1e-10))
  assert.equal(result.rows[1].inventoryTarget.status, 'missing')
  sample.constraints.safetyDays.push({ base: '甲', days: 20 })
  assert.ok(computeMpsWorkflow(sample).rows.every(row => row.safetyDays === null))
})

test('评估月的一套系数拆分三个月，后月提报不改变本版系数', () => {
  const sample = input()
  sample.categoryDemand.push({ month: '2027-01', category: '点心', quantity: 200 }, { month: '2027-02', category: '点心', quantity: 300 })
  sample.report.push({ month: '2027-01', base: '甲', code: 'A', quantity: 999 })
  const result = computeMpsWorkflow(sample)
  result.rows.filter(row => row.code === 'A').forEach((row, index) => assert.ok(Math.abs(row.demand - [54, 90, 135][index]) < 1e-10))
  assert.ok(result.rows.every(row => row.reportQuantity !== null && row.historyQuantity !== null))
})

test('提报缺Top1系数时物料组和SKU各承接剩余占比，基地份额保持源值', () => {
  const sample = input()
  sample.products.push({ ...sample.products[0], code: 'C', group: '另一组' })
  sample.history = sample.products.map((row, i) => ({ month: sample.context.month, base: row.base, code: row.code, quantity: [60, 20, 20][i] }))
  sample.report = sample.products.map((row, i) => ({ month: sample.context.month, base: row.base, code: row.code, quantity: [null, 20, 30][i] }))
  sample.reportRatios = [
    { kind: 'group', category: '点心', group: '另一组', share: 0.3 },
    { kind: 'sku', category: '点心', group: '包点', code: 'B', share: 0.25 },
    { kind: 'sku', category: '点心', group: '另一组', code: 'C', share: 1 },
    ...sample.products.map(row => ({ kind: 'base', category: row.category, group: row.group, code: row.code, base: row.base, share: 1 }))
  ]
  const result = computeMpsWorkflow(sample)
  const a = result.rows[0]
  assert.equal(a.reportLayers.groupShare, 0.7)
  assert.equal(a.reportLayers.skuShare, 0.75)
  assert.equal(a.reportLayers.baseShare, 1)
  assert.ok(Math.abs(a.reportShare - 0.525) < 1e-12)
  assert.ok(Math.abs(a.share - 0.5625) < 1e-12)
  assert.equal(a.reportQuantity, null)
  assert.ok(result.rows.slice(0, 3).every(row => row.demand !== null))
  assert.ok(Math.abs(result.rows.slice(0, 3).reduce((sum, row) => sum + row.demand, 0) - 120) < 1e-10)
  assert.deepEqual(a.coefficientFallback, ['提报物料组Top1承接剩余占比', '提报SKU Top1承接剩余占比'])
  const zero = structuredClone(sample)
  zero.products.push({ ...zero.products[0], code: 'D' })
  zero.report.push({ month: sample.context.month, base: '甲', code: 'D', quantity: 0 })
  zero.history.push({ month: sample.context.month, base: '甲', code: 'D', quantity: 0 })
  zero.reportRatios.push({ kind: 'sku', category: '点心', group: '包点', code: 'D', share: 0 }, { kind: 'base', category: '点心', group: '包点', code: 'D', base: '甲', share: null })
  const zeroRow = computeMpsWorkflow(zero).rows.find(row => row.code === 'D')
  assert.equal(zeroRow.reportShare, 0)
  assert.equal(zeroRow.demand, 0)
  assert.equal(zeroRow.reportLayers.baseShare, null)
  sample.reportRatios.push({ kind: 'sku', category: '点心', group: '包点', code: 'A', share: null })
  assert.equal(computeMpsWorkflow(sample).rows[0].reportLayers.skuShare, 0.75)
  const withoutBase = structuredClone(sample)
  withoutBase.reportRatios = withoutBase.reportRatios.filter(row => !(row.kind === 'base' && row.code === 'A'))
  assert.equal(computeMpsWorkflow(withoutBase).rows[0].demand, null)
  const duplicate = structuredClone(sample)
  duplicate.reportRatios.push({ kind: 'sku', category: '点心', group: '包点', code: 'A', share: 0.9 })
  assert.equal(computeMpsWorkflow(duplicate).rows[0].demand, null)
  sample.reportRatios.find(row => row.kind === 'group').share = 1.1
  assert.equal(computeMpsWorkflow(sample).rows[0].demand, null)
})

test('两路占比只用本来源已返回的当前产品明细，缺行保留为空且不阻断另一来源', () => {
  const sample = input()
  sample.products.push({ base: '丙', code: 'C', name: '丙产品', category: '点心', group: '包点', series: '同名系列不作键' })
  sample.history = [
    { month: '2026-12', base: '甲', code: 'A', quantity: 60 },
    { month: '2026-12', base: '丙', code: 'C', quantity: 40 }
  ]
  const result = computeMpsWorkflow(sample)
  const a = result.rows.find(row => row.month === '2026-12' && row.code === 'A')
  const b = result.rows.find(row => row.month === '2026-12' && row.code === 'B')
  const c = result.rows.find(row => row.month === '2026-12' && row.code === 'C')
  assert.equal(a.reportShare, 0.3)
  assert.equal(a.historyShare, 0.6)
  assert.equal(b.historyShare, null)
  assert.equal(c.reportShare, null)
  assert.equal(b.reportShare, 0.7)
  assert.equal(c.historyShare, 0.4)
})

test('当前物料组重算占比优先，旧源系数不能放大部分已知需求', () => {
  const sample = input()
  sample.products.push({ ...sample.products[0], code: 'C' })
  sample.history.push({ month: sample.context.month, base: '甲', code: 'C', quantity: 20 })
  sample.reportRatios = [
    { kind: 'group', category: '点心', group: '包点', share: 1 },
    { kind: 'sku', category: '点心', group: '包点', code: 'A', share: 0.8 },
    { kind: 'sku', category: '点心', group: '包点', code: 'B', share: 0.8 },
    ...sample.products.map(row => ({ kind: 'base', category: row.category, group: row.group, code: row.code, base: row.base, share: 1 }))
  ]
  const rows = computeMpsWorkflow(sample).rows.filter(row => row.month === sample.context.month)
  assert.ok(Math.abs(rows[0].reportShare - 0.3) < 1e-12)
  assert.ok(Math.abs(rows[1].reportShare - 0.7) < 1e-12)
  assert.equal(rows[2].reportShare, null)
  assert.ok(rows.reduce((sum, row) => sum + (row.demand ?? 0), 0) <= 120)
})

test('评估月基地SKU范围限定三个月分母与Top1，不把后月事实或产能扩为本版需求域', () => {
  const sample = input()
  sample.productMonths = [
    { month: '2026-12', base: '甲', code: 'A' },
    { month: '2027-01', base: '乙', code: 'B' }
  ]
  sample.report = [sample.report[0], { month: '2027-01', base: '乙', code: 'B', quantity: 80 }]
  sample.history = [sample.history[0], { month: '2027-01', base: '乙', code: 'B', quantity: 40 }]
  sample.categoryDemand.push({ month: '2027-01', category: '点心', quantity: 200 })
  sample.capacities = [{ base: '丙', code: 'A', line: '一线', dailyPieces: 100, dailyTons: 10, missing: [] }]
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(
    result.rows.map(row => [row.month, row.base, row.code]),
    [
      ['2026-12', '甲', 'A'],
      ['2027-01', '甲', 'A'],
      ['2027-02', '甲', 'A']
    ]
  )
  assert.equal(result.rows[0].reportLayers.categoryQuantity, 30)
  assert.equal(result.rows[0].historyLayers.categoryQuantity, 60)
  assert.equal(result.rows[0].share, 1)
  assert.equal(result.rows[0].fallback, true)
  assert.equal(result.rows[0].demand, 120)
  assert.equal(result.rows[0].nextMonthDemand, 200)
})

test('池外事实按当前产品范围单列，源分类未知也不混入范围内分母', () => {
  const sample = input()
  sample.products[1].category = '汤圆'
  sample.products[1].group = '汤圆组'
  sample.productMonths = [{ month: '2026-12', base: '甲', code: 'A' }]
  sample.report.push({ month: '2026-12', base: '丙', code: 'C', category: '汤圆', quantity: 500 })
  const classified = computeMpsWorkflow(sample)
  assert.equal(classified.rows[0].reportShare, 1)
  assert.equal(classified.rows[0].historyShare, 1)
  assert.equal(classified.rows[0].demand, 120)
  assert.match(classified.missing.join(''), /2026-12.*汤圆.*未参与占比/)
  sample.report.push({ month: '2026-12', base: '丁', code: 'X', quantity: 1 })
  const unknown = computeMpsWorkflow(sample)
  assert.equal(unknown.rows[0].reportShare, 1)
  assert.equal(unknown.rows[0].historyShare, 1)
  assert.equal(unknown.rows[0].demand, 120)
  assert.ok(unknown.excludedSources.some(row => row.code === 'X'))
})

test('月度正式归属范围内的缺行和NULL仍缺数，未证明全国时仅报告范围内结果', () => {
  const sample = input()
  sample.productMonths = sample.products.map(({ base, code }) => ({ month: '2026-12', base, code }))
  sample.report.pop()
  sample.history[1].quantity = null
  const result = computeMpsWorkflow(sample)
  assert.equal(result.rows.length, 6)
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
  assert.equal(result.rows.length, 6)
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

test('缺产品时显式需求保留在池外诊断，缺大数不抹去有效拆分系数', () => {
  const withoutProducts = input()
  withoutProducts.products = []
  const outside = computeMpsWorkflow(withoutProducts)
  assert.deepEqual(outside.categoryRows, [])
  assert.equal(outside.excludedCategoryDemand.find(row => row.category === '点心').quantity, 120)
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
  const limited = computeMpsWorkflow(absent).rows[1]
  assert.equal(limited.historyShare, null)
  assert.equal(limited.demand, null)
  assert.equal(limited.reportShare, 0.7)
  assert.equal(computeMpsWorkflow(absent).rows[0].capacities[0].dailyPieces, 0)
  assert.equal(limited.monthlyCapacity, null)
  const denominator = input()
  denominator.history.forEach(row => {
    row.quantity = 0
  })
  assert.match(computeMpsWorkflow(denominator).rows[0].missing.historyShare.join(''), /合计为0/)
})

test('当前产品范围外的源记录单列，产品键重复仍拒绝计算', () => {
  const unmatched = input()
  unmatched.report.push({ month: '2026-12', base: '丙', code: 'C', quantity: 100 })
  assert.equal(computeMpsWorkflow(unmatched).rows[0].reportShare, 0.3)
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

test('空产品不生成固定大类范围，也不把空范围当作零需求', () => {
  const sample = input()
  sample.products = []
  sample.categoryDemand = []
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(result.categoryRows, [])
  assert.equal(result.summary.requiredProductionTons, null)
  assert.match(result.summary.missing.join('、'), /缺本版产品范围/)
})

test('浮点尾差对平不把真实零权重变成非零需求', () => {
  const sample = input()
  sample.categoryDemand[0].quantity = 100
  sample.products = ['A', 'B', 'C', 'D'].map(code => ({ base: '甲', code, name: code, category: '点心', group: '包点', series: '系列' }))
  sample.report = sample.products.map((row, index) => ({ month: '2026-12', base: row.base, code: row.code, quantity: index === 3 ? 0 : 1 }))
  sample.history = sample.report.map(row => ({ ...row, month: '2026-12' }))
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
  sample.history = sample.report.map(row => ({ ...row, month: '2026-12' }))
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
  sample.history = sample.report.map((row, i) => ({ ...row, month: '2026-12', quantity: [40, 40, 20][i] }))
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
  assert.equal(computeMpsWorkflow(sample).rows[1].share, null)
})

test('安全库存使用下月自然月，负结存滚动无约束所需生产，M+4只作库存参考', () => {
  const sample = input()
  sample.products = [sample.products[0]]
  sample.report = ['2026-12', '2027-01', '2027-02'].map(month => ({ month, base: '甲', code: 'A', quantity: 1 }))
  sample.history = sample.report.map((row, i) => ({ ...row, month: ['2026-12', '2027-01', '2027-02'][i] }))
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

test('评估月SKU范围贯穿三个月，不再要求后月源表重复提供SKU域', () => {
  const sample = input()
  sample.products = [sample.products[0]]
  sample.productMonths = [{ month: '2026-12', base: '甲', code: 'A' }]
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02'].map(month => ({ month, category: '点心', quantity: 100 }))
  sample.report = [{ month: '2026-12', base: '甲', code: 'A', quantity: 100 }]
  sample.history = [{ month: '2026-12', base: '甲', code: 'A', quantity: 100 }]
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.unitWeights = [{ base: '甲', code: 'A', tonsPerPiece: 1 }]
  const result = computeMpsWorkflow(sample)
  assert.equal(result.summary.requiredProductionTons, 300)
  assert.equal(result.summary.knownRequiredProductionTons, 300)
  assert.equal(result.summary.totalRows, 3)
  assert.deepEqual(
    result.rows.map(row => [row.month, row.requiredProduction]),
    [['2026-12', 100], ['2027-01', 100], ['2027-02', 100]]
  )
})

test('产品大类缺月度域且需求为NULL时阻断完整性，真实0不阻断', () => {
  const sample = input()
  sample.products = [sample.products[0], { ...sample.products[0], code: 'C', category: '汤圆' }]
  sample.productMonths = [{ month: '2026-12', base: '甲', code: 'A' }]
  sample.categoryDemand = [
    { month: '2026-12', category: '点心', quantity: 100 },
    { month: '2027-01', category: '点心', quantity: 0 },
    { month: '2027-02', category: '点心', quantity: 0 },
    { month: '2026-12', category: '汤圆', quantity: null },
    { month: '2027-01', category: '汤圆', quantity: 0 },
    { month: '2027-02', category: '汤圆', quantity: 0 }
  ]
  sample.report = [{ month: '2026-12', base: '甲', code: 'A', quantity: 100 }]
  sample.history = [{ month: '2026-12', base: '甲', code: 'A', quantity: 100 }]
  sample.constraints.safetyDays = [{ base: '甲', days: 0 }]
  sample.unitWeights = [{ base: '甲', code: 'A', tonsPerPiece: 1 }]
  const unknown = computeMpsWorkflow(sample)
  assert.equal(unknown.summary.requiredProductionTons, null)
  assert.equal(unknown.summary.knownRequiredProductionTons, 100)
  assert.match(unknown.summary.missing.join('、'), /2026-12 汤圆.*缺大类需求/)
  sample.categoryDemand[3].quantity = 0
  const zero = computeMpsWorkflow(sample)
  assert.equal(zero.summary.requiredProductionTons, 100)
  assert.equal(zero.summary.totalRows, 3)
  assert.equal(
    zero.summary.missing.some(reason => /汤圆|饺子|2027-01|2027-02/.test(reason)),
    false
  )
  sample.categoryDemand[3].quantity = 20
  assert.match(computeMpsWorkflow(sample).summary.missing.join('、'), /2026-12 汤圆.*缺.*SKU.*未拆分/)
})

test('显式零需求范围可汇总为0，空输入和范围内缺月需求仍未知，M+4不计入完整性', () => {
  const sample = input()
  sample.products = [{ ...sample.products[0], category: '汤圆' }]
  sample.productMonths = []
  sample.report = []
  sample.history = []
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02'].map(month => ({ month, category: '汤圆', quantity: 0 }))
  sample.categoryDemand.push({ month: '2027-03', category: '汤圆', quantity: 100 })
  const zero = computeMpsWorkflow(sample)
  assert.equal(zero.summary.requiredProductionTons, 0)
  assert.equal(zero.summary.knownRequiredProductionTons, 0)
  assert.equal(zero.summary.totalRows, 0)
  assert.deepEqual(zero.summary.missing, [])
  sample.categoryDemand = []
  assert.equal(computeMpsWorkflow(sample).summary.requiredProductionTons, null)
  sample.categoryDemand = [{ month: '2026-12', category: '汤圆', quantity: 0 }]
  assert.equal(computeMpsWorkflow(sample).summary.requiredProductionTons, null)
  sample.products = [input().products[0]]
  sample.categoryDemand = [{ month: '2026-12', category: '点心', quantity: 0 }]
  const absent = computeMpsWorkflow(sample)
  assert.equal(absent.summary.requiredProductionTons, null)
  assert.match(absent.summary.missing.join('、'), /2027-01 点心.*缺大类需求/)
  assert.match(absent.summary.missing.join('、'), /2027-02 点心.*缺大类需求/)
})

test('拒绝负数或重复大类调整不污染系统汇总范围，有效产品大类调整仍需月度域', () => {
  const sample = input()
  sample.products = [{ ...sample.products[0], category: '汤圆' }]
  sample.productMonths = []
  sample.report = []
  sample.history = []
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02'].map(month => ({ month, category: '汤圆', quantity: 0 }))
  assert.equal(computeMpsWorkflow(sample).summary.requiredProductionTons, 0)
  for (const quantities of [[-1], [10, 20]]) {
    sample.adjustments = { categoryDemand: quantities.map(quantity => ({ month: '2026-12', category: '汤圆', quantity })) }
    const result = computeMpsWorkflow(sample)
    assert.match(result.adjustmentIssues.join('、'), /2026-12 汤圆.*调整无效或重复/)
    assert.equal(result.summary.requiredProductionTons, 0)
    assert.equal(result.summary.knownRequiredProductionTons, 0)
    assert.equal(result.summary.totalRows, 0)
    assert.deepEqual(result.summary.missing, [])
  }
  sample.adjustments = { categoryDemand: [{ month: '2026-12', category: '汤圆', quantity: 10 }] }
  const accepted = computeMpsWorkflow(sample)
  assert.deepEqual(accepted.adjustmentIssues, [])
  assert.equal(accepted.summary.requiredProductionTons, null)
  assert.equal(accepted.summary.knownRequiredProductionTons, 0)
  assert.equal(accepted.summary.totalRows, 0)
  assert.match(accepted.summary.missing.join('、'), /2026-12 汤圆.*缺月度SKU域.*未拆分/)
})

const resourceInput = () => {
  const sample = input()
  sample.products = ['A', 'B'].map(code => ({ ...sample.products[0], code }))
  sample.report = sample.products.map(row => ({ month: '2026-12', base: '甲', code: row.code, quantity: 50 }))
  sample.history = sample.report.map(row => ({ ...row, month: '2026-12' }))
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
  sample.history = sample.report.map((row, i) => ({ ...row, month: '2026-12', quantity: [20, 60, 20][i] }))
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
  leap.history = ['2028-01', '2028-02'].map(month => ({ month, base: '甲', code: 'A', quantity: 1 }))
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

test('当前物料数量缺基地且非零时仍阻断该大类，真实零保留核对记录', () => {
  const sample = input()
  sample.history.push({ month: '2026-12', base: '', code: 'A', quantity: 5 })
  assert.equal(computeMpsWorkflow(sample).rows[0].historyShare, null)
  sample.history.at(-1).quantity = 0
  assert.equal(computeMpsWorkflow(sample).rows[0].historyShare, 0.6)
  assert.ok(computeMpsWorkflow(sample).excludedSources.some(row => row.reason === '源记录缺基地'))
})

{
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
    const original = globalThis.structuredClone(input)
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
}

{
  const fact = (code, month, version, finalTarget, dailyDemand, extra = {}) => ({ base: '甲', code, month, version, finalTarget, dailyDemand, sourceRows: 1, ...extra })
  const at = (code, month = '2026-11', base = '甲') => ({ code, month, base })

  test('monthly inventory targets select one version per period and preserve explicit version isolation', () => {
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
    assert.equal(resolve(at('A', '2026-11', '乙')).days, null)
    assert.equal(inventoryTargetIndex(source, '月初')(at('B')).days, 30)
    assert.equal(inventoryTargetIndex(source, '滚动')(at('A')).days, null)
  })

  test('missing, zero denominators, duplicate records and failed reads never become valid source days', () => {
    const source = [
      fact('A', '2026-11', '纠偏', 0, 10),
      fact('B', '2026-11', '纠偏', 50, 0),
      fact('C', '2026-11', '纠偏', null, 10),
      fact('D', '2026-11', '纠偏', null, 10, { sourceRows: 2 }),
      fact('E', '2026-11', '纠偏', 30, 10),
      fact('E', '2026-11', '纠偏', 30, 10)
    ]
    const resolve = inventoryTargetIndex(source)
    assert.equal(resolve(at('A')).days, 0)
    assert.equal(inventoryTargetIndex([fact('same', '2026-11', '纠偏', 80, 10, { sourceRows: 12 })])(at('same')).days, 8)
    for (const code of ['B', 'C', 'D', 'E', 'missing']) assert.equal(resolve(at(code)).days, null)
    const failed = inventoryTargetIndex(source, 'auto', ['来源读取失败'])(at('A'))
    assert.equal(failed.days, null)
    assert.equal(failed.finalTarget, null)
    assert.deepEqual(failed.missing, ['来源读取失败'])
  })

  test('source SKU days remain diagnostic while base policies and monthly minimum rules drive inventory', () => {
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
      [null, null, null]
    )
    assert.deepEqual(result.rows.map(row => row.inventoryTarget.days), [10, 20, 30])
    input.constraints.safetyDays = [{ base: '甲', days: 10 }]
    result = computeMpsWorkflow(input)
    assert.equal(result.rows[0].safetyDaysSource, 'base-policy')
    assert.equal(result.rows[0].targetInventory, 100)
    assert.equal(result.rows[0].requiredProduction, 410)
    assert.equal(result.rows[1].openingInventory, 100)
    input.constraints.safetyDays = [{ base: '甲', days: 0 }]
    result = computeMpsWorkflow(input)
    assert.equal(result.rows[0].targetInventory, 0)
    assert.equal(result.rows[0].safetyDaysSource, 'base-policy')
    input.constraints.safetyDays = []
    input.constraints.rules.local = [{ id: 'min', description: '月库存下限', strength: '硬', from: '2026-11', until: '2026-11', effect: { kind: 'inventory-days', value: 15 } }]
    result = computeMpsWorkflow(input)
    assert.equal(result.rows[0].safetyDays, 15)
    assert.equal(result.rows[0].inventoryTarget.days, 10)
    assert.equal(result.rows[0].safetyDaysSource, 'rule')
    assert.equal(result.rows[1].safetyDays, null)
  })
}

test('分层数量调整固定SKU及基地，下级按有效权重重摊并保留系统值与撤销重算', () => {
  const sample = input()
  sample.products = [
    { ...sample.products[0], code: 'A' },
    { ...sample.products[0], base: '乙', code: 'A' },
    { ...sample.products[0], code: 'B' },
    { ...sample.products[0], code: 'C', group: '另一组' }
  ]
  sample.report = sample.products.map((row, index) => ({ month: '2026-12', base: row.base, code: row.code, quantity: [10, 30, 20, 40][index] }))
  sample.history = structuredClone(sample.report)
  sample.adjustments = {
    quantities: [
      { kind: 'group', month: '2026-12', category: '点心', group: '包点', quantity: 80 },
      { kind: 'sku', month: '2026-12', category: '点心', group: '包点', code: 'A', quantity: 40 },
      { kind: 'base-sku', month: '2026-12', category: '点心', group: '包点', code: 'A', base: '甲', quantity: 15 }
    ]
  }
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(result.adjustmentIssues, [])
  assert.deepEqual(
    result.rows.slice(0, 4).map(row => row.demand),
    [15, 25, 40, 40]
  )
  assert.deepEqual(
    result.rows.slice(0, 4).map(row => row.systemDemand),
    [12, 36, 24, 48]
  )
  assert.ok(result.rows.slice(0, 4).every(row => row.quantityAdjusted))
  assert.equal(
    result.rows.slice(0, 4).reduce((total, row) => total + row.demand, 0),
    120
  )
  sample.categoryDemand[0].quantity = 150
  assert.deepEqual(
    computeMpsWorkflow(sample)
      .rows.slice(0, 4)
      .map(row => row.demand),
    [15, 25, 40, 70]
  )
  sample.adjustments.quantities = []
  computeMpsWorkflow(sample)
    .rows.slice(0, 4)
    .forEach((row, index) => assert.ok(Math.abs(row.demand - [15, 45, 30, 60][index]) < 1e-9))
})

test('数量调整拒绝超父级、重复、缺权重、份额冲突及M+3，尾差不改固定值或零权重', () => {
  const sample = input()
  const edit = { kind: 'sku', month: '2026-12', category: '点心', group: '包点', code: 'A', quantity: 30 }
  for (const quantities of [[{ ...edit, quantity: 121 }], [edit, edit], [{ ...edit, code: '未知' }], [{ ...edit, month: '2027-02' }]]) {
    sample.adjustments = { quantities }
    const result = computeMpsWorkflow(sample)
    assert.ok(result.adjustmentIssues.length > 0)
    assert.ok(result.rows.filter(row => row.month === '2026-12').every(row => !row.quantityAdjusted))
  }
  sample.adjustments = { quantities: [edit] }
  sample.sourceIssues.report = ['读取失败']
  assert.match(computeMpsWorkflow(sample).adjustmentIssues.join(''), /数量调整拒绝/)
  sample.sourceIssues.report = []
  sample.adjustments.shares = [{ rowId: computeMpsWorkflow(input()).rows[0].id, share: 0.3 }]
  assert.match(computeMpsWorkflow(sample).adjustmentIssues.join(''), /冲突/)
  const fractional = input()
  fractional.products.push({ ...fractional.products[0], code: 'C' }, { ...fractional.products[0], code: 'D' })
  fractional.report = fractional.products.map((row, index) => ({ month: '2026-12', base: row.base, code: row.code, quantity: [1, 1, 1, 0][index] }))
  fractional.history = structuredClone(fractional.report)
  fractional.categoryDemand[0].quantity = 1
  fractional.adjustments = { quantities: [{ ...edit, quantity: 0.1 }] }
  const result = computeMpsWorkflow(fractional).rows.filter(row => row.month === '2026-12')
  assert.equal(result[0].demand, 0.1)
  assert.equal(result[3].demand, 0)
  assert.equal(
    result.reduce((sum, row) => sum + row.demand, 0),
    1
  )
})

test('源库存缺项不撤销基地策略，推导缺下月需求与源日均为零分别定位', () => {
  const sample = input()
  sample.constraints.safetyDays = [{ base: '甲', days: 10 }]
  sample.inventoryTargets = [
    { month: '2026-12', base: '甲', code: 'A', version: '纠偏', finalTarget: 100, dailyDemand: 10, sourceRows: 1 },
    { month: '2027-01', base: '甲', code: 'A', version: '月初', finalTarget: 200, dailyDemand: 0, sourceRows: 1 }
  ]
  const result = computeMpsWorkflow(sample)
  const first = result.rows.find(row => row.month === '2026-12' && row.code === 'A')
  assert.equal(first.inventoryTarget.status, 'valid')
  assert.equal(first.inventoryTarget.finalTarget, 100)
  assert.equal(first.inventoryTarget.days, 10)
  assert.equal(first.targetInventory, null)
  assert.deepEqual(first.targetInventoryMissing, ['next-month-demand-missing'])
  const next = result.rows.find(row => row.month === '2027-01' && row.code === 'A')
  assert.equal(next.inventoryTarget.status, 'invalid')
  assert.equal(next.inventoryTarget.finalTarget, 200)
  assert.deepEqual(next.inventoryTarget.missingCodes, ['zero-daily-demand'])
  assert.equal(next.safetyDays, 10)
  assert.ok(!next.targetInventoryMissing.includes('safety-days-missing'))
  assert.ok(next.targetInventoryMissing.includes('next-month-demand-missing'))
  const last = result.rows.find(row => row.month === '2027-02' && row.code === 'A')
  assert.equal(last.inventoryTarget.status, 'missing')
  assert.deepEqual(last.inventoryTarget.missingCodes, ['missing-record'])
  sample.inventoryTargetIssues = ['读取失败']
  const failed = computeMpsWorkflow(sample).rows[0]
  assert.equal(failed.inventoryTarget.status, 'read-failed')
  assert.equal(failed.safetyDays, 10)
})

test('M+2数量编辑进入同一求解结果，首月与后月的原需求及产能上限保持独立', () => {
  const sample = planInput()
  sample.adjustments = { quantities: [{ kind: 'sku', month: '2027-01', category: '点心', group: '包点', code: 'A', quantity: 30 }] }
  const result = solveMpsPlan(sample)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(
    result.rows.filter(row => row.code === 'A').map(row => row.demand),
    [80, 30, 80]
  )
  assert.deepEqual(
    result.rows.filter(row => row.code === 'B').map(row => row.demand),
    [20, 70, 20]
  )
  const next = result.rows.filter(row => row.month === '2027-01')
  assert.ok(Math.abs(next[0].mainPlan - 15) < 1e-6)
  assert.ok(Math.abs(next[1].mainPlan - 35) < 1e-6)
  assert.ok(result.resourceSchedules.every(row => row.scheduledTons <= row.capacity))
})

test('全部下级固定时接受浮点表示尾差，保留每个固定数量', () => {
  const sample = input()
  sample.categoryDemand[0].quantity = 0.3
  sample.adjustments = {
    quantities: [
      { kind: 'sku', month: '2026-12', category: '点心', group: '包点', code: 'A', quantity: 0.1 },
      { kind: 'sku', month: '2026-12', category: '点心', group: '包点', code: 'B', quantity: 0.2 }
    ]
  }
  const result = computeMpsWorkflow(sample)
  assert.deepEqual(result.adjustmentIssues, [])
  assert.deepEqual(
    result.rows.slice(0, 2).map(row => row.demand),
    [0.1, 0.2]
  )
})

test('源值冲突依明确元数据判断，单字段冲突仍保留另一已知源值', () => {
  const source = { month: '2026-12', base: '甲', code: 'A', version: '月初', finalTarget: null, dailyDemand: 10, sourceRows: 2, conflictFields: ['finalTarget'] }
  const result = inventoryTargetIndex([source])(source)
  assert.equal(result.status, 'conflict')
  assert.deepEqual(result.missingCodes, ['conflicting-target'])
  assert.equal(result.dailyDemand, 10)
  assert.equal(result.days, null)
  source.conflictFields = []
  assert.equal(inventoryTargetIndex([source])(source).status, 'invalid')
})

test('产品大类新增和删除同步计算范围，缺需求不隐藏且孤儿需求保留诊断', () => {
  const sample = input()
  sample.products.push({ ...sample.products[0], code: 'C', category: '新品类' })
  sample.categoryDemand.push({ month: '2026-12', category: '已删类', quantity: 500 })
  let result = computeMpsWorkflow(sample)
  assert.deepEqual(
    result.categoryRows.filter(row => row.month === '2026-12').map(row => row.category),
    ['点心', '新品类']
  )
  assert.equal(result.categoryRows.find(row => row.month === '2026-12' && row.category === '新品类').quantity, null)
  assert.deepEqual(
    result.excludedCategoryDemand.map(row => [row.category, row.quantity]),
    [['已删类', 500]]
  )
  assert.match(result.excludedCategoryDemand[0].reason, /产品列表/)
  sample.products = sample.products.filter(row => row.category !== '点心')
  result = computeMpsWorkflow(sample)
  assert.deepEqual([...new Set(result.categoryRows.map(row => row.category))], ['新品类'])
  assert.deepEqual(
    result.excludedCategoryDemand.map(row => row.category),
    ['点心', '已删类']
  )
  sample.adjustments = { categoryDemand: [{ month: '2026-12', category: '点心', quantity: 200 }] }
  assert.match(computeMpsWorkflow(sample).adjustmentIssues.join('、'), /不属于本版月份或分类范围/)
  sample.products = []
  assert.deepEqual(computeMpsWorkflow(sample).categoryRows, [])
})

test('最终目标周转天数读取源字段，独立于库存除日均的诊断值并保留零', () => {
  const source = { month: '2026-12', base: '甲', code: 'A', version: '月初', finalTarget: 120, dailyDemand: 10, finalTurnoverDays: 27, sourceRows: 1 }
  const read = inventoryTargetIndex([source])(source)
  assert.equal(read.days, 12)
  assert.equal(read.finalTurnoverDays, 27)
  assert.equal(inventoryTargetIndex([{ ...source, finalTurnoverDays: 0, dailyDemand: 0 }])(source).finalTurnoverDays, 0)
  assert.equal(inventoryTargetIndex([{ ...source, finalTurnoverDays: 27, conflictFields: ['finalTurnoverDays'] }])(source).finalTurnoverDays, null)
  assert.equal(inventoryTargetIndex([source], 'auto', ['读取失败'])(source).finalTurnoverDays, null)
})

test('同基地SKU各月共用源最终目标周转天数，全缺和冲突转人工补充，不从库存比值填天数', () => {
  const sample = input()
  sample.constraints.safetyDays = []
  sample.categoryDemand = ['2026-12', '2027-01', '2027-02', '2027-03'].map((month, index) => ({ month, category: '点心', quantity: 120 * (index + 1) }))
  sample.inventoryTargets = [{ month: '2027-01', base: '甲', code: 'A', version: '滚动', finalTarget: 120, dailyDemand: 10, finalTurnoverDays: 27, sourceRows: 1 }]
  let result = computeMpsWorkflow(sample)
  const rows = result.rows.filter(row => row.base === '甲' && row.code === 'A')
  assert.equal(rows.length, 3)
  for (const row of rows) {
    assert.equal(row.safetyDays, 27)
    assert.equal(row.safetyDaysSource, 'target-turnover-days')
    assert.deepEqual(row.turnoverPolicy.sourceMonths, ['2027-01'])
    assert.equal(row.targetInventory, (27 * row.nextMonthDemand) / row.nextMonthDays)
  }
  assert.ok(result.rows.filter(row => row.base === '乙').every(row => row.safetyDays === null))
  sample.inventoryTargets.push({ ...sample.inventoryTargets[0], month: '2027-02', finalTurnoverDays: 28 })
  result = computeMpsWorkflow(sample)
  assert.ok(result.rows.filter(row => row.base === '甲').every(row => row.safetyDays === null && row.turnoverPolicy.missing[0].includes('冲突')))
  sample.constraints.turnoverDays = [
    { base: '甲', code: 'A', days: 25 },
    { base: '乙', code: 'B', days: 0 }
  ]
  result = computeMpsWorkflow(sample)
  assert.ok(result.rows.filter(row => row.base === '甲').every(row => row.safetyDays === 25 && row.safetyDaysSource === 'manual-turnover-days'))
  assert.ok(result.rows.filter(row => row.base === '乙').every(row => row.safetyDays === 0 && row.targetInventory === 0))
  sample.inventoryTargets[1].finalTurnoverDays = 27
  assert.ok(
    computeMpsWorkflow(sample)
      .rows.filter(row => row.base === '甲')
      .every(row => row.safetyDays === 27)
  )
})

test('自动库存版本在期间内一致，缺源单品及空天数不混取低优先级版本', () => {
  const source = [
    { month: '2026-11', base: '郑州', code: 'A', version: '月初', finalTarget: 100, dailyDemand: 10, finalTurnoverDays: 10, sourceRows: 1 },
    { month: '2026-11', base: '郑州', code: 'B', version: '滚动', finalTarget: 200, dailyDemand: 10, finalTurnoverDays: 19.333333, sourceRows: 1 },
    { month: '2026-11', base: '华东', code: 'C', version: '月初', finalTarget: 0, dailyDemand: 0, finalTurnoverDays: null, sourceRows: 1 },
    { month: '2026-11', base: '华东', code: 'C', version: '滚动', finalTarget: 110, dailyDemand: 10, finalTurnoverDays: 11, sourceRows: 1 }
  ]
  const resolve = inventoryTargetIndex(source)
  assert.equal(resolve({ month: '2026-11', base: '郑州', code: 'B' }).version, '月初')
  const days = inventoryTurnoverIndex(source, ['2026-11', '2026-12', '2027-01'])
  assert.equal(days({ base: '郑州', code: 'B' }).sourceDays, null)
  assert.equal(days({ base: '华东', code: 'C' }).sourceDays, null)
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], '滚动')({ base: '华东', code: 'C' }).sourceDays, 11)
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], '月初')({ base: '郑州', code: 'B' }).sourceDays, null)
  assert.equal(inventoryTurnoverIndex(source, ['2026-11'], '月初')({ base: '华东', code: 'C' }).sourceDays, null)
  source[2].conflictFields = ['finalTurnoverDays']
  const conflict = inventoryTurnoverIndex(source, ['2026-11'])({ base: '华东', code: 'C' })
  assert.equal(conflict.sourceDays, null)
  assert.ok(conflict.missing[0].includes('冲突'))
})
