import type { MpsQuantity } from './workflow.ts'

export interface MpsCategoryDemandInput {
  month: string
  pull: 'monthly' | 'adjust'
  categories: string[]
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
        return {
          month: period,
          quantity,
          priorYearQuantity: complete ? sum(rows.map(row => row.priorYearQuantity)) : null,
          priorMonthQuantity: complete ? sum(rows.map(row => row.priorMonthQuantity)) : null,
          annualQuantity: complete && annual.length === 1 && rows.every(row => row.fiscalYear) && new Set(rows.map(row => row.fiscalYear)).size === 1 ? (annual[0] ?? null) : null
        }
      })
      return {
        category,
        month,
        years,
        yoy: mean(years.map(year => divide(year.quantity, year.priorYearQuantity))),
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
    let previous: MpsQuantity = null
    return Array.from({ length: 4 }, (_, index) => {
      const month = offset(input.month, index)
      const factors = historical.find(row => row.category === category && row.month === month)
      let chain: MpsQuantity = 1
      let momMethod: MpsQuantity = null
      let shareMethod: MpsQuantity = null
      let weighted: MpsQuantity = null
      let quantity: MpsQuantity = null
      if (index < 2) {
        for (let period = offset(end, 1); period <= month; period = offset(period, 1))
          chain = multiply(chain, historical.find(row => row.category === category && row.month === period)?.mom ?? null)
        momMethod = multiply(basis.baseActual, chain)
        shareMethod = multiply(basis.annualEstimate, factors?.share ?? null)
        weighted = divide(sum([momMethod, shareMethod]), 2)
        quantity = divide(weighted, basis.achievementRate)
      } else {
        const amount = (period: string) => {
          const values = input.annual.filter(row => row.month === period && row.category === category)
          return values.length === 1 ? (values[0]?.quantity ?? null) : null
        }
        chain = divide(amount(month), amount(offset(month, -1)))
        quantity = multiply(previous, chain)
        momMethod = quantity
      }
      previous = quantity
      return {
        category,
        month,
        mom: index < 2 ? (factors?.mom ?? null) : null,
        chain,
        momMethod,
        share: index < 2 ? (factors?.share ?? null) : null,
        shareMethod,
        weighted,
        quantity,
        method: index < 2 ? '两法平均后除计划达成率' : '上月需求×年度分月环比'
      }
    })
  })
  return { month: input.month, endMonth: end, recent, historical, bases, rows }
}
