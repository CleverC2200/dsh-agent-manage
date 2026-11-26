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
const priority: Exclude<MpsInventoryVersion, 'auto'>[] = ['纠偏', '月初', '滚动']
const key = (row: { month: string; base: string; code: string }) => JSON.stringify([row.month, row.base, row.code])
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
export function inventoryTargetIndex(
  source: MpsInventoryTarget[],
  version: MpsInventoryVersion = 'auto',
  issues: string[] = [],
  order: Exclude<MpsInventoryVersion, 'auto'>[] = priority
) {
  const versions = new Map<string, string>()
  const sourceKeys = new Set<string>()
  for (const row of source) {
    sourceKeys.add(key(row))
    const rank = order.findIndex(value => value === row.version)
    if (rank < 0) continue
    const period = row.month
    const current = versions.get(period)
    if (!current || rank < order.findIndex(value => value === current)) versions.set(period, row.version)
  }
  const selected = source.filter(row => row.version === (version === 'auto' ? versions.get(row.month) : version))
  const index = new Map<string, MpsInventoryTarget[]>()
  for (const row of selected) index.set(key(row), [...(index.get(key(row)) ?? []), row])
  return (product: { month: string; base: string; code: string }): MpsInventoryTargetResult => {
    const effectiveVersion = version === 'auto' ? (versions.get(product.month) ?? '') : version
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

export interface MpsTurnoverAttempt {
  version: string
  status: 'valid' | 'missing-record' | 'missing-days' | 'invalid-days' | 'conflict' | 'read-failed'
  reason: string
}
export interface MpsTurnoverPolicy {
  sourceDays: number | null
  sourceMonths: string[]
  sourceVersion: string
  fallbackReason: string
  attempts: MpsTurnoverAttempt[]
  missing: string[]
}
export function inventoryTurnoverIndex(
  source: MpsInventoryTarget[],
  months: string[],
  version: MpsInventoryVersion = 'auto',
  issues: string[] = [],
  order: Exclude<MpsInventoryVersion, 'auto'>[] = priority
) {
  const sourceMonth = months[0]
  const versions = version === 'auto' ? order : [version]
  const sourceIndex = new Map<string, MpsInventoryTarget[]>()
  for (const row of source) {
    if (row.month !== sourceMonth) continue
    const sourceKey = JSON.stringify([row.base, row.code, row.version])
    sourceIndex.set(sourceKey, [...(sourceIndex.get(sourceKey) ?? []), row])
  }
  const policies = new Map<string, MpsTurnoverPolicy>()
  return (product: { base: string; code: string }): MpsTurnoverPolicy => {
    const productKey = JSON.stringify([product.base, product.code])
    const cached = policies.get(productKey)
    if (cached) return cached
    const policy: MpsTurnoverPolicy = {
      sourceDays: null,
      sourceMonths: sourceMonth ? [sourceMonth] : [],
      sourceVersion: versions[0] ?? '',
      fallbackReason: '',
      attempts: [],
      missing: []
    }
    for (const candidate of versions) {
      const rows = sourceIndex.get(JSON.stringify([product.base, product.code, candidate])) ?? []
      const row = rows[0]
      const status: MpsTurnoverAttempt['status'] = issues.length
        ? 'read-failed'
        : !row
          ? 'missing-record'
          : rows.length > 1 || !Number.isSafeInteger(row.sourceRows) || row.sourceRows <= 0 || row.conflictFields?.includes('finalTurnoverDays')
            ? 'conflict'
            : row.finalTurnoverDays == null
              ? 'missing-days'
              : valid(row.finalTurnoverDays)
                ? 'valid'
                : 'invalid-days'
      const prefix = `${sourceMonth ?? '所选来源月'} ${candidate}`
      const reason =
        status === 'read-failed'
          ? `目标周转天数来源读取失败：${issues.join('；')}，请同步或人工补充`
          : status === 'missing-record'
            ? `${prefix}缺目标记录（缺选定版本${candidate}），请核对或人工补充`
            : status === 'conflict'
              ? `${prefix}同基地同SKU的最终目标周转天数冲突，请核对或人工补充`
              : status === 'missing-days'
                ? `${prefix}最终目标周转天数字段为空，请核对或人工补充`
                : status === 'invalid-days'
                  ? `${prefix}最终目标周转天数无效，请核对或人工补充`
                  : ''
      policy.attempts.push({ version: candidate, status, reason })
      if (status === 'valid') {
        policy.sourceDays = row.finalTurnoverDays ?? null
        policy.sourceVersion = candidate
        policy.fallbackReason = policy.attempts
          .slice(0, -1)
          .map(attempt => attempt.reason)
          .join('；')
        break
      }
      if (status === 'conflict' || status === 'read-failed') break
    }
    if (policy.sourceDays === null) {
      const blocking = policy.attempts.find(attempt => attempt.status === 'conflict' || attempt.status === 'read-failed')
      policy.missing = blocking
        ? [blocking.reason, ...policy.attempts.filter(attempt => attempt !== blocking).map(attempt => attempt.reason)]
        : policy.attempts.map(attempt => attempt.reason)
    }
    policies.set(productKey, policy)
    return policy
  }
}
