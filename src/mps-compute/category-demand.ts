import type { MpsDemandAdjustment, MpsQuantity } from './workflow.ts'

export interface MpsCategoryDemandInput {
  adjustments?: MpsDemandAdjustment[]
  month: string
  pull: 'monthly' | 'adjust'
  categories: string[]
  shipment: { month: string; category: string; quantity: MpsQuantity }[]
  submissions: { month: string; category: string; quantity: MpsQuantity }[]
  historical: {
    month: string
    category: string
    base: string
    quantity: MpsQuantity
    priorYearQuantity: MpsQuantity
    priorMonthQuantity: MpsQuantity
    annualQuantity: MpsQuantity
    fiscalYear: string
    valid: boolean
  }[]
  checks: { month: string; category: string; actual: MpsQuantity; plan: MpsQuantity; complete: boolean }[]
  annual: { month: string; category: string; quantity: MpsQuantity }[]
  festivalMonths?: string[]
}

const offset = (month: string, amount: number) => {
  const date = new Date(month + '-01T00:00:00Z')
  date.setUTCMonth(date.getUTCMonth() + amount)
  return date.toISOString().slice(0, 7)
}
const finite = (value: MpsQuantity): value is number => value !== null && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
const safe = (value: number): MpsQuantity => (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null)
const sum = (values: MpsQuantity[]): MpsQuantity => (values.length && values.every(finite) ? safe(values.reduce((total, value) => total + value, 0)) : null)
const divide = (numerator: MpsQuantity, denominator: MpsQuantity): MpsQuantity =>
  finite(numerator) && finite(denominator) && denominator > 0 ? safe(numerator / denominator) : null
const multiply = (a: MpsQuantity, b: MpsQuantity): MpsQuantity => (finite(a) && finite(b) ? safe(a * b) : null)
const mean = (values: MpsQuantity[]) => (values.length === 3 ? divide(sum(values), 3) : null)
const growthLimit = 10
export function growthAnomaly(rate: MpsQuantity, denominator: MpsQuantity) {
  if (denominator !== null && denominator <= 0) return '基期为零或负数'
  if (rate !== null && Math.abs(rate) > growthLimit) return '增长率超出 ±10'
  return null
}

type PeriodAmounts = { quantity: MpsQuantity; priorMonthQuantity: MpsQuantity; priorYearQuantity: MpsQuantity; annualQuantity: MpsQuantity }

