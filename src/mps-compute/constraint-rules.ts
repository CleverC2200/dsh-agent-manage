import type { MpsWorkflowInput, MpsWorkflowRow, MpsResourceLoad, MpsResource } from './workflow.ts'

type NumericKind = 'inventory-days' | 'production-days' | 'transfer-limit' | 'cost-limit' | 'lead-days'
type Effect = { kind: NumericKind; value: number } | { kind: 'resource-unavailable'; resourceId: string } | { kind: 'self-only' }
export interface MpsRule {
  id: string
  description: string
  category: string
  source: string
  strength: '硬' | '软'
  base: string
  code: string
  productCategory: string
  from: string
  until: string
  accepted: boolean
  effect: Effect
  observations: { month: string; value: number; source: string }[]
}
export interface MpsRuleEvaluation {
  ruleId: string
  month: string
  status: 'applied' | 'met' | 'conflict' | 'warning' | 'pending' | 'draft' | 'disabled' | 'expired'
  reason: string
  affected: number
  observed: number | null
  limit: number | null
  unit: string
}
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
const active = (rule: MpsRule, month: string) => (!rule.from || rule.from.slice(0, 7) <= month) && (!rule.until || rule.until.slice(0, 7) >= month)
const enforced = (rule: MpsRule) => rule.strength === '硬' || rule.accepted
export const ruleApplies = (rule: MpsRule, row: { month: string; base: string; code?: string; category?: string }) =>
  active(rule, row.month) && (!rule.base || rule.base === row.base) && (!rule.code || rule.code === row.code) && (!rule.productCategory || rule.productCategory === row.category)

export function resolveMpsRules(input: MpsWorkflowInput, months: string[]) {
  const rules: MpsRule[] = []
  const evaluations: MpsRuleEvaluation[] = []
  const raw: unknown = input.constraints.rules.local
  const entries = Array.isArray(raw) ? raw : []
  const counts = new Map<string, number>()
  entries.forEach((entry: unknown, index: number) => {
    const id = object(entry) && text(entry.id) ? text(entry.id) : `legacy-${index}`
    counts.set(id, (counts.get(id) ?? 0) + 1)
  })
  entries.forEach((entry: unknown, index: number) => {
    const id = object(entry) && text(entry.id) ? text(entry.id) : `legacy-${index}`
    const rejected = (reason: string, status: MpsRuleEvaluation['status'] = 'draft') =>
      evaluations.push({ ruleId: id, month: months[0], status, reason, affected: 0, observed: null, limit: null, unit: '' })
    if (!object(entry)) {
      rejected('规则格式不可用')
      return
    }
    if (counts.get(id) !== 1) {
      rejected('规则编号重复')
      return
    }
    if (entry.enabled === false) {
      rejected('已停用，不参与计算', 'disabled')
      return
    }
    if (!['硬', '软'].includes(text(entry.strength))) {
      rejected('请选择软约束或硬约束')
      return
    }
    if (!text(entry.description)) {
      rejected('请填写约束内容')
      return
    }
    const effect = entry.effect
    if (!object(effect)) {
      rejected('请编辑规则类型和参数，文字记录不会自动执行')
      return
    }
    let parsed: Effect
    const kind = effect.kind
    if (kind === 'resource-unavailable') {
      if (!text(effect.resourceId) || text(entry.code) || text(entry.productCategory)) {
        rejected('停线规则须指定唯一资源，不能限定单个SKU或品类')
        return
      }
      parsed = { kind, resourceId: text(effect.resourceId) }
    } else if (kind === 'self-only') parsed = { kind }
    else if (kind === 'inventory-days' || kind === 'production-days' || kind === 'transfer-limit' || kind === 'cost-limit' || kind === 'lead-days') {
      if (!validNumber(effect.value) || ((kind === 'production-days' || kind === 'inventory-days' || kind === 'lead-days') && effect.value > 366)) {
        rejected('请填写有效的非负规则参数，天数不超过366')
        return
      }
      if (kind === 'production-days' && (text(entry.code) || text(entry.productCategory))) {
        rejected('生产天数按基地月份维护，不能限定单个SKU或品类')
        return
      }
      parsed = { kind, value: effect.value }
    } else {
      rejected('规则类型尚不支持计算')
      return
    }
    const from = text(entry.from),
      until = text(entry.until)
    if ([from, until].some(date => date && !/^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(date)) || (from && until && from > until)) {
      rejected('生效日期须为有效日期，结束日不能早于开始日')
      return
    }
    const rawObservations = Array.isArray(entry.observations) ? entry.observations.filter(object) : []
    const observationCounts = new Map<string, number>()
    for (const value of rawObservations) observationCounts.set(text(value.month), (observationCounts.get(text(value.month)) ?? 0) + 1)
    const observations = rawObservations.flatMap(value =>
      observationCounts.get(text(value.month)) === 1 &&
      typeof value.value === 'number' &&
      (parsed.kind === 'cost-limit' || parsed.kind === 'lead-days' || value.value >= 0) &&
      Number.isFinite(value.value) &&
      Math.abs(value.value) <= Number.MAX_SAFE_INTEGER &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value.month)) &&
      text(value.source)
        ? [{ month: text(value.month), value: value.value, source: text(value.source) }]
        : []
    )
    const rule: MpsRule = {
      id,
      description: text(entry.description),
      category: text(entry.category),
      source: text(entry.source),
      strength: entry.strength === '硬' ? '硬' : '软',
      base: text(entry.base),
      code: text(entry.code),
      productCategory: text(entry.productCategory),
      from,
      until,
      accepted: entry.accepted === true,
      effect: parsed,
      observations
    }
    if (!months.some(month => active(rule, month))) {
      rejected('不在本版计算月份的有效期内', 'expired')
      return
    }
    rules.push(rule)
  })
  return { rules, evaluations }
}

