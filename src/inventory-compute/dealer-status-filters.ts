/** Read-only business predicates. Unknown facts remain unknown under exclusion. */
export const statusLabels = {
  fuse_normal: '货龄正常',
  fuse_low: '低风险',
  fuse_high: '高风险',
  fuse_fused: '已熔断',
  fuse_attention: '货龄风险',
  health_urgent: '告急',
  health_healthy: '库存健康',
  health_high: '库存偏高',
  health_slow: '滞销',
  supply_short: '缺货',
  supply_enough: '保障充足',
  stock_reasonable: '合理备货',
  stock_unreasonable: '不合理备货',
  action_attention: '需关注/暂缓',
  action_deferred: '暂缓补货',
  action_cautious: '谨慎补货',
  action_suggested: '有建议补货量',
  action_none: '无建议补货量',
  action_blocked: '不可下单或需确认',
  data_abnormal: '数据异常',
  age_new: '新近货龄',
  age_regular: '常规货龄',
  age_attention: '关注货龄',
  age_old: '长货龄',
  sales_zero: '无动销',
  expiry: '临期/过期'
} as const
export type DealerStatusFilter = {
  code: keyof typeof statusLabels
  exclude: boolean
}
type Row = Record<string, string | number | null | undefined>
type Tri = boolean | null
export type StatusContext = {
  fuse: (row: Row) => string
  health: (days: number | null) => string
  ageBand: (days: number | null) => string
  dataIssues: (row: Row) => boolean
  exception: (row: Row) => boolean
}
export function validStatusFilters(value: unknown): value is DealerStatusFilter[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= 24 &&
      value.every(item => item && typeof item.code === 'string' && Object.hasOwn(statusLabels, item.code) && typeof item.exclude === 'boolean'))
  )
}
export function statusDimension(code: string) {
  return code === 'action_blocked' ? 'eligibility' : code.split('_')[0]
}
export function statusNumber(value: unknown) {
  if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}
export function statusMatches(row: Row, code: DealerStatusFilter['code'], context: StatusContext): Tri {
  if (code === 'action_attention') return ['需核查', '暂缓补货'].includes(rowActionStatus(row, context))
  const value = (key: string) => statusNumber(row[`dealer_plan_order.${key}`])
  if (code.startsWith('fuse_')) {
    const level = context.fuse(row)
    if (!['normal', 'low', 'high', 'fused'].includes(level)) return null
    return code === 'fuse_attention' ? ['low', 'high', 'fused'].includes(level) : code === `fuse_${level}`
  }
  if (code.startsWith('health_')) {
    const level = context.health(value('average_turnover_days'))
    if (!['告急', '健康', '偏高', '滞销'].includes(level)) return null
    return (
      level ===
      (
        {
          health_urgent: '告急',
          health_healthy: '健康',
          health_high: '偏高',
          health_slow: '滞销'
        } as Record<string, string>
      )[code]
    )
  }
  if (code.startsWith('supply_') || code.startsWith('stock_')) {
    const stock = value('stock_qty'),
      transit = value('in_transit_qty')
    if (stock === null || stock < 0 || transit === null || transit < 0) return null
    const available = stock + transit
    if (code.startsWith('supply_')) {
      const sales = value('daily_sales')
      if (sales === null || sales <= 0) return null
      return code === 'supply_short' ? available / sales < 13 : available / sales >= 13
    }
    const target = value('target_inventory')
    if (target === null || target < 0) return null
    return code === 'stock_reasonable' ? available >= target : available < target
  }
  if (code === 'action_deferred' || code === 'action_cautious') {
    const blocked = statusMatches(row, 'action_blocked', context)
    if (blocked === null) return null
    if (blocked) return false
    const stock = value('stock_qty'),
      target = value('target_inventory'),
      qty = value('pre_order_qty')
    if (stock === null || target === null || qty === null) return null
    const aging = String(row['dealer_plan_order.stock_age_turnover_status'] ?? '').trim()
    if (/风险|异常/.test(aging)) return false
    const deferred = qty <= 0 && stock >= target
    return code === 'action_deferred' ? deferred : !aging && !deferred && !(qty > 0 && stock < target)
  }
  if (code === 'action_suggested' || code === 'action_none') {
    const qty = value('pre_order_qty')
    return qty === null || qty < 0 ? null : code === 'action_suggested' ? qty > 0 : qty === 0
  }
  if (code === 'data_abnormal') return context.dataIssues(row)
  if (code === 'action_blocked') {
    if (context.dataIssues(row) || context.exception(row)) return true
    const fuse = context.fuse(row)
    return fuse === 'unknown' ? null : ['high', 'fused'].includes(fuse)
  }
  if (code.startsWith('age_')) {
    const band = context.ageBand(value('average_stock_age'))
    if (!['新近', '常规', '关注', '长货龄'].includes(band)) return null
    return (
      band ===
      (
        {
          age_new: '新近',
          age_regular: '常规',
          age_attention: '关注',
          age_old: '长货龄'
        } as Record<string, string>
      )[code]
    )
  }
  if (code === 'sales_zero') {
    const sales = value('daily_sales')
    return sales === null || sales < 0 ? null : sales === 0
  }
  return null
}
/** Shared with the answer summary: review-needed OR deferred, with guard priority. */
export function rowActionStatus(row: Row, context: StatusContext): string {
  const value = (key: string) => statusNumber(row[`dealer_plan_order.${key}`]) ?? 0
  if (context.dataIssues(row)) return '需核查'
  if (context.exception(row)) return '不可下单'
  const level = context.fuse(row)
  const qty = value('pre_order_qty')
  if (level === 'fused') return '熔断暂停建议'
  if (level === 'high') return qty > 0 ? '高风险需确认' : '需核查'
  const aging = String(row['dealer_plan_order.stock_age_turnover_status'] ?? '').trim()
  if (/风险|异常/.test(aging)) return '需核查'
  if (qty > 0 && value('stock_qty') < value('target_inventory')) return '建议补货'
  if (qty <= 0 && value('stock_qty') >= value('target_inventory')) return '暂缓补货'
  return aging || '谨慎补货'
}
export function evaluateStatusFilters(row: Row, filters: DealerStatusFilter[], context: StatusContext): Tri {
  const groups = new Map<string, Tri[]>()
  for (const item of filters) {
    const key = item.exclude ? `exclude:${item.code}` : statusDimension(item.code)
    const value = statusMatches(row, item.code, context)
    groups.set(key, [...(groups.get(key) ?? []), item.exclude && value !== null ? !value : value])
  }
  const results = [...groups.values()].map(values => (values.includes(true) ? true : values.includes(null) ? null : false))
  return results.includes(false) ? false : results.includes(null) ? null : true
}
export function statusFilterLabel(filters: DealerStatusFilter[]) {
  const groups = new Map<string, string[]>()
  for (const item of filters) {
    const key = item.exclude ? `exclude:${item.code}` : statusDimension(item.code)
    groups.set(key, [...(groups.get(key) ?? []), `${item.exclude ? '排除' : ''}${statusLabels[item.code]}`])
  }
  return [...groups.values()].map(labels => (labels.length > 1 ? `（${labels.join('或')}）` : labels[0])).join('且')
}