export function computeMpsCategoryDemand(input: MpsCategoryDemandInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw Error('评估月份无效')
  const adjustmentIssues: string[] = []
  const growthAnomalies: {
    category: string
    month: string
    metric: string
    quantity: number
    denominator: number
    rawRate: MpsQuantity
    usedRate: MpsQuantity
    appliedRatio: MpsQuantity
    samples: string[]
    reason: string
    handling: string
  }[] = []
  const resolveGrowth = (
    category: string,
    month: string,
    metric: string,
    current: MpsQuantity,
    previous: MpsQuantity,
    previousAmounts?: (period: string) => [MpsQuantity, MpsQuantity]
  ) => {
    const ratio = divide(current, previous)
    if (current === null || previous === null) return ratio
    const rawRate = previous === 0 ? null : safe((current - previous) / previous)
    const reason = growthAnomaly(rawRate, previous)
    if (!reason) return ratio
    const candidates = previousAmounts
      ? Array.from({ length: 6 }, (_, index) => {
          const period = offset(month, -1 - index)
          const [amount, base] = previousAmounts(period)
          const value = divide(amount, base)
          return value !== null && !growthAnomaly(value - 1, base) ? { period, ratio: value } : null
        })
      : []
    const bothZero = current === 0 && previous === 0
    const recent = candidates.slice(0, 3).filter(entry => entry !== null)
    const available = candidates.filter(entry => entry !== null)
    const samples = recent.length === 3 ? recent : bothZero ? available : available.slice(0, 3)
    const fallback = samples.length >= 3 ? divide(sum(samples.map(entry => entry.ratio)), samples.length) : null
    const direction = Math.sign(rawRate ?? current)
    const usedRate = previousAmounts ? (fallback !== null ? fallback - 1 : direction ? direction * growthLimit : null) : null
    const appliedRatio = usedRate === null ? (previousAmounts && bothZero ? 0 : null) : Math.max(0, usedRate + 1)
    const handling = !previousAmounts
      ? '保留源值供核对'
      : fallback === null
        ? usedRate === null
          ? bothZero
            ? `基期和本期均为0，前六个月仅${samples.length}条有效环比，环比法预测量取0`
            : `前六个月仅${samples.length}条有效环比，且无增长方向，保留待核`
          : `前六个月仅${samples.length}条有效环比，使用同方向界限`
        : recent.length === 3
          ? '使用前三个月有效环比均值'
          : bothZero
            ? '使用前六个月全部有效环比均值'
            : '扩展到前六个月，使用最近三条有效环比均值'
    growthAnomalies.push({
      category,
      month,
      metric,
      quantity: current,
      denominator: previous,
      rawRate,
      usedRate,
      appliedRatio,
      samples: fallback === null ? [] : samples.map(entry => entry.period),
      reason,
      handling: usedRate !== null && usedRate < -1 ? `${handling}，环比法预测量下限为0` : handling
    })
    return previousAmounts ? appliedRatio : ratio
  }
  const end = offset(input.month, input.pull === 'monthly' ? -2 : -1)
  const recent = [-2, -1, 0].map(amount => offset(end, amount))
  const categories = [...new Set(input.categories)]
  const periodKey = (category: string, month: string) => JSON.stringify([category, month])
  const periods = new Map<string, PeriodAmounts>()
  for (const [key, rows] of Map.groupBy(input.historical, row => periodKey(row.category, row.month))) {
    const complete = rows.every(row => row.valid) && new Set(rows.map(row => row.base)).size === rows.length
    const annual = [...new Set(rows.map(row => row.annualQuantity))]
    periods.set(key, {
      quantity: complete ? sum(rows.map(row => row.quantity)) : null,
      priorMonthQuantity: complete ? sum(rows.map(row => row.priorMonthQuantity)) : null,
      priorYearQuantity: complete ? sum(rows.map(row => row.priorYearQuantity)) : null,
      annualQuantity: complete && annual.length === 1 && rows.every(row => row.fiscalYear) && new Set(rows.map(row => row.fiscalYear)).size === 1 ? (annual[0] ?? null) : null
    })
  }
  const historyMonthAmounts = (category: string, month: string): [MpsQuantity, MpsQuantity] => {
    const period = periods.get(periodKey(category, month))
    return [period?.quantity ?? null, period?.priorMonthQuantity ?? null]
  }
  const historical = categories.flatMap(category =>
    Array.from({ length: 8 }, (_, index) => {
      const month = offset(input.month, index - 4)
      const years = [1, 2, 3].map(year => {
        const period = offset(month, -12 * year)
        const rows = input.historical.filter(row => row.category === category && row.month === period)
        const complete = rows.length > 0 && rows.every(row => row.valid) && new Set(rows.map(row => row.base)).size === rows.length
        const amounts = periods.get(periodKey(category, period))
        const quantity = amounts?.quantity ?? null
        const priorYearQuantity = amounts?.priorYearQuantity ?? null
        const excludedReasons = [
          ...(!rows.length ? ['缺历史源记录'] : []),
          ...(rows.some(row => !row.valid) ? ['历史源记录无效'] : []),
          ...(new Set(rows.map(row => row.base)).size !== rows.length ? ['历史基地键重复'] : []),
          ...(!finite(quantity) ? ['同比分子缺失或无效'] : []),
          ...(!finite(priorYearQuantity) ? ['同比分母缺失或无效'] : priorYearQuantity <= 0 ? ['同比分母为0或负数'] : [])
        ]
        const ratio = resolveGrowth(category, period, '同比', quantity, priorYearQuantity)
        const priorMonthQuantity = amounts?.priorMonthQuantity ?? null
        const mom = resolveGrowth(category, period, '历史环比', quantity, priorMonthQuantity, previous => historyMonthAmounts(category, previous))
        if (ratio === null && !excludedReasons.length) excludedReasons.push('同比比值超出有效范围')
        return {
          month: period,
          numeratorMonth: period,
          denominatorMonth: offset(period, -12),
          quantity,
          priorYearQuantity,
          ratio,
          valid: ratio !== null,
          excludedReasons,
          priorMonthQuantity,
          mom,
          annualQuantity: amounts?.annualQuantity ?? null
        }
      })
      const yoyYears = years.filter(year => year.valid)
      return {
        category,
        month,
        years,
        yoyYears: yoyYears.map(year => year.month),
        yoyValidCount: yoyYears.length,
        yoyComplete: yoyYears.length === 3,
        yoy: divide(sum(yoyYears.map(year => year.ratio)), yoyYears.length),
        mom: mean(years.map(year => year.mom)),
        share: mean(years.map(year => divide(year.quantity, year.annualQuantity)))
      }
    })
  )
  const bases = categories.map(category => {
    const checks = recent.map(month => input.checks.filter(row => row.month === month && row.category === category))
    const complete = checks.every(rows => rows.length === 1 && rows[0]?.complete)
    const actual = checks.every(rows => rows.length === 1) ? sum(checks.map(rows => rows[0]?.actual ?? null)) : null
    const plan = complete ? sum(checks.map(rows => rows[0]?.plan ?? null)) : null
    const baseActual = checks[2]?.length === 1 ? (checks[2][0]?.actual ?? null) : null
    const recentShare = sum(recent.map(month => historical.find(row => row.category === category && row.month === month)?.share ?? null))
    return { category, endMonth: end, recent, baseActual, actual, plan, recentShare, annualEstimate: divide(actual, recentShare), achievementRate: divide(actual, plan) }
  })
  const rows = bases.flatMap(basis => {
    const category = basis.category
    const baseMonth = offset(input.month, -1)
    const shipments = input.shipment.filter(row => row.category === category && row.month === baseMonth)
    const shipment = shipments.length === 1 ? (shipments[0]?.quantity ?? null) : null
    let previousMom: MpsQuantity = shipment
    return Array.from({ length: 4 }, (_, index) => {
      const month = offset(input.month, index)
      const factors = historical.find(row => row.category === category && row.month === month)
      let chain: MpsQuantity
      const submissions = input.submissions.filter(row => row.category === category && row.month === month)
      const salesSubmission = index === 0 && submissions.length === 1 ? (submissions[0]?.quantity ?? null) : null
      const salesCorrected = index === 0 ? multiply(salesSubmission, basis.achievementRate) : null
      if (index < 2 || input.festivalMonths?.includes(month)) {
        chain = factors?.mom ?? null
      } else {
        const amount = (period: string) => {
          const values = input.annual.filter(row => row.month === period && row.category === category)
          return values.length === 1 ? (values[0]?.quantity ?? null) : null
        }
        const annualAmounts = (period: string): [MpsQuantity, MpsQuantity] => [amount(period), amount(offset(period, -1))]
        chain = resolveGrowth(category, month, '年度计划环比', ...annualAmounts(month), annualAmounts)
      }
      const momMethod = multiply(previousMom, chain)
      const shareMethod = multiply(basis.annualEstimate, factors?.share ?? null)
      const methodAverage = divide(sum([momMethod, shareMethod]), 2)
      const weighted = index === 0 ? divide(sum([methodAverage, salesCorrected]), 2) : null
      const quantity = index === 0 ? weighted : methodAverage
      const systemQuantity = quantity
      previousMom = momMethod
      const edits = (input.adjustments ?? []).filter(row => row.month === month && row.category === category)
      const adjusted = false
      if (edits.length) adjustmentIssues.push(`${month} ${category} 历史上层修正冲突，未参与计算，请归档后按基地SKU修正`)
      return {
        category,
        month,
        mom: index < 2 || input.festivalMonths?.includes(month) ? (factors?.mom ?? null) : null,
        chain,
        momMethod,
        share: factors?.share ?? null,
        shareMethod,
        methodAverage,
        salesSubmission,
        achievementRate: basis.achievementRate,
        salesCorrected,
        baseMonth,
        shipment,
        weighted,
        quantity,
        systemQuantity,
        adjusted,
        method: index === 0 ? '两法平均与销售提报×达成率各占一半' : '环比测算量与占比测算量各占一半'
      }
    })
  })
  for (const edit of input.adjustments ?? []) {
    if (!rows.some(row => row.month === edit.month && row.category === edit.category)) adjustmentIssues.push('大类需求调整不属于本版月份或分类范围')
  }
  return { adjustmentIssues, growthAnomalies, month: input.month, endMonth: end, recent, historical, bases, rows }
}
