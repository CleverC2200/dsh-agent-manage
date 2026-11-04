export type MpsInventoryVersion = 'auto' | '纠偏' | '月初' | '滚动'
export interface MpsInventoryTarget {
  month: string
  base: string
  code: string
  version: string
  finalTarget: number | null
  dailyDemand: number | null
  sourceRows: number
}
export interface MpsInventoryTargetResult {
  month: string
  base: string
  code: string
  version: string
  finalTarget: number | null
  dailyDemand: number | null
  days: number | null
  missing: string[]
}
const priority = ['纠偏', '月初', '滚动']
const key = (row: { month: string; base: string; code: string }) => JSON.stringify([row.month, row.base, row.code])
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
export function inventoryTargetIndex(source: MpsInventoryTarget[], version: MpsInventoryVersion = 'auto', issues: string[] = []) {
  const versions = new Map<string, string>()
  for (const row of source) {
    if (!priority.includes(row.version)) continue
    const period = JSON.stringify([row.month, row.base])
    const current = versions.get(period)
    if (!current || priority.indexOf(row.version) < priority.indexOf(current)) versions.set(period, row.version)
  }
  const selected = source.filter(row => row.version === (version === 'auto' ? versions.get(JSON.stringify([row.month, row.base])) : version))
  const index = new Map<string, MpsInventoryTarget[]>()
  for (const row of selected) index.set(key(row), [...(index.get(key(row)) ?? []), row])
  return (product: { month: string; base: string; code: string }): MpsInventoryTargetResult => {
    const effectiveVersion = version === 'auto' ? (versions.get(JSON.stringify([product.month, product.base])) ?? '') : version
    const rows = index.get(key(product)) ?? []
    const row = rows.length === 1 && Number.isSafeInteger(rows[0].sourceRows) && rows[0].sourceRows > 0 ? rows[0] : undefined
    const missing = [...issues]
    if (!issues.length) {
      if (!rows.length) missing.push(`缺${effectiveVersion || '可用版本'}目标记录`)
      else if (!row) missing.push('同基地、单品、月份和版本的目标记录重复')
      else {
        if (!valid(row.finalTarget)) missing.push('最终目标库存缺失、无效或同键值冲突')
        if (!valid(row.dailyDemand) || row.dailyDemand <= 0) missing.push('日均计划需求缺失、无效、同键值冲突或为0')
      }
    }
    const ratio = !missing.length && row && valid(row.finalTarget) && valid(row.dailyDemand) && row.dailyDemand > 0 ? row.finalTarget / row.dailyDemand : null
    if (ratio !== null && (!Number.isFinite(ratio) || ratio > Number.MAX_SAFE_INTEGER)) missing.push('目标周转天数超出有效范围')
    return {
      ...product,
      version: effectiveVersion,
      finalTarget: issues.length ? null : (row?.finalTarget ?? null),
      dailyDemand: issues.length ? null : (row?.dailyDemand ?? null),
      days: missing.length ? null : ratio,
      missing
    }
  }
}
