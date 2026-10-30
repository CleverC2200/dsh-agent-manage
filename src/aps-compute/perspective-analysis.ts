/** The four V0.2 analysis views use the same evidence and boundary rules as the
 * business prompts. This pure function never fills missing measures with demo data. */
import { sumMetricQuantity, type MetricData } from './metrics.js'
import { productionOutputMetric } from './production-output.js'
export type AnalysisMetric = { name: string; value: number; unit: string; previous?: number | null }
export type AnalysisScope = 'overview' | 'production' | 'sales'
export type AnalysisResult = { title: string; copy: string; score: number; total: number; question: string }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const fmt = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const definitions: Record<string, { scope: AnalysisScope[]; classify: (value: number) => '健康' | '预警' | '严重' | null; target?: number }> = {
  销售预算达成率: { scope: ['overview', 'sales'], classify: v => (v > 95 ? '健康' : v > 90 ? '预警' : '严重'), target: 95 },
  销售提报准确率: { scope: ['sales'], classify: v => (v > 70 ? '健康' : v > 65 ? '预警' : '严重'), target: 70 },
  生产计划达成率: { scope: ['overview', 'production'], classify: v => (v > 99 ? '健康' : v > 95 ? '预警' : '严重'), target: 99 },
  需求预测准确率: { scope: ['production'], classify: v => (v > 80 ? '健康' : v > 75 ? '预警' : '严重'), target: 80 },
  订单满足率: { scope: ['overview', 'production'], classify: v => (v > 95 ? '健康' : v >= 90 ? '预警' : '严重'), target: 95 },
  可发货天数: { scope: ['production'], classify: v => (v > 15 ? '严重' : v >= 12 || v <= 8 ? '预警' : '健康'), target: 12 },
  库存量: { scope: ['overview', 'production'], classify: () => null },
  订单缺货量: { scope: ['production'], classify: () => null }
}
const questions: Record<AnalysisScope, string> = {
  overview: '当前周期订单满足率变化主要集中在哪些基地和品类？',
  production: '当前周期哪个基地或品类对订单履约影响最大？',
  sales: '当前周期哪些销售组织对预算差距贡献最大？'
}
export function analyzePerspective(scope: AnalysisScope, period: string, metrics: AnalysisMetric[]): AnalysisResult {
  const current = metrics.filter(m => finite(m.value) && definitions[m.name]?.scope.includes(scope))
  const evaluable = current.flatMap(m => {
    const level = definitions[m.name].classify(m.value)
    return level ? [{ ...m, level, target: definitions[m.name].target! }] : []
  })
  const score = evaluable.filter(m => m.level === '健康').length
  const ranked = [...evaluable].sort((a, b) => ({ 严重: 0, 预警: 1, 健康: 2 })[a.level] - { 严重: 0, 预警: 1, 健康: 2 }[b.level])
  const focus = ranked.filter(m => m.level !== '健康').slice(0, 2)
  const observations = current.filter(m => definitions[m.name].classify(m.value) === null)
  const parts: string[] = []
  if (evaluable.length) parts.push(`${period}可评价指标${score}/${evaluable.length}项健康`)
  if (focus.length)
    parts.push(
      focus
        .map(m => {
          const gap = m.value - m.target
          const difference = m.unit === '%' ? `${gap >= 0 ? '+' : ''}${fmt(gap)}个百分点` : `${gap >= 0 ? '+' : ''}${fmt(gap)}${m.unit}`
          const trend = finite(m.previous) ? `，较上期${m.value - m.previous >= 0 ? '+' : ''}${fmt(m.value - m.previous)}${m.unit === '%' ? '个百分点' : m.unit}` : ''
          return `${m.name}${fmt(m.value)}${m.unit}（${m.level}，距参考线${difference}${trend}）`
        })
        .join('；')
    )
  else if (evaluable.length) parts.push('已评价指标均处于健康区间')
  if (observations.length) parts.push(observations.map(m => `${m.name}${fmt(m.value)}${m.unit}`).join('、'))
  if (!parts.length) return { title: '当前范围尚无可核实的经营结论', copy: '请以当前业务明细和更新后的指标为准。', score: 0, total: 0, question: questions[scope] }
  const title = focus.length ? `${focus[0].name}值得优先关注` : scope === 'sales' ? '销售指标保持健康' : scope === 'production' ? '生产与订单指标已汇总' : '本期经营指标已汇总'
  const copy = `${parts.join('；')}。${scope === 'production' ? '结合订单需求与库存结构核查影响范围。' : scope === 'sales' ? '结合销售额和预算额核查主要贡献组织。' : '结合业务明细核查主要偏差对象。'}`
  return { title, copy, score, total: evaluable.length, question: questions[scope] }
}
export type MatrixCell = { scope: string; value: number; weight?: number }
export function analyzeProductionMatrix(metric: string, period: string, cells: MatrixCell[]): AnalysisResult {
  const valid = cells.filter(c => c.scope && finite(c.value))
  if (!valid.length)
    return {
      title: `${metric}暂无可评价组合`,
      copy: `${period}当前范围暂无可核实的基地 × 品类${metric}明细；请核对来源读取状态、分类与对应数量，不依据公司汇总推断组合表现。`,
      score: 0,
      total: 0,
      question: '当前周期哪些基地和品类需要优先核查订单履约？'
    }
  const definition = definitions[metric]
  const evaluated = definition ? valid.map(cell => ({ ...cell, level: definition.classify(cell.value) })) : valid.map(cell => ({ ...cell, level: null }))
  const severe = evaluated.filter(cell => cell.level === '严重').length,
    warning = evaluated.filter(cell => cell.level === '预警').length
  const risk = evaluated
    .filter(cell => cell.level === '严重' || cell.level === '预警')
    .sort((a, b) => (a.level === b.level ? (metric === '可发货天数' ? b.value - a.value : a.value - b.value) : a.level === '严重' ? -1 : 1))
  const ranked = risk.length ? risk : [...evaluated].sort((a, b) => (metric === '可发货天数' || metric === '库存量' ? b.value - a.value : a.value - b.value))
  const top = ranked[0],
    unit = metric === '可发货天数' ? '天' : metric === '库存量' || metric === '订单缺货量' ? '万箱' : '%'
  const classText = definition?.classify(top.value) === null ? '库存集中度观察' : `严重${severe}个、预警${warning}个`
  return {
    title: risk.length ? `${top.scope}需要优先关注` : `${metric}组合分布已汇总`,
    copy: `${period}共${valid.length}个${metric === '库存量' ? '可观察' : '可评价'}组合，${classText}。${top.scope}${metric}${fmt(top.value)}${unit}；先核查该组合的需求量、计划量及订单明细，再判断对整体的影响。`,
    score: evaluated.filter(c => c.level === '健康').length,
    total: evaluated.filter(c => c.level !== null).length,
    question: `${period}${top.scope}的${metric}变化与哪些订单或计划记录有关？`
  }
}

