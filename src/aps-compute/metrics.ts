import { productionOutputMetric } from './production-output.js'

type Row = Record<string, unknown>
export type Metric = { name: string; value: number | null; unit: string; note: string; detail?: string }
export type MetricData = { start: string; end: string; granularity: string; missingValuePolicy?: 'zero'; sections: { id: string; status: string; rows: Row[] }[] }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
function sum(rows: Row[], key: string) {
  return rows.length && rows.every(r => finite(r[key])) ? rows.reduce((n, r) => n + (r[key] as number), 0) : null
}
/** Shared quantity aggregation for headline and dimensional metrics. */
export function sumMetricQuantity(rows: Row[], key: string, missingValuePolicy?: 'zero') {
  if (missingValuePolicy !== 'zero') return sum(rows, key)
  if (!rows.length || rows.some(row => row[key] != null && !finite(row[key]))) return null
  return rows.reduce((total, row) => total + (row[key] == null ? 0 : (row[key] as number)), 0)
}
const missing = (rows: Row[], key: string) => rows.reduce((n, r) => n + (finite(r[key]) ? r[key] : 0), 0)
export function accuracy(planned: number | null, actual: number | null) {
  return planned !== null && actual !== null && planned >= 0 && actual > 0 ? (1 - Math.abs(planned - actual) / actual) * 100 : null
}
export function change(current: Metric, previous?: Metric) {
  if (current.value === null || !previous || previous.value === null) return '-'
  if (current.unit === '%') return `${current.value - previous.value >= 0 ? '+' : ''}${(current.value - previous.value).toFixed(2)}个百分点`
  if (previous.value === 0) return '-'
  const value = ((current.value - previous.value) / Math.abs(previous.value)) * 100
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}
export function deriveMetrics(data: MetricData): Record<string, Metric> {
  const zero = data.missingValuePolicy === 'zero'
  const sumValues = sum
  const aggregate = (rows: Row[], key: string) => sumMetricQuantity(rows, key, data.missingValuePolicy)
  const get = (id: string) => {
    const section = data.sections.find(s => s.id === id)
    if (zero && section?.status === 'empty') return [{}]
    return section?.status === 'ready' ? section.rows : []
  }
  const stock = get('stock'),
    forecast = get('forecast'),
    execution = get('execution'),
    orders = get('orders')
  const result: Record<string, Metric> = {}
  const put = (name: string, value: number | null, unit: string, note: string) => (result[name] = { name, value, unit, note })
  const needed = missing(stock, 'missing_demand'),
    demand = aggregate(stock, 'demand'),
    inventory = aggregate(stock, 'inventory')
  put(
    '计划库存支撑天数',
    (zero || !needed) && inventory !== null && demand !== null && demand > 0 ? inventory / demand : null,
    '天',
    needed ? `${needed}条日均需求为空或为负；零需求保留为零，不当作缺失` : '基地库存 ÷ 计划日均需求；总需求为零时不计算'
  )
  const absent = missing(forecast, 'missing_predicted')
  put(
    '预测量',
    !zero && absent ? null : aggregate(forecast, 'predicted') === null ? null : aggregate(forecast, 'predicted')! / 10000,
    '万箱',
    absent ? `${absent}条预测量缺失，已知部分不冒充完整合计` : '所选月份、所选版本的完整月度预测量（不按日摊分）'
  )
  const expectedMonths = (Number(data.end.slice(0, 4)) - Number(data.start.slice(0, 4))) * 12 + Number(data.end.slice(5, 7)) - Number(data.start.slice(5, 7)) + 1
  const monthlyRows = (rows: Row[]) =>
    [...new Set(rows.map(r => String(r.month ?? '')))]
      .filter(Boolean)
      .sort()
      .map(month => rows.filter(r => String(r.month ?? '') === month))
  const officialRate = (id: string) => {
    const groups = monthlyRows(get(id))
    if (groups.length !== expectedMonths) return null
    const rates = groups.map(rows => {
      const initial = aggregate(rows, 'initial_plan'),
        adjusted = aggregate(rows, 'adjusted_plan'),
        initialDeviation = aggregate(rows, 'initial_deviation'),
        adjustedDeviation = aggregate(rows, 'adjusted_deviation')
      return (!zero && missing(rows, 'invalid')) || !initial || initial < 0 || !adjusted || adjusted < 0 || initialDeviation === null || adjustedDeviation === null
        ? null
        : ((1 - initialDeviation / initial + (1 - adjustedDeviation / adjusted)) / 2) * 100
    })
    return rates.every(finite) ? rates.reduce((total, value) => total + value, 0) / rates.length : null
  }
  const accuracyGap = (id: string) => {
    const rows = get(id)
    const issues: string[] = []
    const invalid = missing(rows, 'invalid')
    if (invalid) issues.push(`${invalid}条基础数量缺失或异常`)
    const groups = monthlyRows(rows)
    if (groups.length && groups.some(group => aggregate(group, 'adjusted_plan') === 0)) issues.push('调整计划合计为0，调整准确率和达成率缺少有效分母')
    if (groups.length && groups.some(group => aggregate(group, 'initial_plan') === 0)) issues.push('初始计划合计为0，初始准确率缺少有效分母')
    return issues.length ? '；' + issues.join('；') : ''
  }
  const attainmentRate = (id: string) => {
    const rows = get(id),
      plan = aggregate(rows, 'adjusted_plan'),
      actual = aggregate(rows, 'actual')
    return expectedMonths === 1 &&
      new Set(rows.map(r => r.month)).size === 1 &&
      (zero || !missing(rows, 'missing_actual')) &&
      plan !== null &&
      plan > 0 &&
      actual !== null &&
      actual >= 0
      ? (actual / plan) * 100
      : null
  }
  // The demand plan has different SKU replacement keys from the accuracy fact.
  // Never join those rows to calculate absolute deviations. Only reuse separately
  // aggregated base/month totals when the initial plan reconciles in every base.
  const demandPlanFallback = () => {
    if (!zero || expectedMonths !== 1 || data.granularity !== 'month') return null
    const facts = get('demand-accuracy')
    const plans = get('plans')
    if (!facts.length || !plans.length || aggregate(facts, 'adjusted_plan') !== 0) return null
    const month = data.start.slice(0, 7).replace('-', '')
    if (
      [...facts, ...plans].some(
        row =>
          String(row.month ?? '')
            .replaceAll('-', '')
            .slice(0, 6) !== month
      )
    )
      return null
    const baseKey = (row: Row) => String(row.base ?? '')
    const bases = new Set([...facts, ...plans].map(baseKey))
    let adjusted = 0
    for (const base of bases) {
      const f = facts.filter(row => baseKey(row) === base)
      const p = plans.filter(row => baseKey(row) === base)
      const initial = aggregate(f, 'initial_plan') ?? (f.length ? null : 0)
      const sourceInitial = sumValues(p, 'demand_initial_plan') ?? (p.length ? null : 0)
      const sourceAdjusted = sumValues(p, 'demand_adjusted_plan') ?? (p.length ? null : 0)
      // A zero-only unassigned group adds nothing. Nonzero unassigned quantities
      // or missing/partially returned plan fields cannot establish an equal scope.
      if (
        initial === null ||
        sourceInitial === null ||
        sourceAdjusted === null ||
        initial < 0 ||
        sourceInitial < 0 ||
        sourceAdjusted < 0 ||
        Math.abs(initial - sourceInitial) > 0.00001 ||
        (!base && (initial !== 0 || sourceAdjusted !== 0))
      )
        return null
      adjusted += sourceAdjusted
    }
    const actual = aggregate(facts, 'actual')
    if (!(aggregate(facts, 'initial_plan')! > 0) || adjusted <= 0 || actual === null || actual < 0) return null
    return { value: (actual / adjusted) * 100, actual, adjusted }
  }
  const demandFallback = demandPlanFallback()
  put(
    '销售提报准确率',
    officialRate('sales-accuracy'),
    '%',
    '指定销售准确率表：初始与调整偏差量分别汇总÷对应计划量，两种准确率取均值；非行百分比平均，月中为源累计状态' + accuracyGap('sales-accuracy')
  )
  put('销售提报达成率', attainmentRate('sales-accuracy'), '%', '月度截止日实际发货量 ÷ 月度销售提报量 × 100%；健康阈值随截止日动态变化。飞书仅确认月度口径，年度不擅自推导')
  put(
    '需求预测准确率',
    officialRate('demand-accuracy'),
    '%',
    '指定需求准确率表：初始与调整偏差量分别汇总÷对应计划量，两种准确率取均值；源表为空时保持缺失，不以其他预测数据替代' + accuracyGap('demand-accuracy')
  )
  put(
    '需求预测达成率',
    attainmentRate('demand-accuracy') ?? demandFallback?.value ?? null,
    '%',
    '月度截止日实际发货量 ÷ 月底需求预测量 × 100%；健康阈值随截止日动态变化。飞书仅确认月度口径，年度不擅自推导' + accuracyGap('demand-accuracy')
  )
  const deliveries = get('delivery-daily')
  put(
    '日发货量',
    !zero && missing(deliveries, 'missing_qty') ? null : aggregate(deliveries, 'actual') === null ? null : aggregate(deliveries, 'actual')! / 10000,
    '万箱',
    '按实际发货日的 act_dl_qty 汇总；不与 act_dl_qty_all 相加'
  )
  put(
    '日发货未税金额',
    !zero && missing(deliveries, 'missing_income') ? null : aggregate(deliveries, 'income') === null ? null : aggregate(deliveries, 'income')! / 10000,
    '万元',
    '日发货源未税金额，与财务月度未税收入为不同来源，不混加'
  )
  put('库存量', inventory === null ? null : inventory / 10000, '万箱', '基地库存，所选版本与截止日前最新快照')
  const invalid = missing(orders, 'invalid'),
    need = aggregate(orders, 'demand'),
    shortage = aggregate(orders, 'shortage')
  put('订单缺货量', (!zero && invalid) || shortage === null ? null : shortage / 10000, '万箱', invalid ? '订单存在缺失或异常字段' : '订单业务日期范围内最新快照缺货量')
  put('订单满足率', (zero || !invalid) && need !== null && need > 0 && shortage !== null ? (1 - shortage / need) * 100 : null, '%', '1 − 缺货量 / 需求量；缺失或需求为零时不计算')
  for (const [name, field] of [
    ['客户计划量', 'planned'],
    ['客户实际发货量', 'actual']
  ])
    put(
      name,
      (!zero && missing(execution, 'invalid')) || aggregate(execution, field) === null ? null : aggregate(execution, field)! / 10000,
      '万箱',
      '按所选业务日期的计划执行记录汇总'
    )
  const finance = get('finance'),
    budget = get('sales-budget')
  const income = !zero && missing(finance, 'invalid') ? null : aggregate(finance, 'actual')
  const months = (rows: Row[]) => new Set(rows.map(r => r.month)).size === expectedMonths
  const financeOk = months(finance) && months(budget)
  const monthlyBudgetRates = monthlyRows(finance).map(financeRows => {
    const month = String(financeRows[0]?.month ?? ''),
      budgetRows = budget.filter(row => String(row.month ?? '') === month)
    const actual = !zero && missing(financeRows, 'invalid') ? null : aggregate(financeRows, 'actual'),
      target = !zero && missing(budgetRows, 'invalid') ? null : aggregate(budgetRows, 'budget')
    return actual !== null && target !== null && target > 0 ? (actual / target) * 100 : null
  })
  const budgetAchievement =
    financeOk && monthlyBudgetRates.length === expectedMonths && monthlyBudgetRates.every(finite)
      ? monthlyBudgetRates.reduce((total, value) => total + value, 0) / monthlyBudgetRates.length
      : null
  put('未税销售额', income !== null && months(finance) ? income / 10000 : null, '万元', '财务未税本币收入；按源更新时间的月度累计金额')
  put(
    '销售预算达成率',
    budgetAchievement,
    '%',
    finance.some(row => row.source_basis === 'MONTHLY_BUDGET_UNTAXED_INCOME')
      ? '客户SKU月度预算与实际发货日未税本币收入分别汇总；月度为完整未税收入 ÷ 完整月度预算，年度按月度达成率平均。公司范围、同月截止快照；不分配至未确认基地和销售组织，缺失值不补零。匹配范围观察不参与完整指标、健康判断和跨期比较'
      : '月度为未税本币销售额 ÷ 同月份、同组织完整月度预算 × 100%；年度按月度达成率取平均。仅支持完整历史月份或今天截止的月/年，日周及历史月中不计算'
  )
  const production = data.sections.find(section => section.id === 'production')
  const productionMetric = productionOutputMetric(production?.status === 'ready' ? production.rows : [], data.missingValuePolicy)
  put('生产计划达成率', productionMetric.value, '%', productionMetric.note)
  const supply = get('shippable'),
    available = aggregate(supply, 'available'),
    daily = aggregate(supply, 'demand')
  put(
    '可发货天数',
    (zero || !missing(supply, 'invalid')) && available !== null && daily !== null && daily > 0 ? available / daily : null,
    '天',
    '基地可用库存 ÷ 同范围计划日均需求' + (missing(supply, 'invalid') ? `；${missing(supply, 'invalid')}条可用库存或计划需求缺失、异常` : '')
  )
  if (zero) {
    const formulas: Record<string, string> = {
      计划库存支撑天数: '基地库存合计 ÷ 计划日均需求合计',
      预测量: '所选月度预测数量合计',
      销售提报准确率: '初始和调整阶段分别按汇总偏差量计算准确率，再取两阶段平均',
      需求预测准确率: '初始和调整阶段分别按汇总偏差量计算准确率，再取两阶段平均',
      销售提报达成率: '月度实际发货量合计 ÷ 月度销售提报量合计',
      需求预测达成率: '月度实际发货量合计 ÷ 月底需求预测量合计',
      订单缺货量: '订单业务日期范围内最新快照缺货量合计',
      订单满足率: '1 − 缺货量合计 ÷ 需求量合计',
      客户计划量: '所选业务期间计划数量合计',
      客户实际发货量: '所选业务期间实际发货数量合计',
      未税销售额: '所选月份未税收入合计',
      销售预算达成率: '月度未税收入合计 ÷ 月度预算合计；年度按月度达成率平均，不按客户SKU交集缩小范围',
      可发货天数: '基地可用库存合计 ÷ 计划日均需求合计'
    }
    for (const metric of Object.values(result)) metric.note = (formulas[metric.name] ?? metric.note) + '；缺失数值按0计算，保留已有数值；分母为0时不计算比例，查询失败不补0'
  }
  if (demandFallback) {
    const detail = `基地月初计划已逐基地核对一致；实际发货 ${(demandFallback.actual / 10000).toFixed(2)} 万箱 ÷ 计划表纠偏需求 ${(demandFallback.adjusted / 10000).toFixed(2)} 万箱。仅用于公司／基地月度达成率，不用于逐SKU准确率。`
    result['需求预测达成率'].detail = detail
    result['需求预测达成率'].note += '；' + detail
  }
  if (result['需求预测准确率'].value === null && expectedMonths === 1) {
    const rows = get('demand-accuracy')
    const initial = aggregate(rows, 'initial_plan'),
      deviation = aggregate(rows, 'initial_deviation')
    if (aggregate(rows, 'adjusted_plan') === 0 && initial !== null && initial > 0 && deviation !== null) {
      const detail = `月初阶段准确率 ${((1 - deviation / initial) * 100).toFixed(2)}%；基地准确率源表纠偏计划合计为0，缺少可核对的逐SKU纠偏偏差，暂不能计算两阶段综合准确率。`
      result['需求预测准确率'].detail = detail
      result['需求预测准确率'].note += '；' + detail
    }
  }
  for (const section of data.sections)
    if (section.status === 'error') {
      const names: Record<string, string[]> = {
        'sales-accuracy': ['销售提报准确率', '销售提报达成率'],
        'demand-accuracy': ['需求预测准确率', '需求预测达成率'],
        'delivery-daily': ['日发货量', '日发货未税金额'],
        finance: ['未税销售额', '销售预算达成率'],
        'sales-budget': ['销售预算达成率'],
        shippable: ['可发货天数'],
        stock: ['库存量', '计划库存支撑天数'],
        forecast: ['预测量'],
        execution: ['客户计划量', '客户实际发货量'],
        orders: ['订单缺货量', '订单满足率'],
        production: ['生产计划达成率']
      }
      for (const name of names[section.id] || []) result[name] = { ...result[name], value: null, note: '相关数据查询失败，请在业务明细中查看错误后重试' }
    }
  return result
}
