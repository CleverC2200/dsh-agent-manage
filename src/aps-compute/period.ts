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

declare const Temporal:
  | undefined
  | {
      PlainDate: {
        from(value: string): {
          day: number
          daysInMonth: number
          subtract(duration: { days: number }): { toString(): string }
        }
      }
    }

export function calendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('业务日期无效')
  if (typeof Temporal !== 'undefined') {
    const date = Temporal.PlainDate.from(value)
    return { day: date.day, daysInMonth: date.daysInMonth, previous: date.subtract({ days: 1 }).toString() }
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw Error('业务日期无效')
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  date.setUTCDate(day - 1)
  return { day, daysInMonth, previous: date.toISOString().slice(0, 10) }
}