/** Matrix cells are recomputed from mutually exclusive base/category source rows. */
export function matrixCellsFromData(data: Pick<MetricData, 'sections' | 'missingValuePolicy'> | null | undefined, metric: string): MatrixCell[] {
  if (!['订单满足率', '可发货天数', '库存量', '生产计划达成率'].includes(metric)) return []
  const source = metric === '订单满足率' ? 'orders' : metric === '生产计划达成率' ? 'production' : metric === '可发货天数' ? 'shippable' : 'stock'
  // An explicit failed shippable source cannot fall back to another section.
  const section = data?.sections.find(s => s.id === source) ?? (source === 'shippable' ? data?.sections.find(s => s.id === 'stock') : undefined)
  if (!section || section.status !== 'ready') return []
  const grouped = new Map<string, Record<string, unknown>[]>()
  for (const row of section.rows) {
    const base = typeof row.base === 'string' ? row.base.trim() : ''
    const category = typeof row.category === 'string' ? row.category.trim() : ''
    if (!base || !category) continue
    const key = `${base} × ${category}`
    const rows = grouped.get(key) ?? []
    rows.push(row)
    grouped.set(key, rows)
  }
  return [...grouped].flatMap(([scope, rows]) => {
    if (metric === '生产计划达成率') {
      const result = productionOutputMetric(rows, data?.missingValuePolicy)
      return result.value === null ? [] : [{ scope, value: result.value }]
    }
    const aggregate = (key: string) => sumMetricQuantity(rows, key, data?.missingValuePolicy)
    const amount = aggregate(metric === '订单满足率' ? 'shortage' : metric === '可发货天数' ? 'available' : 'inventory')
    if (amount === null) return []
    // Inventory does not depend on plan completeness. Ratios follow the same
    // configured policy as headline metrics; failed sources never become zero.
    if (metric === '库存量') return [{ scope, value: amount / 10000 }]
    if (data?.missingValuePolicy !== 'zero' && rows.some(row => finite(row.invalid) && row.invalid !== 0)) return []
    const denominator = aggregate('demand')
    if (denominator === null || denominator <= 0) return []
    return [{ scope, value: metric === '订单满足率' ? (1 - amount / denominator) * 100 : amount / denominator, weight: denominator }]
  })
}
