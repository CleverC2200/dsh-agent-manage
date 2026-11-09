import type { MpsQuantity, MpsWorkflowRow } from './workflow.ts'

export type MpsReportRatio =
  | { kind: 'group'; category: string; group: string; share: MpsQuantity }
  | { kind: 'sku'; category: string; group: string; code: string; share: MpsQuantity }
  | { kind: 'base'; category: string; group: string; code: string; base: string; share: MpsQuantity }

const valid = (value: MpsQuantity): value is number => value !== null && Number.isFinite(value) && value >= 0
const ratioKey = (row: MpsReportRatio) => JSON.stringify([row.kind, row.category, row.group, 'code' in row ? row.code : '', 'base' in row ? row.base : ''])

export function applyReportFallback(rows: MpsWorkflowRow[], ratios: MpsReportRatio[]) {
  if (!ratios.length || !rows.some(row => valid(row.historyQuantity) && row.historyQuantity > 0) || rows.every(row => row.reportQuantity !== null)) return
  const index = new Map<string, MpsReportRatio[]>()
  for (const ratio of ratios) {
    const key = ratioKey(ratio)
    index.set(key, [...(index.get(key) ?? []), ratio])
  }
  const read = (key: MpsReportRatio, fallback: MpsQuantity) => {
    if (fallback !== null) return { value: fallback, missing: false }
    const matches = index.get(ratioKey(key))
    if (!matches) return { value: fallback, missing: fallback === null }
    if (matches.length === 1 && matches[0].share === null) return { value: fallback, missing: fallback === null }
    const value = matches.length === 1 ? matches[0].share : null
    return { value: valid(value) && value <= 1 ? value : null, missing: false }
  }
  const groups = [...new Set(rows.map(row => row.group))]
  const historical = (entries: MpsWorkflowRow[]) => entries.reduce((sum, row) => sum + (row.historyQuantity ?? 0), 0)
  const ranked = <T extends string>(keys: T[], entries: (key: T) => MpsWorkflowRow[]) =>
    [...keys].sort((a, b) => historical(entries(b)) - historical(entries(a)) || a.localeCompare(b, 'en'))[0]
  const topGroup = ranked(groups, group => rows.filter(row => row.group === group))
  const category = rows[0].category
  const groupRatios = new Map(
    groups.map(group => [group, read({ kind: 'group', category, group, share: null }, rows.find(row => row.group === group)?.reportLayers.groupShare ?? null)])
  )
  const residual = (values: Map<string, { value: MpsQuantity; missing: boolean }>, top: string) => {
    const chosen = values.get(top)
    const others = [...values].filter(([key]) => key !== top).map(([, value]) => value.value)
    if (!chosen || (chosen.value === null && !chosen.missing) || !others.every(valid)) return false
    const amount = 1 - others.reduce((sum, value) => sum + value, 0)
    if (amount < -1e-12 || amount > 1 + 1e-12) return false
    const changed = chosen.value === null || Math.abs(chosen.value - amount) > 1e-12
    chosen.value = Math.max(0, Math.min(1, amount))
    return changed
  }
  const groupFallback = residual(groupRatios, topGroup)
  for (const group of groups) {
    const entries = rows.filter(row => row.group === group)
    const codes = [...new Set(entries.map(row => row.code))]
    const topCode = ranked(codes, code => entries.filter(row => row.code === code))
    const skuRatios = new Map(
      codes.map(code => [code, read({ kind: 'sku', category, group, code, share: null }, entries.find(row => row.code === code)?.reportLayers.skuShare ?? null)])
    )
    const skuFallback = residual(skuRatios, topCode)
    for (const row of entries) {
      const sku = entries.filter(entry => entry.code === row.code)
      const skuTotal = sku.every(entry => valid(entry.reportQuantity)) ? sku.reduce((sum, entry) => sum + (entry.reportQuantity ?? 0), 0) : null
      const baseDefault = skuTotal !== null && skuTotal > 0 && row.reportQuantity !== null ? row.reportQuantity / skuTotal : null
      const groupShare = groupRatios.get(group)?.value ?? null
      const skuShare = skuRatios.get(row.code)?.value ?? null
      const baseShare = read({ kind: 'base', category, group, code: row.code, base: row.base, share: null }, baseDefault).value
      const product = groupShare !== null && skuShare !== null && baseShare !== null ? groupShare * skuShare * baseShare : null
      const directZero = row.reportQuantity === 0 && (row.reportShare === 0 || groupShare === 0 || skuShare === 0 || baseShare === 0)
      row.reportLayers = { ...row.reportLayers, groupShare, skuShare, baseShare, product }
      row.reportShare = directZero ? 0 : product
      row.missing.reportShare = row.reportShare === null ? ['提报拆分系数缺失或冲突，Top1剩余占比不足以确定本行'] : []
      row.coefficientFallback = [
        ...(groupFallback && group === topGroup ? ['提报物料组Top1承接剩余占比'] : []),
        ...(skuFallback && row.code === topCode ? ['提报SKU Top1承接剩余占比'] : [])
      ]
      row.fallback = row.coefficientFallback.length > 0
    }
  }
  if (rows.every(row => row.reportShare !== null) && Math.abs(rows.reduce((sum, row) => sum + (row.reportShare ?? 0), 0) - 1) > 1e-6) {
    for (const row of rows) {
      row.reportShare = null
      row.reportLayers.product = null
      row.missing.reportShare = ['源拆分系数合计未对平，不能按完整大类需求分配']
    }
  }
}
