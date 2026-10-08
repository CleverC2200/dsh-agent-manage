export type CalendarDate = { year: number; month: number; day: number; iso: string }

function dateOnly(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12)
}

export function effectivePeriodEnd(year: number, month: number, day: number, today = new Date()): CalendarDate {
  const requested = new Date(year, month - 1, day, 12)
  const current = dateOnly(today)
  const effective = requested > current ? current : requested
  const result = { year: effective.getFullYear(), month: effective.getMonth() + 1, day: effective.getDate() }
  return { ...result, iso: `${result.year}-${String(result.month).padStart(2, '0')}-${String(result.day).padStart(2, '0')}` }
}

export function isFutureCalendarDay(year: number, month: number, day: number, today = new Date()) {
  return new Date(year, month - 1, day, 12) > dateOnly(today)
}
