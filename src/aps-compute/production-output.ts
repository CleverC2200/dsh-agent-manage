type Row = Record<string, unknown>
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Same-period MES quantity contract. No IO, organization assignment or authorization. */
export function productionOutputMetric(rows: Row[], missingValuePolicy?: 'zero') {
  const unavailable = (note: string) => ({ value: null, note })
  if (!rows.length || rows.some(row => row.source_basis !== 'MES_QUANTITY')) return unavailable('当前无同期间、同数量口径的生产计划与实际产出；未来排程不当作生产实绩')
  if (missingValuePolicy === 'zero') {
    if (rows.some(row => [row.planned, row.actual].some(value => value != null && !finite(value)))) return unavailable('MES数量格式无效')
    const planned = rows.reduce((total, row) => total + (row.planned == null ? 0 : (row.planned as number)), 0)
    const actual = rows.reduce((total, row) => total + (row.actual == null ? 0 : (row.actual as number)), 0)
    return planned > 0 && Number.isFinite(planned) && Number.isFinite(actual)
      ? { value: (actual / planned) * 100, note: 'MES实际数量合计 ÷ 计划数量合计；源数值缺失按0，保留已有数值，不用完整行交集替代总量' }
      : unavailable('生产计划量合计为0或无效，不能计算达成率')
  }
  if (
    rows.some(
      row =>
        !finite(row.invalid) ||
        row.invalid !== 0 ||
        !finite(row.records) ||
        !Number.isSafeInteger(row.records) ||
        row.records < 1 ||
        !finite(row.planned) ||
        row.planned < 0 ||
        !finite(row.actual) ||
        row.actual < 0
    )
  )
    return unavailable('MES存在重复业务键、未映射基地、缺失或异常数量，未用已知部分推算完整达成率')
  const planned = rows.reduce((total, row) => total + (row.planned as number), 0)
  const actual = rows.reduce((total, row) => total + (row.actual as number), 0)
  if (!Number.isFinite(planned) || !Number.isFinite(actual) || planned <= 0) return unavailable('所选MES范围计划量为零或无效，生产计划达成率不适用')
  const dates = rows
    .map(row => String(row.source_date ?? ''))
    .filter(Boolean)
    .sort()
  return {
    value: (actual / planned) * 100,
    note: `MES已返回产线的实际产出量 ÷ 同期计划量；数量先汇总再相除，不平均行百分比，不代表外协或未来排程完整覆盖。源业务日截至${dates.at(-1) || '未知'}`
  }
}

/** Valid same-record subset only. Never substitutes the complete metric or its alerts. */
export function productionOutputObservation(rows: Row[]) {
  if (
    !rows.length ||
    rows.some(
      row =>
        row.source_basis !== 'MES_QUANTITY' ||
        !finite(row.records) ||
        !Number.isSafeInteger(row.records) ||
        row.records < 1 ||
        !finite(row.valid_records) ||
        !Number.isSafeInteger(row.valid_records) ||
        row.valid_records < 0 ||
        row.valid_records > row.records ||
        !finite(row.invalid) ||
        !Number.isSafeInteger(row.invalid) ||
        row.invalid < 0 ||
        row.invalid > row.records - row.valid_records ||
        (row.invalid === 0) !== (row.records === row.valid_records)
    )
  )
    return null
  const usable = rows.filter(row => (row.valid_records as number) > 0)
  if (!usable.length || usable.some(row => !finite(row.known_planned) || row.known_planned < 0 || !finite(row.known_actual) || row.known_actual < 0)) return null
  const planned = usable.reduce((sum, row) => sum + (row.known_planned as number), 0)
  const actual = usable.reduce((sum, row) => sum + (row.known_actual as number), 0)
  if (!Number.isFinite(planned) || !Number.isFinite(actual) || planned <= 0) return null
  const count = rows.reduce((sum, row) => sum + (row.valid_records as number), 0)
  const total = rows.reduce((sum, row) => sum + (row.records as number), 0)
  return { value: (actual / planned) * 100, count, total, excluded: total - count }
}
