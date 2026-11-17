import type { MpsProduct, MpsQuantity, MpsQuantityRow } from './workflow.ts'

export interface MpsHistoryPeriod {
  month: string
  status: 'ready' | 'partial' | 'failed' | 'unread'
  rows: MpsQuantityRow[]
  issues: string[]
}
export interface MpsHistoryMonth {
  month: string
  status: MpsHistoryPeriod['status']
  ownQuantity: MpsQuantity
  referenceQuantity: MpsQuantity
  quantity: MpsQuantity
  reasons: string[]
}
export interface MpsHistoryAudit {
  zeroFilled: boolean
  sourceStatus: MpsHistoryPeriod['status']
  reasons: string[]
  classification: '正常历史' | '疑似新品或重新上市' | '短期断档数据异常' | '来源异常或其他历史异常'
  months: MpsHistoryMonth[]
}
const valid = (value: MpsQuantity): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
export function completeHistoryMonths(month: string, asOfMonth = month) {
  const end = month < asOfMonth ? month : asOfMonth
  return Array.from({ length: 24 }, (_, i) => {
    const date = new Date(`${end}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - i - 1)
    return date.toISOString().slice(0, 7)
  })
}
export function historyClassification(month: string, periods: MpsHistoryPeriod[] = [], asOfMonth?: string) {
  const indexed = new Map(periods.map(period => [period.month, { ...period, indexed: new Map<string, MpsQuantityRow[]>() }]))
  for (const period of indexed.values())
    for (const row of period.rows) {
      const key = JSON.stringify([row.base, row.code])
      period.indexed.set(key, [...(period.indexed.get(key) ?? []), row])
    }
  const months = completeHistoryMonths(month, asOfMonth)
  const cached = new Map<string, Pick<MpsHistoryAudit, 'classification' | 'months'>>()
  return (product: MpsProduct): Pick<MpsHistoryAudit, 'classification' | 'months'> => {
    const key = JSON.stringify([product.base, product.code, product.historyCode, product.historyFactor])
    const previous = cached.get(key)
    if (previous) return previous
    const replacement = Boolean(product.historyCode && product.historyCode !== product.code)
    const factor = product.historyFactor === undefined ? 1 : product.historyFactor
    const read = (period: ReturnType<typeof indexed.get>, code: string) => {
      const rows = period?.indexed.get(JSON.stringify([product.base, code])) ?? []
      if (!period || period.status === 'failed' || period.status === 'unread') return null
      if (!rows.length && period.status !== 'ready') return null
      if (!rows.every(row => valid(row.quantity))) return null
      const value = rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0)
      return valid(value) ? value : null
    }
    const window = months.map(month => {
      const period = indexed.get(month)
      const ownQuantity = read(period, product.code)
      const referenceQuantity = replacement ? read(period, product.historyCode || product.code) : null
      const quantity =
        ownQuantity !== null && (!replacement || (referenceQuantity !== null && valid(factor))) ? ownQuantity + (replacement ? (referenceQuantity ?? 0) * (factor ?? 0) : 0) : null
      const reasons = [
        ...(period?.issues ?? []),
        ...(!period ? ['完整历史月尚未读取'] : period.status !== 'ready' ? ['历史读取失败或不完整'] : []),
        ...(period?.status === 'ready' && !valid(quantity) ? ['历史数量或替换系数缺失、冲突或无效'] : [])
      ]
      return { month, status: period?.status ?? 'unread', ownQuantity, referenceQuantity, quantity: valid(quantity) ? quantity : null, reasons }
    })
    const complete = window.every(row => row.status === 'ready' && row.quantity !== null && !row.reasons.length)
    const gap = window.findIndex(row => row.quantity !== 0)
    let classification: MpsHistoryAudit['classification'] = '正常历史'
    if (!complete) classification = '来源异常或其他历史异常'
    else if (window.slice(0, 12).every(row => row.quantity === 0)) classification = '疑似新品或重新上市'
    else if (gap >= 1 && gap <= 2 && (window[gap].quantity ?? 0) > 0) classification = '短期断档数据异常'
    else if (window[0].quantity === 0) classification = '来源异常或其他历史异常'
    const result = { classification, months: window } satisfies Pick<MpsHistoryAudit, 'classification' | 'months'>
    cached.set(key, result)
    return result
  }
}
