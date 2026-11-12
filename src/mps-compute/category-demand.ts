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

export function computeMpsCategoryDemand(input: MpsCategoryDemandInput) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw Error('评估月份无效')
  const adjustmentIssues: string[] = []
  const end = offset(input.month, input.pull === 'monthly' ? -2 : -1)
  const recent = [-2, -1, 0].map(amount => offset(end, amount))
  const categories = [...new Set(input.categories)]
  const historical = categories.flatMap(category =>
    Array.from({ length: 6 }, (_, index) => {
      const month = offset(input.month, index - 4)
      const years = [1, 2, 3].map(year => {
        const period = offset(month, -12 * year)
        const rows = input.historical.filter(row => row.category === category && row.month === period)
        const complete = rows.length > 0 && rows.every(row => row.valid) && new Set(rows.map(row => row.base)).size === rows.length
        const annual = [...new Set(rows.map(row => row.annualQuantity))]
        const quantity = complete ? sum(rows.map(row => row.quantity)) : null
        const priorYearQuantity = complete ? sum(rows.map(row => row.priorYearQuantity)) : null
        const excludedReasons = [
          ...(!rows.length ? ['缺历史源记录'] : []),
          ...(rows.some(row => !row.valid) ? ['历史源记录无效'] : []),
          ...(new Set(rows.map(row => row.base)).size !== rows.length ? ['历史基地键重复'] : []),
          ...(!finite(quantity) ? ['同比分子缺失或无效'] : []),
          ...(!finite(priorYearQuantity) ? ['同比分母缺失或无效'] : priorYearQuantity <= 0 ? ['同比分母为0或负数'] : [])
        ]
        const ratio = divide(quantity, priorYearQuantity)
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
          priorMonthQuantity: complete ? sum(rows.map(row => row.priorMonthQuantity)) : null,
          annualQuantity: complete && annual.length === 1 && rows.every(row => row.fiscalYear) && new Set(rows.map(row => row.fiscalYear)).size === 1 ? (annual[0] ?? null) : null
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
        mom: mean(years.map(year => divide(year.quantity, year.priorMonthQuantity))),
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
      let chain: MpsQuantity = 1
      let momMethod: MpsQuantity = null
      let shareMethod: MpsQuantity = null
      let weighted: MpsQuantity = null
      let quantity: MpsQuantity = null
      const submissions = input.submissions.filter(row => row.category === category && row.month === month)
      const salesSubmission = index < 2 && submissions.length === 1 ? (submissions[0]?.quantity ?? null) : null
      const salesCorrected = index < 2 ? multiply(salesSubmission, basis.achievementRate) : null
      let methodAverage: MpsQuantity = null
      if (index < 2) {
        chain = factors?.mom ?? null
        momMethod = multiply(previousMom, chain)
        shareMethod = multiply(basis.annualEstimate, factors?.share ?? null)
        methodAverage = divide(sum([momMethod, shareMethod]), 2)
        weighted = divide(sum([methodAverage, salesCorrected]), 2)
        quantity = weighted
      } else {
        const amount = (period: string) => {
          const values = input.annual.filter(row => row.month === period && row.category === category)
          return values.length === 1 ? (values[0]?.quantity ?? null) : null
        }
        chain = divide(amount(month), amount(offset(month, -1)))
        momMethod = multiply(previousMom, chain)
        quantity = momMethod
      }
      const systemQuantity = quantity
      previousMom = momMethod
      const edits = (input.adjustments ?? []).filter(row => row.month === month && row.category === category)
      const edit = edits[0]
      const adjusted = edits.length === 1 && edit !== undefined && finite(edit.quantity) && edit.quantity >= 0
      if (edits.length && !adjusted) adjustmentIssues.push(`${month} ${category} 大类需求调整无效或重复`)
      if (adjusted) quantity = edit.quantity
      return {
        category,
        month,
        mom: index < 2 ? (factors?.mom ?? null) : null,
        chain,
        momMethod,
        share: index < 2 ? (factors?.share ?? null) : null,
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
        method: index < 2 ? '两法平均与销售提报×达成率各占一半' : '上月环比测算量×年度环比'
      }
    })
  })
  for (const edit of input.adjustments ?? []) {
    if (!rows.some(row => row.month === edit.month && row.category === edit.category)) adjustmentIssues.push('大类需求调整不属于本版月份或分类范围')
  }
  return { adjustmentIssues, month: input.month, endMonth: end, recent, historical, bases, rows }
}
