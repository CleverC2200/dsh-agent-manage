import type { MetricData } from './metrics.js'
import type { Scope } from './adapter.js'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0

/** Display-only customer-SKU intersection. Never substitutes full-company metrics,
 * health judgments or comparisons between independently selected cohorts.
 */
export function budgetPerformanceObservation(data?: MetricData | null, scope: Scope = {}) {
  if (!data || Object.values(scope).some(value => value !== undefined) || !['month', 'year'].includes(data.granularity) || !data.start.endsWith('-01')) return null
  const section = data.sections.find(section => section.id === 'finance')
  if (section?.status !== 'ready' || !section.rows.length) return null
  const months = new Set<string>()
  const first = data.start.slice(0, 7).replace('-', ''),
    last = data.end.slice(0, 7).replace('-', '')
  const expectedMonths = (Number(data.end.slice(0, 4)) - Number(data.start.slice(0, 4))) * 12 + Number(data.end.slice(5, 7)) - Number(data.start.slice(5, 7)) + 1
  if (!Number.isSafeInteger(expectedMonths) || expectedMonths < 1 || expectedMonths > 12) return null
  for (const row of section.rows) {
    const month = String(row.month ?? '')
    if (row.source_basis !== 'MONTHLY_BUDGET_UNTAXED_INCOME' || !/^\d{4}(0[1-9]|1[0-2])$/.test(month) || month < first || month > last || months.has(month)) return null
    months.add(month)
    if (!count(row.budget_keys) || !count(row.income_keys) || !count(row.matched_keys) || row.matched_keys > Math.min(row.budget_keys, row.income_keys)) return null
    if (row.matched_keys > 0 && (!finite(row.matched_budget) || row.matched_budget < 0 || !finite(row.matched_income))) return null
    if (
      row.matched_keys > 0 &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.budget_date)) ||
        String(row.budget_date) > data.end ||
        String(row.budget_date).slice(0, 7).replace('-', '') !== month ||
        !/^\d{8}$/.test(String(row.source_date)) ||
        String(row.source_date) > data.end.replaceAll('-', '') ||
        String(row.source_date).slice(0, 6) !== month)
    )
      return null
  }
  const usable = section.rows.filter(row => (row.matched_keys as number) > 0 && (row.matched_budget as number) > 0)
  if (!usable.length) return null
  const rates = usable.map(row => ((row.matched_income as number) / (row.matched_budget as number)) * 100)
  const sum = (key: string) => usable.reduce((sum, row) => sum + (row[key] as number), 0)
  const result = {
    value: rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
    matchedKeys: sum('matched_keys'),
    budgetKeys: section.rows.reduce((sum, row) => sum + (row.budget_keys as number), 0),
    matchedBudget: sum('matched_budget'),
    matchedIncome: sum('matched_income'),
    monthCount: usable.length,
    expectedMonths,
    sourceDate: usable
      .map(row => String(row.source_date))
      .sort()
      .at(-1)!,
    budgetDate: usable
      .map(row => String(row.budget_date))
      .sort()
      .at(-1)!
  }
  return Object.values(result).every(value => typeof value !== 'number' || Number.isFinite(value)) ? result : null
}
