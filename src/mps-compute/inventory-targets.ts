export type MpsInventoryVersion = 'auto' | '纠偏' | '月初' | '滚动'
export interface MpsInventoryTarget {
  month: string
  base: string
  code: string
  version: string
  finalTarget: number | null
  dailyDemand: number | null
  finalTurnoverDays?: number | null
  sourceRows: number
  conflictFields?: ('finalTarget' | 'dailyDemand' | 'finalTurnoverDays')[]
}
export interface MpsInventoryTargetResult {
  status: 'valid' | 'missing' | 'invalid' | 'conflict' | 'read-failed'
  missingCodes: (
    | 'read-failed'
    | 'missing-record'
    | 'missing-selected-version'
    | 'duplicate-key'
    | 'conflicting-target'
    | 'conflicting-daily-demand'
    | 'invalid-target'
    | 'invalid-daily-demand'
    | 'zero-daily-demand'
    | 'invalid-days'
  )[]
  conflictFields: NonNullable<MpsInventoryTarget['conflictFields']>
  month: string
  base: string
  code: string
  version: string
  finalTarget: number | null
  dailyDemand: number | null
  days: number | null
  finalTurnoverDays: number | null
  missing: string[]
}
const priority = ['纠偏', '月初', '滚动']
const key = (row: { month: string; base: string; code: string }) => JSON.stringify([row.month, row.base, row.code])
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
export function inventoryTargetIndex(source: MpsInventoryTarget[], version: MpsInventoryVersion = 'auto', issues: string[] = []) {
  const versions = new Map<string, string>()
  const sourceKeys = new Set<string>()
  for (const row of source) {
    sourceKeys.add(key(row))
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
    const productKey = key(product)
    const rows = index.get(productKey) ?? []
    const row = rows.length === 1 && Number.isSafeInteger(rows[0].sourceRows) && rows[0].sourceRows > 0 ? rows[0] : undefined
    const conflictFields = row?.conflictFields ?? []
    const missing = [...issues]
    const missingCodes: MpsInventoryTargetResult['missingCodes'] = []
    if (issues.length) missingCodes.push('read-failed')
    if (!issues.length) {
      if (!rows.length) {
        missing.push(`缺${effectiveVersion || '可用版本'}目标记录：${product.month} ${product.base} ${product.code}`)
        missingCodes.push(sourceKeys.has(productKey) ? 'missing-selected-version' : 'missing-record')
      } else if (!row) {
        missing.push('同基地、单品、月份和版本的目标记录重复')
        missingCodes.push('duplicate-key')
      } else {
        if (conflictFields.includes('finalTarget')) {
          missing.push('源目标库存同键值冲突')
          missingCodes.push('conflicting-target')
        } else if (!valid(row.finalTarget)) {
          missing.push('最终目标库存缺失、无效或同键值冲突')
          missingCodes.push('invalid-target')
        }
        if (conflictFields.includes('dailyDemand')) {
          missing.push('源日均计划需求同键值冲突')
          missingCodes.push('conflicting-daily-demand')
        } else if (!valid(row.dailyDemand) || row.dailyDemand <= 0) {
          missing.push('日均计划需求缺失、无效、同键值冲突或为0')
          missingCodes.push(row.dailyDemand === 0 ? 'zero-daily-demand' : 'invalid-daily-demand')
        }
      }
    }
    const ratio = !missing.length && row && valid(row.finalTarget) && valid(row.dailyDemand) && row.dailyDemand > 0 ? row.finalTarget / row.dailyDemand : null
    if (ratio !== null && (!Number.isFinite(ratio) || ratio > Number.MAX_SAFE_INTEGER)) {
      missing.push('目标周转天数超出有效范围')
      missingCodes.push('invalid-days')
    }
    return {
      ...product,
      status: issues.length ? 'read-failed' : !rows.length ? 'missing' : !row || conflictFields.length ? 'conflict' : missing.length ? 'invalid' : 'valid',
      missingCodes,
      conflictFields,
      version: effectiveVersion,
      finalTarget: issues.length || conflictFields.includes('finalTarget') ? null : (row?.finalTarget ?? null),
      dailyDemand: issues.length || conflictFields.includes('dailyDemand') ? null : (row?.dailyDemand ?? null),
      days: missing.length ? null : ratio,
      finalTurnoverDays: !issues.length && !conflictFields.includes('finalTurnoverDays') && valid(row?.finalTurnoverDays ?? null) ? (row?.finalTurnoverDays ?? null) : null,
      missing
    }
  }
}

export interface MpsTurnoverPolicy {
  sourceDays: number | null
  sourceMonths: string[]
  missing: string[]
}
export function inventoryTurnoverIndex(resolve: ReturnType<typeof inventoryTargetIndex>, months: string[]) {
  const policies = new Map<string, MpsTurnoverPolicy>()
  return (product: { base: string; code: string }): MpsTurnoverPolicy => {
    const productKey = JSON.stringify([product.base, product.code])
    const cached = policies.get(productKey)
    if (cached) return cached
    const records = months.map(month => resolve({ ...product, month }))
    const values = new Set(records.flatMap(row => (row.finalTurnoverDays === null ? [] : [row.finalTurnoverDays])))
    const conflict = values.size > 1 || records.some(row => row.conflictFields.includes('finalTurnoverDays') || row.missingCodes.includes('duplicate-key'))
    const policy = {
      sourceDays: !conflict && values.size === 1 ? [...values][0] : null,
      sourceMonths: records.filter(row => row.finalTurnoverDays !== null).map(row => row.month),
      missing: conflict
        ? ['同基地同SKU的最终目标周转天数冲突，请核对或人工补充']
        : values.size
          ? []
          : [records.some(row => row.status === 'read-failed') ? '目标周转天数来源读取失败，请同步或人工补充' : '各月均无有效的最终目标周转天数，请人工补充']
    }
    policies.set(productKey, policy)
    return policy
  }
}