export function ruleSafetyDays(value: number | null, row: { base: string; code: string; category: string; month: string }, rules: MpsRule[]) {
  for (const rule of rules) if (enforced(rule) && ruleApplies(rule, row) && rule.effect.kind === 'inventory-days') value = Math.max(value ?? 0, rule.effect.value)
  return value
}
export function ruleProductionDays(value: number | null, base: string, month: string, rules: MpsRule[]) {
  for (const rule of rules)
    if (enforced(rule) && ruleApplies(rule, { base, month }) && rule.effect.kind === 'production-days') value = value === null ? null : Math.min(value, rule.effect.value)
  return value
}
export function ruleStopsResource(resource: MpsResource, month: string, rules: MpsRule[]) {
  return rules.some(
    rule => enforced(rule) && ruleApplies(rule, { base: resource.base, month }) && rule.effect.kind === 'resource-unavailable' && rule.effect.resourceId === resource.id
  )
}

export function evaluateMpsRules(resolved: ReturnType<typeof resolveMpsRules>, rows: MpsWorkflowRow[], loads: MpsResourceLoad[], months: string[]) {
  const evaluations = [...resolved.evaluations]
  for (const rule of resolved.rules)
    for (const month of months.filter(month => active(rule, month))) {
      const applicable = rows.filter(row => row.month === month && ruleApplies(rule, row))
      const targets = loads.filter(resource => ruleApplies(rule, { base: resource.base, month: resource.month }) && resource.month === month)
      const effect = rule.effect
      const facts = rule.observations.filter(value => value.month === month)
      const observation = facts.length === 1 ? facts[0] : undefined
      let status: MpsRuleEvaluation['status'] = 'pending',
        reason = '缺对应计算输入',
        observed: number | null = null,
        unit = ''
      const limit = 'value' in effect ? effect.value : null
      if (effect.kind === 'inventory-days') {
        unit = '天'
        if (applicable.length && applicable.every(row => row.safetyDays !== null && row.targetInventory !== null)) {
          observed = Math.min(...applicable.map(row => row.safetyDays ?? 0))
          status = observed >= effect.value ? (enforced(rule) ? 'applied' : 'met') : 'warning'
          reason = status === 'warning' ? '当前安全天数低于建议下限；采用后重算目标库存和所需生产' : '已按安全天数下限重算目标库存、所需生产和后月结转'
        } else reason = '缺匹配单品、下月需求或期初结存；库存下限已参与公式，结果仍待补输入'
      } else if (effect.kind === 'production-days') {
        unit = '天'
        if (targets.length && targets.every(resource => resource.productionDays !== null)) {
          observed = Math.max(...targets.map(resource => resource.productionDays ?? 0))
          status = observed > effect.value ? 'warning' : targets.some(resource => (resource.gapTons ?? 0) > 0) ? (enforced(rule) ? 'conflict' : 'warning') : 'applied'
          reason = status === 'conflict' ? '生产天数上限下资源产能不足，保留需求并列出缺口' : '生产天数上限已进入资源负荷及缺口计算'
        } else reason = '生产天数上限已纳入计算；缺资源、生产吨数或资源分配，负荷仍不可判定'
      } else if (effect.kind === 'resource-unavailable') {
        unit = '吨'
        const resource = targets.filter(item => item.resourceId === effect.resourceId)
        if (resource.length && resource.every(item => item.requiredTons !== null)) {
          observed = resource.reduce((sum, item) => sum + (item.requiredTons ?? 0), 0)
          status = observed > 0 ? (enforced(rule) ? 'conflict' : 'warning') : 'met'
          reason = enforced(rule) ? '该资源本月可用产能按0计算；所需吨数作为停线缺口保留' : '该资源仍有生产需求；建议停用将造成对应产能缺口'
        } else reason = '指定资源、SKU分配或所需吨数尚不完整，不能判定停线可行性'
      } else if (effect.kind === 'self-only') {
        const known =
          targets.length > 0 && targets.every(resource => resource.gapTons !== null) && applicable.length > 0 && applicable.every(row => !row.missing.resourceAssignments.length)
        if (observation && observation.value > 0) {
          observed = observation.value
          unit = '吨'
          status = enforced(rule) ? 'conflict' : 'warning'
          reason = `${observation.source}：拟委外${observation.value}吨，不满足必须自产规则`
        } else if (known) {
          status = targets.some(resource => (resource.gapTons ?? 0) > 0) ? (enforced(rule) ? 'conflict' : 'warning') : 'met'
          reason = status === 'met' ? '当前自产资源可覆盖所需生产；禁止委外策略参与可行性校验' : '自产资源存在缺口，禁止委外约束下不能认定计划可行，需调整资源或保留缺口'
        } else reason = '禁止委外策略已登记；缺自产完整负荷与分配，不能认定自产可满足'
      } else if (effect.kind === 'transfer-limit' || effect.kind === 'cost-limit' || effect.kind === 'lead-days') {
        unit = effect.kind === 'transfer-limit' ? '吨' : effect.kind === 'cost-limit' ? '%' : '天'
        if (observation) {
          observed = observation.value
          const valid = effect.kind === 'lead-days' ? observed >= effect.value : observed <= effect.value
          status = valid ? 'met' : enforced(rule) ? 'conflict' : 'warning'
          reason = `${observation.source}：${observed}${unit}，${effect.kind === 'lead-days' ? '下限' : '上限'}${effect.value}${unit}；${valid ? '满足本条规则' : '不满足本条规则，需调整方案或明确放宽'}`
        } else
          reason =
            effect.kind === 'transfer-limit'
              ? '缺本月拟调拨吨数及方案来源，调拨上限待校验'
              : effect.kind === 'cost-limit'
                ? '缺本月方案成本增幅及计算来源，成本上限待校验'
                : '缺本月新品实际提前天数及日期依据，提前期下限待校验'
      }

      if (enforced(rule) && ['conflict', 'pending'].includes(status) && ['self-only', 'transfer-limit', 'cost-limit', 'lead-days'].includes(effect.kind))
        for (const row of applicable) row.missing.mainPlan.push(`约束「${rule.description}」：${reason}`)
      evaluations.push({ ruleId: rule.id, month, status, reason, affected: applicable.length, observed, limit, unit })
    }
  return evaluations
}
