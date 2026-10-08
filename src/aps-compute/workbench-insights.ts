import type { MetricData } from './metrics.js'

type Row = Record<string, unknown>

export type WorkbenchWarning = {
  id: string
  rank: string
  scope: string
  metric: string
  range: string
  gap: string
  diagnosis: string
  confidence: number
  evidence: string
  trend: string
  dimension: 'category'
}

export type WorkbenchAction = {
  id: string
  rank: string
  trigger: string
  triggerNote: string
  scope: string
  metric: string
  gap: string
  diagnosis: string
  evidence: string
  confidence: number
  owner: string
  due: string
  action: string
  impact: string
  dimension: 'cross'
}

type Fulfillment = { scope: string; demand: number; shortage: number; rate: number }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const quantity = (value: number) => `${(value / 10000).toFixed(2)}万件`
const rate = (value: number) => `${value.toFixed(2)}%`

function rows(data: MetricData | null | undefined, id: string) {
  const section = data?.sections.find(item => item.id === id)
  return section?.status === 'ready' ? section.rows : []
}

function fulfillmentBy(source: Row[], fields: string[]): Fulfillment[] {
  const groups = new Map<string, { demand: number; shortage: number; valid: boolean }>()
  for (const row of source) {
    const scopeValues = fields.map(field => row[field])
    if (scopeValues.some(value => typeof value !== 'string' || !value.trim())) continue
    const key = scopeValues.join(' × ')
    const item = groups.get(key) ?? { demand: 0, shortage: 0, valid: true }
    if (!finite(row.demand) || !finite(row.shortage) || row.demand < 0 || row.shortage < 0 || row.shortage > row.demand || row.invalid !== 0) item.valid = false
    else {
      item.demand += row.demand
      item.shortage += row.shortage
    }
    groups.set(key, item)
  }
  return [...groups.entries()].flatMap(([scope, item]) =>
    item.valid && item.demand > 0 ? [{ scope, demand: item.demand, shortage: item.shortage, rate: (1 - item.shortage / item.demand) * 100 }] : []
  )
}

function comparisonTrend(current: Fulfillment, previous: Map<string, Fulfillment>) {
  const baseline = previous.get(current.scope)
  if (!baseline) return '无可比数据'
  const change = current.rate - baseline.rate
  return `较上期 ${change > 0 ? '+' : ''}${change.toFixed(2)}pp`
}

export function deriveWorkbenchInsights(data?: MetricData | null, previous?: MetricData | null) {
  const currentRows = rows(data, 'orders')
  const previousRows = rows(previous, 'orders')
  const category = fulfillmentBy(currentRows, ['category'])
  const previousCategory = new Map(fulfillmentBy(previousRows, ['category']).map(item => [item.scope, item]))
  const cross = fulfillmentBy(currentRows, ['base', 'category'])

  const warnings: WorkbenchWarning[] = category
    .filter(item => item.rate >= 90 && item.rate < 95)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 2)
    .map((item, index) => ({
      id: `live-warning-${encodeURIComponent(item.scope)}`,
      rank: String(index + 1).padStart(2, '0'),
      scope: `${item.scope}品类`,
      metric: `订单满足率 ${rate(item.rate)}`,
      range: '预警区间 90%—95%',
      gap: `距95%目标 ${(item.rate - 95).toFixed(2)}pp`,
      diagnosis: `本期订单需求${quantity(item.demand)}，缺货${quantity(item.shortage)}，订单满足率处于页面既定观察区间。`,
      confidence: Number.NaN,
      evidence: '业务库订单履约数据',
      trend: comparisonTrend(item, previousCategory),
      dimension: 'category'
    }))

  const actions: WorkbenchAction[] = cross
    .filter(item => item.rate < 90)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 3)
    .map((item, index) => {
      const base = item.scope.split(' × ')[0]
      return {
        id: `live-action-${encodeURIComponent(item.scope)}`,
        rank: String(index + 1).padStart(2, '0'),
        trigger: '严重指标',
        triggerNote: '订单满足率低于90%',
        scope: item.scope,
        metric: `订单满足率 ${rate(item.rate)}`,
        gap: `低于95%目标 ${(95 - item.rate).toFixed(2)}pp`,
        diagnosis: `本期订单需求${quantity(item.demand)}，缺货${quantity(item.shortage)}；该组合是当前订单履约缺口较大的真实业务范围。`,
        evidence: '业务库订单履约数据',
        confidence: Number.NaN,
        owner: `${base}计划负责人`,
        due: '待业务确认',
        action: '核对缺货订单明细，确认保供、调拨或交期调整方案',
        impact: '恢复至订单满足率目标区间',
        dimension: 'cross'
      }
    })

  return { warnings, actions }
}

/** Full risk list from the same page facts and thresholds as the workbench. */
export function deriveOrderRisks(data: MetricData | null | undefined, dimension: 'category' | 'base' | 'cross') {
  const fields = dimension === 'category' ? ['category'] : dimension === 'base' ? ['base'] : ['base', 'category']
  return fulfillmentBy(rows(data, 'orders'), fields)
    .filter(item => item.rate < 95)
    .sort((a, b) => a.rate - b.rate)
    .map(item => ({ ...item, risk: (item.rate < 90 ? '严重' : '预警') as '严重' | '预警', gap: item.rate - 95 }))
}
