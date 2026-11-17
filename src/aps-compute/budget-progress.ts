import type { MetricData } from './metrics.js'
import { calendarDay } from './period.js'

export function budgetProgress(data: MetricData | null | undefined, value: number) {
  if (!data || data.granularity !== 'month' || !Number.isFinite(value) || !/^\d{4}-\d{2}-01$/.test(data.start) || data.start.slice(0, 7) !== data.end.slice(0, 7)) return null
  let calendar
  try {
    calendar = calendarDay(data.end)
  } catch {
    return null
  }
  const { day: elapsed, daysInMonth: days } = calendar
  if (elapsed === days) return null
  const target = (elapsed / days) * 100
  return { asOf: data.end, elapsed, days, target, gap: value - target, achieved: value >= target }
}
