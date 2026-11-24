import type { MpsProduct, MpsQuantity, MpsQuantityRow, MpsWorkflowRow } from './workflow.ts'

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
  shareZeroed: boolean
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
export function historyClassification(month: string, periods: MpsHistoryPeriod[], asOfMonth: string | undefined, includes: (row: Pick<MpsProduct, 'base' | 'code'>) => boolean) {
  const indexed = new Map(periods.map(period => [period.month, { ...period, indexed: new Map<string, MpsQuantityRow[]>() }]))
  for (const period of indexed.values())
    for (const row of period.rows) {
      const key = JSON.stringify([row.base, row.code])
      period.indexed.set(key, [...(period.indexed.get(key) ?? []), row])
    }
  const months = completeHistoryMonths(month, asOfMonth)
  const cached = new Map<string, Pick<MpsHistoryAudit, 'classification' | 'months' | 'shareZeroed'>>()
  return (product: MpsProduct): Pick<MpsHistoryAudit, 'classification' | 'months' | 'shareZeroed'> => {
    const key = JSON.stringify([product.base, product.code, product.historyCode, product.historyFactor])
    const previous = cached.get(key)
    if (previous) return previous
    const replacement = Boolean(product.historyCode && product.historyCode !== product.code && includes({ ...product, code: product.historyCode }))
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
    const shareZeroed = window.slice(0, 3).every(row => row.status === 'ready' && row.quantity === 0 && !row.reasons.length)
    const result = { classification, months: window, shareZeroed } satisfies Pick<MpsHistoryAudit, 'classification' | 'months' | 'shareZeroed'>
    cached.set(key, result)
    return result
  }
}

export function applyHistoryZeroShares(groups: Iterable<MpsWorkflowRow[]>, sourceReady: boolean) {
  for (const rows of groups) {
    if (!rows.some(row => row.historyAudit.shareZeroed)) continue
    const groupShare = rows[0].historyLayers.groupShare
    const groupQuantity = rows[0].historyLayers.groupQuantity
    const complete =
      sourceReady &&
      rows.every(
        row =>
          row.historyAudit.months.slice(0, 3).every(month => month.status === 'ready' && month.quantity !== null && !month.reasons.length) &&
          row.historyShare !== null &&
          !(row.historyOwnRows > 0 && row.historyOwnQuantity === null) &&
          !(row.historyReferenceRows > 0 && row.historyReferenceQuantity === null)
      )
    const eligible = rows.filter(row => !row.delisted && !row.historyAudit.shareZeroed && valid(row.historyQuantity) && row.historyQuantity > 0)
    const codes = [...new Set(eligible.map(row => row.code))].map(code => ({
      code,
      quantity: eligible.filter(row => row.code === code).reduce((sum, row) => sum + (row.historyQuantity ?? 0), 0)
    }))
    const top = codes.sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code, 'en'))[0]
    if (!complete || !top || groupShare === null || groupQuantity === null || groupQuantity <= 0) {
      for (const row of rows) {
        row.historyShare = row.historyAudit.shareZeroed ? 0 : null
        row.historyLayers = { ...row.historyLayers, skuShare: null, baseShare: row.historyAudit.shareZeroed ? 0 : null, product: row.historyShare }
        row.missing.historyShare = ['三月零发货历史占比待核：来源不完整或没有合格历史SKU承接组内差额']
      }
      continue
    }
    const remaining = codes.filter(row => row !== top).reduce((sum, row) => sum + row.quantity / groupQuantity, 0)
    const topShare = Math.max(0, 1 - remaining)
    const difference = topShare - top.quantity / groupQuantity
    for (const row of rows) {
      const skuQuantity = codes.find(sku => sku.code === row.code)?.quantity ?? 0
      const skuShare = row.code === top.code ? topShare : skuQuantity / groupQuantity
      const baseShare = eligible.includes(row) && skuQuantity > 0 ? (row.historyQuantity ?? 0) / skuQuantity : 0
      const product = groupShare * skuShare * baseShare
      row.historyLayers = { ...row.historyLayers, skuShare, baseShare, product }
      row.historyShare = product
      if (row.historyAudit.shareZeroed) row.coefficientFallback = [...row.coefficientFallback, '最近三个已结束月确认零发货，历史占比归0']
      if (row.code === top.code && eligible.includes(row))
        row.coefficientFallback = [...row.coefficientFallback, `历史SKU Top1承接组内剩余占比${Number(difference.toPrecision(12))}`]
    }
  }
}
