import { deriveMetrics, type MetricData } from './metrics.js'
export type Scope = { base?: string; category?: string; item?: string; material?: string; region?: string; province?: string; sales_group?: string }
export const metricNames = [
  '销售预算达成率',
  '销售提报准确率',
  '销售提报达成率',
  '需求预测准确率',
  '需求预测达成率',
  '生产计划达成率',
  '订单满足率',
  '订单缺货量',
  '可发货天数',
  '库存量'
] as const
export function scopedData(data: MetricData, scope: Scope): MetricData {
  const entries = Object.entries(scope).filter(([, v]) => v !== undefined)
  const products = !!(scope.item || scope.material)
  const sections = data.sections
    .filter(section => !section.id.endsWith('-products'))
    .map(section => {
      const source = products ? (data.sections.find(s => s.id === `${section.id}-products`) ?? section) : section
      // Unknown classifications may belong to this group; do not report partial totals.
      const incomplete = source.rows.some(
        row => entries.some(([key]) => row[key] == null || row[key] === '') && entries.every(([key, value]) => row[key] == null || row[key] === '' || row[key] === value)
      )
      return {
        ...source,
        id: section.id,
        rows: incomplete && data.missingValuePolicy !== 'zero' ? [] : source.rows.filter(row => entries.every(([key, value]) => row[key] === value))
      }
    })
  return { ...data, sections }
}
export function metricValues(data?: MetricData | null, scope: Scope = {}) {
  const metrics = data ? deriveMetrics(scopedData(data, scope)) : {}
  return Object.assign(Object.fromEntries(metricNames.map(name => [name, metrics[name]?.value ?? NaN])) as Record<(typeof metricNames)[number], number>, {
    __sales: metrics['未税销售额']?.value ?? NaN
  })
}
export function comparisonValues(data?: MetricData | null, previous?: MetricData | null, annual?: MetricData | null, scope: Scope = {}) {
  const now = metricValues(data, scope),
    prev = metricValues(previous, scope),
    same = metricValues(annual, scope)
  return compareSnapshots(now, prev, same)
}
function compareSnapshots(now: ReturnType<typeof metricValues>, prev: ReturnType<typeof metricValues>, same: ReturnType<typeof metricValues>) {
  return Object.fromEntries(
    metricNames.map(name => [
      name,
      {
        current: now[name],
        previous: prev[name],
        same: Number.isFinite(same[name]) ? same[name] : null,
        change: now[name] - prev[name],
        yoy: Number.isFinite(same[name]) ? now[name] - same[name] : null
      }
    ])
  ) as Record<(typeof metricNames)[number], { current: number; previous: number; same: number | null; change: number; yoy: number | null }>
}
export const formatNumber = (value: number | null | undefined, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—')

// Cache only inside one immutable set of query results. A refresh, new period,
// comparison response or identity change creates a new reader and drops old data.
export function createMetricReader(data?: MetricData | null, previous?: MetricData | null, annual?: MetricData | null) {
  const cache = new Map<string, ReturnType<typeof metricValues> & { __comparison: ReturnType<typeof comparisonValues> }>()
  return (scope: Scope = {}) => {
    const key = JSON.stringify(
      Object.entries(scope)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
    )
    let value = cache.get(key)
    if (!value) {
      const now = metricValues(data, scope),
        prev = metricValues(previous, scope),
        same = metricValues(annual, scope)
      value = Object.assign(now, { __comparison: compareSnapshots(now, prev, same) })
      cache.set(key, value)
    }
    return value
  }
}
