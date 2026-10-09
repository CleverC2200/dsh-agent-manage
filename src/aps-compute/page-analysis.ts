import { deriveMetrics, type MetricData } from './metrics.js'
export const pageAnalysisPolicy = { source: 'current-page', allowAdditionalQueries: false, allowAutomaticRefresh: false, conclusionFirst: true, partialDataAllowed: true } as const
/** Pure analysis of the successful sections already present on this page. */
export function summarizePage(data: MetricData | null | undefined, busy = false, visibleMetrics?: readonly string[]) {
  const empty = { title: busy ? '正在读取经营数据' : '暂无可分析的数据', copy: busy ? '已有数据返回后即生成简报。' : '当前页面暂无可用指标。' }
  if (!data) return empty
  const metrics = deriveMetrics({ ...data, sections: data.sections.filter(s => s.status === 'ready') })
  const names = ['未税销售额', '销售预算达成率', '库存量', '订单满足率', '订单缺货量', '可发货天数', '销售提报准确率', '需求预测准确率', '日发货量']
  const included = visibleMetrics ? names.filter(name => visibleMetrics.includes(name)) : names
  const available = included.map(n => metrics[n]).filter(m => m && m.value !== null && Number.isFinite(m.value))
  if (!available.length) return empty
  const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  const value = (name: string) => (included.includes(name) ? (metrics[name]?.value ?? null) : null)
  const shortage = value('订单缺货量'),
    rate = value('订单满足率'),
    stock = value('库存量'),
    budget = value('销售预算达成率')
  let title = '已有经营数据已汇总',
    action = ''
  if (shortage !== null && shortage > 0) {
    title = '订单仍有缺口，优先核查缺货明细'
    action = stock !== null ? '建议核对缺货品项与可用库存的匹配情况，确认可调拨或补产范围。' : '建议优先核对缺货订单，确认补货与交付安排。'
  } else if (shortage === 0) {
    title = '当前订单无缺货，继续跟踪交付'
  } else if (rate !== null && rate < 100) {
    title = '订单尚未完全满足，需关注履约缺口'
    action = '建议核查未满足订单及交付安排。'
  } else if (budget !== null) {
    title = `销售预算已完成${format(budget)}%`
  } else if (stock !== null) {
    title = `当前库存${format(stock)}万件，需结合需求评估`
  } else {
    const first = available[0]
    title = `${first.name}${format(first.value!)}${first.unit}`
  }
  const evidence = available.map(m => `${m.name}${format(m.value!)}${m.unit}`).join('，')
  return { title, copy: `截至${data.end}，${evidence}。${action}` }
}
