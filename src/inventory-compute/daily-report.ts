/** Pure, deterministic report contract. Never treats unknown facts as zero. */
export const DAILY_REPORT_BASES = ['华东', '华南', '西南', '遂平', '郑州']
export type DailySource = 'stock' | 'age' | 'pending' | 'fulfillment'
export type DailyStock = {
  base: string
  material: string
  name: string
  category: string
  inventory: number | null
  target: number | null
  demand: number | null
  shipment30: number | null
  snapshot: string
}
export type DailyAge = {
  base: string
  material: string
  name: string
  category: string
  inventory: number | null
  bands: (number | null)[]
  natural7?: number | null
  natural14?: number | null
  weightedAge: number | null
  invalidQuantity: boolean
  snapshot: string
}
export type DailyPending = {
  base: string
  material: string
  quantity: number | null
  shortage: number | null
  allocated: number | null
  snapshot: string
  inventorySnapshot: string
}
export type DailyFulfillment = {
  base: string
  material: string
  need: number | null
  shortage: number | null
  invalidQuantity: boolean
  snapshot: string
}
export type DailyReportInput = {
  stock: DailyStock[]
  age: DailyAge[]
  pending: DailyPending[]
  fulfillment: DailyFulfillment[]
  pendingSnapshot: string
  failedSources: DailySource[]
  targetMonth: string
  targetVersion: string
  targetRule: string
  generatedAt: string
  localPreview: boolean
  selectedBases?: string[]
  includeAllRisks?: boolean
}
export type ReportModuleId = 'age' | 'shortage' | 'movement' | 'quality'
export type ReportModule = {
  id: ReportModuleId
  title: string
  description: string
  conclusion: string
  yesterday?: string
  overview: { title: string; metrics: ReportMetric[] }[]
  groups: { base: string; risks: ReportRisk[] }[]
}
export type ReportMetric = {
  label: string
  value: number | null
  unit: string
  note?: string
  auxiliaries?: string[]
}
export type ReportRisk = {
  id: string
  object: string
  kind: string
  level: string
  quantity: number
  base: string
  material: string
  category: string
  module: ReportModuleId
  evidence: string
  action: string
  role: string
  priority: number
  cause: string
  feedbackStatus: string
  details: { label: string; value: string }[]
}
export type DailyReport = {
  title: string
  date: string
  generatedAt: string
  scope: string
  bases: string[]
  localPreview: boolean
  empty: boolean
  summary: string[]
  metrics: ReportMetric[]
  ageInventory: number | null
  ageBands: {
    label: string
    quantity: number | null
    share: number | null
    objects: string
  }[]
  risks: ReportRisk[]
  riskCount: number
  missingTargetCount: number
  missingMovementCount: number
  sources: { label: string; status: string; snapshot: string }[]
  notes: string[]
  coreMetrics: ReportMetric[]
  modules: ReportModule[]
  status: '已生成' | '部分生成'
  riskLevel: string
  visibleObjectKeys: string[]
  qualityIssues: string[]
}
export function reportNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}
const quantityFormats = new Map<number, Intl.NumberFormat>()
export function reportQuantity(value: number | null, digits = 0): string {
  if (value === null) return '—'
  if (!quantityFormats.has(digits)) quantityFormats.set(digits, new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }))
  return quantityFormats.get(digits)!.format(value)
}
export function reportDate(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed)
}
export function reportTimestamp(value: string): string {
  const parsed = new Date(value)
  if (!value || !Number.isFinite(parsed.getTime())) return '暂无快照'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false
  }).format(parsed)
}
function total(values: (number | null)[]): number | null {
  return !values.length || values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0)
}
function knownTotal(values: (number | null)[]): number | null {
  return total(values.filter(value => value !== null))
}
export const reportObjectKey = (row: { base: string; material: string }) => JSON.stringify([row.base, row.material])
const key = reportObjectKey
const objectName = (row: { base: string; material: string; name: string }) => `${row.base} · ${row.name || row.material}（${row.material}）`
const visible = (row: { base: string; material: string }) => DAILY_REPORT_BASES.includes(row.base) && Boolean(row.material)

/** All inputs must already have passed GEA row permissions; the intersection is
 * additional protection against joining auxiliary rows outside visible objects. */
export function buildDailyReport(input: DailyReportInput): DailyReport {
  const inScope = (row: { base: string; material: string }) => visible(row) && (!input.selectedBases || input.selectedBases.includes(row.base))
  const unique = <T extends { base: string; material: string }>(rows: T[]) => [...new Map(rows.map(row => [key(row), row])).values()]
  const stock = unique(input.stock.filter(inScope))
  const age = unique(input.age.filter(inScope))
  const allowed = new Set([...stock, ...age].map(key))
  const pending = unique(input.pending.filter(row => allowed.has(key(row))))
  const fulfillment = unique(input.fulfillment.filter(row => allowed.has(key(row))))
  const bases = [...new Set([...stock, ...age].map(row => row.base))].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  const ageValid = age.length > 0 && !age.some(row => row.invalidQuantity)
  const ageInventory = ageValid ? total(age.map(row => row.inventory)) : null
  const current = stock.length ? total(stock.map(row => row.inventory)) : ageInventory
  const target = knownTotal(stock.map(row => row.target))
  const gap = current !== null && stock.length && target !== null ? current - target : null
  const demand = knownTotal(stock.map(row => row.demand))
  const turnover = stock.length && current !== null && demand !== null && demand > 0 ? current / demand : null
  const targetTurnover = target !== null && demand !== null && demand > 0 ? target / demand : null
  const missingTargetCount = stock.filter(row => row.target === null).length
  const missingDemandCount = stock.filter(row => row.demand === null).length
  const missingMovementCount = stock.filter(row => row.shipment30 === null).length
  const bandTotals = [0, 1, 2, 3, 4].map(index => (ageValid ? total(age.map(row => row.bands[index] ?? null)) : null))
  const weightedAge = ageValid ? total(age.map(row => row.weightedAge)) : null
  const averageAge = ageInventory !== null && ageInventory > 0 && weightedAge !== null && bandTotals[4] === 0 ? weightedAge / ageInventory : null
  const pendingReady = !input.failedSources.includes('pending') && Boolean(input.pendingSnapshot)
  const order = pendingReady ? (pending.length ? total(pending.map(row => row.quantity)) : 0) : null
  const shortage = pendingReady ? (pending.length ? knownTotal(pending.map(row => row.shortage)) : 0) : null
  const missingShortageCount = pending.filter(row => row.shortage === null).length
  const allocated = pendingReady ? (pending.length ? total(pending.map(row => row.allocated)) : 0) : null
  const need = total(fulfillment.map(row => row.need))
  const unfilled = total(fulfillment.map(row => row.shortage))
  const fulfillmentRate =
    need !== null && need > 0 && unfilled !== null && unfilled >= 0 && unfilled <= need && !fulfillment.some(row => row.invalidQuantity) ? 1 - unfilled / need : null
  const notes: string[] = [
    '本报告按当前可见权限范围即时生成；数量沿用已接入数据的件数口径，时间均为北京时间。',
    `目标口径：${input.targetMonth || '当前月份'} · ${input.targetVersion || '暂无可用版本'}。${input.targetRule}`,
    '货龄按P1设计为0–30天（含30）、31–40天（>30且≤40）、41–60天（>40且≤60）、60+（>60）；连续货龄值按以上边界归类。固定看板保留原口径。占比分母只使用货龄表库存。',
    '当前订单仅汇总可见库存对象，采用既有五个提货点及备单状态规则；当前缺货按基地/SKU计算备单中订单量−占用量−可用库存的正值后汇总，为测算线索。',
    '当月订单满足率沿用工厂提货、排除饺鲜说的履约口径：1−缺货量/需求数量。已发货完成订单范围尚待确认，不能据此称为已核验的事后满足率。',
    '近30日量来自基地/SKU日均动销×30；不代表具体批次出库。近7日趋势、批次出库、生产入库压力和促销政策本次尚未接入，相关原因数据不足，需人工确认。',
    '60天以上库存仅作为大日期候选；本报告不执行25日批次锁定、专项建档、责任判定、费用分摊或业务指令。',
    '库存高于目标仅作差异复核；明显超目标、动销弱及总体红橙黄阈值尚未定稿，不自动定级。响应角色为建议角色，实际负责人和进展待人工确认。'
  ]
  if (input.localPreview) notes.unshift('本地验证模式：当前未使用门户用户权限，仅展示开发数据库已发布基地的数据；不代表任何生产用户的授权范围。')
  if (!stock.length) notes.push('目标版本未发布或库存主表不可用：当前库存采用货龄表可见库存，目标、差额和周转不作判断。')
  if (stock.length && current !== null && ageInventory !== null && Math.abs(current - ageInventory) > 0.01) {
    notes.push(
      `库存主表与货龄表统计范围不一致：主表${reportQuantity(current)}件，货龄表${reportQuantity(ageInventory)}件；两者相差${reportQuantity(Math.abs(current - ageInventory))}件，需复核SKU与仓库范围，不能混用占比分母。`
    )
  }
  if (missingTargetCount)
    notes.push(`${missingTargetCount}个基地/SKU缺少目标。与看板一致，差额按当前库存减已知目标、目标天数按已知目标除已知日均计划量计算，均标注部分；不能把未覆盖部分判断为超储。`)
  if (missingDemandCount) notes.push(`${missingDemandCount}个基地/SKU缺少日均计划量，周转使用已知计划量并标注部分。`)
  if (missingShortageCount) notes.push(`${missingShortageCount}个基地/SKU缺少缺货计算依据，仅展示已核验缺货合计，不认定其余对象无缺货。`)
  if (missingMovementCount) notes.push(`${missingMovementCount}个基地/SKU缺少近30日动销，不视为零动销。`)
  if (!ageValid && age.length) notes.push('货龄数据存在无效库存数量，货龄汇总暂不展示，需人工确认。')
  if (bandTotals[4] !== null && bandTotals[4] > 0) notes.push(`有${reportQuantity(bandTotals[4])}件货龄未知，单独展示，平均货龄暂不作结论。`)
  const risks: ReportRisk[] = []
  const addRisk = (
    row: DailyStock | DailyAge,
    kind: string,
    level: string,
    quantity: number,
    evidence: string,
    action: string,
    role: string,
    priority: number,
    module: ReportModuleId = kind.includes('缺货') ? 'shortage' : kind.includes('动销') ? 'movement' : 'age'
  ) => {
    risks.push({
      id: JSON.stringify([row.base, row.material, kind]),
      base: row.base,
      material: row.material,
      category: row.category,
      module,
      object: objectName(row),
      kind,
      level,
      quantity,
      evidence,
      action,
      role,
      priority,
      cause: '需业务确认；当前数据不足以判定形成原因。',
      feedbackStatus: '待反馈',
      details: []
    })
  }
  const pendingMap = new Map(pending.map(row => [key(row), row]))
  const ageMap = new Map(age.map(row => [key(row), row]))
  const stockMap = new Map(stock.map(row => [key(row), row]))
  for (const row of age) {
    if (row.invalidQuantity) continue
    for (const [index, kind, level, action, priority] of [
      [3, '60天以上库存', '大日期候选', '建议复核生产日期与可用量，确认专项消化方式；尚未进行批次锁定。', 1],
      [2, '41–60天库存', '重点关注', '建议确认消化路径，优先复核近期订单和可适用的销售机会。', 2],
      [1, '31–40天库存', '关注', '建议关注正常出库节奏，及时复核货龄变化。', 3]
    ] as const) {
      const quantity = row.bands[index]
      const shipment30 = stockMap.get(key(row))?.shipment30
      const isWeakMovement = shipment30 !== null && shipment30 !== undefined && quantity !== null && shipment30 <= quantity
      const meetsAgeFocus = index === 1 ? isWeakMovement : true
      if (quantity !== null && quantity > 1 && meetsAgeFocus)
        addRisk(row, kind, level, quantity, `货龄快照中该区间库存${reportQuantity(quantity)}件。`, action, '基地计划员 / 品类计划员', priority)
    }
  }
  for (const row of stock) {
    if (row.inventory === null) continue
    const currentOrder = pendingMap.get(key(row))
    if (row.target !== null && row.inventory < row.target && currentOrder?.shortage !== null && currentOrder?.shortage !== undefined && currentOrder.shortage > 0) {
      addRisk(
        row,
        '低于目标且当前缺货',
        '需复核',
        currentOrder.shortage,
        `库存${reportQuantity(row.inventory)}件，目标${reportQuantity(row.target)}件，当前测算缺货${reportQuantity(currentOrder.shortage)}件。`,
        '建议复核占用及可用库存，评估补货保障；不直接下发补货。',
        '基地计划 / 生产 / 供应',
        0
      )
    }
  }
  const shortageObjects = new Set(risks.filter(r => r.module === 'shortage').map(key))
  for (const row of pending) {
    if (row.shortage === null || row.shortage <= 0 || shortageObjects.has(key(row))) continue
    const object = stockMap.get(key(row)) ?? ageMap.get(key(row))
    if (object)
      addRisk(
        object,
        '当前订单缺货',
        '优先处理',
        row.shortage,
        `当前订单${reportQuantity(row.quantity)}件，按未备单完成需求、占用与可用库存测算缺货${reportQuantity(row.shortage)}件。`,
        '建议基地计划确认补产时间及可调拨库存；生产计划与在途数据尚未接入。',
        '基地计划 / 生产 / 供应',
        0
      )
  }
  for (const row of stock) {
    if (row.inventory !== null && row.target !== null && row.inventory > row.target && row.shipment30 === 0)
      addRisk(
        row,
        '高库存且近30日无动销',
        '重点关注',
        row.inventory,
        `库存${reportQuantity(row.inventory)}件，高于目标${reportQuantity(row.inventory - row.target)}件，近30日动销为0。`,
        '建议先确认客户拉货或活动消化，再由基地计划复核调剂与后续生产节奏。',
        '销售 / 基地计划',
        2
      )
    const currentOrder = pendingMap.get(key(row))
    if (row.inventory !== null && row.target !== null && row.inventory > row.target && row.shipment30 !== null && row.shipment30 > 0 && row.shipment30 < row.inventory) {
      const plan = row.demand === null ? null : row.demand * 30
      const kind = plan === null ? '低动销且需求计划待核验' : plan < row.inventory ? '低动销且需求计划不足' : '低动销但需求计划覆盖'
      addRisk(
        row,
        kind,
        '关注',
        row.inventory,
        `库存${reportQuantity(row.inventory)}件，近30日动销${reportQuantity(row.shipment30)}件；30日需求计划参考${reportQuantity(plan)}件（日均计划×30）。`,
        plan === null
          ? '补齐需求计划，核对销售机会及生产节奏。'
          : plan < row.inventory
            ? '推动销售拉货、活动消化，并控制后续生产；先核对基地内可调剂量，再评估跨基地。'
            : '跟踪需求计划转订单及客户拉货；未兑现前保留风险。',
        '销售 / 基地计划',
        3,
        'movement'
      )
    }
    if (
      pendingReady &&
      (!currentOrder || currentOrder.shortage === 0) &&
      row.inventory !== null &&
      row.target !== null &&
      row.inventory < row.target &&
      row.demand !== null &&
      row.demand > 0 &&
      row.inventory < row.demand * 7
    )
      addRisk(
        row,
        '潜在缺货：7日需求保障不足',
        '需关注',
        row.target - row.inventory,
        `库存${reportQuantity(row.inventory)}件，低于目标${reportQuantity(row.target - row.inventory)}件；7日需求计划参考${reportQuantity(row.demand * 7)}件。当前无已核验订单缺口。`,
        '核对未来7日生产与到货计划，优先保障新增订单；不直接下发补货。',
        '基地计划 / 生产',
        2,
        'shortage'
      )
  }
  risks.sort((a, b) => a.priority - b.priority || b.quantity - a.quantity || a.id.localeCompare(b.id))
  // Reserve examples for every risk type, but do not turn the daily report into
  // a SKU list. The fixed board remains the complete-detail surface.
  const kindCounts = new Map<string, number>()
  const selectedRisks = risks
    .filter(row => {
      const count = kindCounts.get(row.kind) ?? 0
      kindCounts.set(row.kind, count + 1)
      return count < 3
    })
    .slice(0, 12)
  selectedRisks.sort((a, b) => a.priority - b.priority || b.quantity - a.quantity || a.id.localeCompare(b.id))
  const focus = (module: ReportModuleId) => {
    const rows = risks.filter(r => r.module === module),
      counts = new Map<string, number>()
    const representative = rows
      .filter(r => {
        const count = counts.get(r.kind) ?? 0
        counts.set(r.kind, count + 1)
        return count < 3
      })
      .slice(0, 8)
    const ids = new Set(representative.map(r => r.id))
    return [...representative, ...rows.filter(r => !ids.has(r.id))].slice(0, 8).sort((a, b) => a.priority - b.priority || b.quantity - a.quantity)
  }
  const moduleRisks = new Map<ReportModuleId, ReportRisk[]>([
    ['age', focus('age')],
    ['shortage', focus('shortage')],
    ['movement', focus('movement')],
    ['quality', []]
  ])
  const displayed = new Map([...selectedRisks, ...[...moduleRisks.values()].flat()].map(r => [r.id, r]))
  for (const risk of input.includeAllRisks ? risks : displayed.values()) {
    const s = stockMap.get(key(risk)),
      a = ageMap.get(key(risk)),
      p = pendingMap.get(key(risk))
    const q = (value: number | null | undefined, unit = '件') => (value == null ? '—' : `${reportQuantity(value, unit === '天' ? 1 : 0)}${unit}`)
    risk.details = [
      { label: '品类', value: risk.category || '—' },
      { label: 'SKU', value: risk.material },
      { label: '当前库存', value: q(s?.inventory ?? a?.inventory) },
      { label: '目标库存', value: q(s?.target) },
      {
        label: '库存差额',
        value: q(s?.inventory != null && s.target != null ? s.inventory - s.target : null)
      },
      {
        label: '周转天数',
        value: q(s?.inventory != null && s.demand != null && s.demand > 0 ? s.inventory / s.demand : null, '天')
      },
      { label: '近30日动销', value: q(s?.shipment30) },
      {
        label: '预计消化天数',
        value: s?.shipment30 === 0 ? '无动销，无法估算' : q(s?.inventory != null && s?.shipment30 != null && s.shipment30 > 0 ? s.inventory / (s.shipment30 / 30) : null, '天')
      },
      {
        label: '平均货龄',
        value: q(a && !a.invalidQuantity && a.inventory != null && a.inventory > 0 && a.weightedAge != null && a.bands[4] === 0 ? a.weightedAge / a.inventory : null, '天')
      },
      ...['0–30天', '31–40天', '41–60天', '60+天'].map((label, i) => ({
        label,
        value: q(a && !a.invalidQuantity ? a.bands[i] : null)
      })),
      {
        label: '未来7日新增60+（不扣动销）',
        value: q(a && !a.invalidQuantity && a.natural7 != null && a.bands[3] != null ? Math.max(0, a.natural7 - a.bands[3]) : null)
      },
      {
        label: '未来14日新增60+（不扣动销）',
        value: q(a && !a.invalidQuantity && a.natural14 != null && a.bands[3] != null ? Math.max(0, a.natural14 - a.bands[3]) : null)
      },
      { label: '当前订单', value: q(p?.quantity) },
      { label: '缺货量', value: q(p?.shortage) },
      { label: '占用量', value: q(p?.allocated) },
      { label: '影响订单数 / 预计补齐', value: '数据未接入' }
    ]
  }
  const latest = (values: string[]) =>
    values
      .filter(Boolean)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
      .at(-1) ?? ''
  const sourceDefs: [DailySource, string, string, boolean][] = [
    ['stock', '库存与目标', latest(stock.map(row => row.snapshot)), stock.length > 0],
    ['age', '库存货龄', latest(age.map(row => row.snapshot)), age.length > 0],
    ['pending', '当前订单', input.pendingSnapshot, pendingReady],
    ['fulfillment', '当月履约', latest(fulfillment.map(row => row.snapshot)), fulfillment.length > 0]
  ]
  const sources = sourceDefs.map(([source, label, snapshot, available]) => ({
    label,
    snapshot,
    status: input.failedSources.includes(source) ? '读取失败，数据不足' : available ? '已读取' : '无可见数据或未发布'
  }))
  const date = reportDate(input.generatedAt)
  if (sources.some(source => source.snapshot && reportDate(source.snapshot) !== date)) notes.push('部分来源不是今日快照。本报告使用最新可用数据，不能视为今日实时库存或订单。')
  for (const source of sources) if (source.status !== '已读取') notes.push(`${source.label}：${source.status}，相关指标和判断保留缺失。`)
  const qualityIssues = [
    input.failedSources.includes('pending') ? '当前订单读取失败，缺货暂不可判断' : null,
    shortage === null || missingShortageCount > 0 ? '部分订单占用或可用库存不足，整体缺货暂不可完整判断' : null,
    stock.length && current !== null && ageInventory !== null && Math.abs(current - ageInventory) > 0.01 ? '库存主表与货龄表范围不一致' : null,
    !input.targetVersion || (stock.length && missingTargetCount / stock.length >= 0.2) ? '目标库存版本缺失或覆盖不足' : null,
    !age.length ? '货龄来源无可见数据，货龄模块无法判断' : !ageValid ? '货龄数量无效' : null,
    (bandTotals[4] ?? 0) > 0 ? '存在未知货龄，平均货龄无法判断' : null,
    ...sources.filter(s => s.status !== '已读取').map(s => `${s.label}：${s.status}`)
  ].filter(Boolean) as string[]
  const potential = risks.filter(r => r.kind.startsWith('潜在缺货'))
  const movingRisks = risks.filter(r => r.module === 'movement')
  const movementComparable = stock.filter(r => r.inventory !== null && r.target !== null && r.shipment30 !== null)
  const movementPartial = movementComparable.length < stock.length
  const potentialReady =
    pendingReady && stock.some(r => r.target !== null && r.inventory !== null && r.demand !== null && (!pendingMap.has(key(r)) || pendingMap.get(key(r))?.shortage !== null))
  const insufficient = movingRisks.filter(r => {
    const row = stockMap.get(key(r))
    return row?.demand !== null && row?.demand !== undefined && row.inventory !== null && row.demand * 30 < row.inventory
  })
  const currentShortages = pending.filter(row => row.shortage !== null && row.shortage > 0)
  const stockWithShortage = currentShortages.filter(row => {
    const s = stockMap.get(key(row))
    return s?.inventory != null && s?.target != null && s.inventory > s.target
  })
  const sumRisks = (rows: ReportRisk[]) => rows.reduce((sum, r) => sum + r.quantity, 0)
  const unknownMetric = (label: string, note: string): ReportMetric => ({
    label,
    value: null,
    unit: '',
    note
  })
  const moduleOverviews: Record<ReportModuleId, ReportModule['overview']> = {
    age: [
      {
        title: '自然超龄预测',
        metrics: [
          {
            label: '未来7日新增60+',
            value: ageValid ? total(age.map(r => (r.natural7 != null && r.bands[3] != null ? Math.max(0, r.natural7 - r.bands[3]) : null))) : null,
            unit: '件',
            note: '不扣减动销'
          },
          {
            label: '未来14日新增60+',
            value: ageValid ? total(age.map(r => (r.natural14 != null && r.bands[3] != null ? Math.max(0, r.natural14 - r.bands[3]) : null))) : null,
            unit: '件',
            note: '不扣减动销'
          }
        ]
      }
    ],
    shortage: [
      {
        title: '当前订单缺货',
        metrics: [
          { label: '当前订单量', value: order, unit: '件' },
          {
            label: '订单SKU',
            value: pendingReady ? pending.filter(r => (r.quantity ?? 0) > 0).length : null,
            unit: '个'
          },
          unknownMetric('订单单数', '订单级明细未接入'),
          {
            label: missingShortageCount ? '已核验缺口（部分）' : '订单缺口',
            value: shortage,
            unit: '件'
          },
          {
            label: '缺货SKU',
            value: pendingReady ? currentShortages.length : null,
            unit: '个',
            note: missingShortageCount ? '仅已核验对象' : undefined
          },
          unknownMetric('影响订单单数', '缺口尚未分配至单笔订单'),
          unknownMetric('7日生产覆盖', '生产排程未接入')
        ]
      },
      {
        title: '潜在缺货（排除当前已缺货）',
        metrics: [
          {
            label: '目标缺口',
            value: potentialReady ? sumRisks(potential) : null,
            unit: '件',
            note: '低于目标且不足覆盖7日需求；仅已核验对象'
          },
          {
            label: '潜在风险SKU',
            value: potentialReady ? potential.length : null,
            unit: '个',
            note: '仅已核验对象'
          },
          unknownMetric('7日生产覆盖', '生产排程未接入')
        ]
      }
    ],
    movement: [
      {
        title: '滞库概览',
        metrics: [
          {
            label: '风险库存',
            value: movementComparable.length ? sumRisks(movingRisks) : null,
            unit: '件',
            note: movementPartial ? '部分：缺库存、目标或动销的对象未判断' : undefined
          },
          {
            label: '风险SKU',
            value: movementComparable.length ? movingRisks.length : null,
            unit: '个'
          },
          {
            label: '30日低动销库存',
            value: movementComparable.length ? sumRisks(movingRisks) : null,
            unit: '件',
            note: '含零动销；库存高于目标且30日动销不足库存'
          },
          {
            label: '30日低动销SKU',
            value: movementComparable.length ? movingRisks.length : null,
            unit: '个'
          },
          {
            label: '需求计划不足库存',
            value: movementComparable.some(r => r.demand !== null) ? sumRisks(insufficient) : null,
            unit: '件',
            note: '日均需求计划×30，非生产排程；仅已核验对象'
          },
          {
            label: '需求计划不足SKU',
            value: movementComparable.some(r => r.demand !== null) ? insufficient.length : null,
            unit: '个'
          }
        ]
      }
    ],
    quality: []
  }
  const moduleDefs: [ReportModuleId, string, string, string][] = [
    [
      'age',
      '货龄结构',
      '仅展示有明确处理价值的老龄或转风险对象；更多明细请查看固定看板。',
      bandTotals[3] === null
        ? '今日动作：先补齐货龄来源，再确认消化顺序。'
        : '今日动作：先核对60+候选是否已进入专项，已在专项的跟踪进度；再落实41–60天消化和31–40天弱动销对象出库。结合7/14日自然转超龄量安排资源。专项建档台账未接入，暂不判断新增专项。'
    ],
    [
      'shortage',
      '缺货风险',
      '仅列已确认或可能影响交付的对象；库存低于目标本身不等于缺货。',
      `${shortage === null ? '当前订单缺口数据不足。' : `当前${missingShortageCount ? '已核验' : '订单'}缺口${reportQuantity(shortage)}件，优先确认交付及补货。`}${potentialReady ? `已核验潜在风险${potential.length}个SKU，需核对生产与到货覆盖。` : '潜在缺货依据不足，暂不可判断。'}${stockWithShortage.length ? `有${stockWithShortage.length}个SKU库存高于目标仍缺货，需核对可用量和占用，不宜只看库存总量。` : '总库存较大不代表可用库存充足，应按SKU核对。'}`
    ],
    [
      'movement',
      '滞库风险',
      '按零动销、低动销且需求计划不足、低动销但计划覆盖区分建议；缺失动销不视为零。',
      movingRisks.length
        ? `已识别${movingRisks.length}个风险SKU。先核对基地仓与外仓可用量，再评估基地内调剂；推动销售拉货或活动消化，需求计划不足时复核生产节奏，计划覆盖时跟踪转订单。本地消化不足再评估跨基地，仓库及调拨证据需补充，尚不确定实际调拨量。`
        : '当前可核验数据未识别滞库重点对象；缺目标、动销或需求计划的对象不能据此判定正常。'
    ],
    [
      'quality',
      qualityIssues.length ? '数据说明与异常' : '数据说明',
      '仅保留影响整体判断或核心模块可信度的异常；个别对象字段缺失在对应风险行标记待核验。',
      qualityIssues.length ? qualityIssues.join('；') : '当前已读取数据未识别影响日报判断的重点异常。'
    ]
  ]
  const modules = moduleDefs.map(([id, title, description, conclusion]) => ({
    id,
    title,
    description,
    conclusion,
    overview: moduleOverviews[id],
    yesterday: id === 'age' ? '昨日处理：暂无已读取的昨日处理反馈，无法确认消化进度。' : undefined,
    groups: bases
      .map(base => ({
        base,
        risks: (moduleRisks.get(id) ?? []).filter(r => r.base === base)
      }))
      .filter(group => group.risks.length)
  }))
  const coreMetrics: ReportMetric[] = [
    {
      label: '当前库存',
      value: current,
      unit: '件',
      auxiliaries: [
        `${missingTargetCount ? '已知目标（部分）' : '目标库存'} ${reportQuantity(target)}件`,
        `库存差额${missingTargetCount ? '（部分）' : ''} ${reportQuantity(gap)}件`
      ]
    },
    {
      label: '周转天数',
      value: turnover,
      unit: '天',
      note: missingDemandCount ? `部分：${missingDemandCount}个SKU缺日均计划` : undefined,
      auxiliaries: [
        `目标天数${missingTargetCount || missingDemandCount ? '（部分）' : ''} ${reportQuantity(targetTurnover, 1)}天`,
        `天数差额 ${reportQuantity(turnover !== null && targetTurnover !== null ? turnover - targetTurnover : null, 1)}天`
      ]
    },
    {
      label: '当前货龄',
      value: averageAge,
      unit: '天',
      auxiliaries: [`60+ SKU ${ageValid ? age.filter(a => !a.invalidQuantity && (a.bands[3] ?? 0) > 0).length : '—'}个`, `60+库存 ${reportQuantity(bandTotals[3])}件`]
    },
    {
      label: '当月订单满足率',
      value: fulfillmentRate === null ? null : fulfillmentRate * 100,
      unit: '%',
      note: '工厂提货，排除饺鲜说；完成状态待确认',
      auxiliaries: [`需求量 ${reportQuantity(need)}件`, `履约缺货 ${reportQuantity(unfilled)}件`]
    },
    {
      label: '当前订单',
      value: order,
      unit: '件',
      auxiliaries: [
        shortage === null ? '缺货无法确认' : `${missingShortageCount ? '已核验缺货（部分）' : '测算缺货'} ${reportQuantity(shortage)}件`,
        `占用量 ${reportQuantity(allocated)}件`
      ]
    }
  ]
  const compact = (v: number | null) => (v === null ? '待核验' : `${Math.abs(v) >= 10000 ? `${reportQuantity(v / 10000, 1)}万` : reportQuantity(v)}件`)
  const summary = [
    `当前库存${compact(current)}，对${missingTargetCount ? '已知' : ''}目标差额${compact(gap)}${missingTargetCount ? '（部分）' : ''}；平均货龄${averageAge === null ? '待核验' : `${reportQuantity(averageAge, 1)}天`}，41–60天${compact(bandTotals[2])}、60+ ${compact(bandTotals[3])}。${qualityIssues.length ? '关键数据不完整，相关判断待核验。' : '库存高低需结合需求与货龄判断。'}`,
    `风险按当前订单缺货、货龄、滞库顺序复核：${shortage === null ? '订单缺口暂不可判断' : `${missingShortageCount ? '已核验' : '当前'}订单缺口${compact(shortage)}`}；货龄关注大日期候选及即将转超龄对象；${!movementComparable.length ? '滞库数据待核验' : `已核验滞库${movingRisks.length}个SKU`}，按动销及需求计划覆盖区分处理。`,
    '先核对订单交付和补货保障，再确认大日期专项进度及临期消化，最后推动滞库拉货、调剂与生产节奏调整。缺失依据先补齐，历史处理结果以有效反馈复核。'
  ]
  const partial = qualityIssues.length > 0 || missingTargetCount > 0 || missingDemandCount > 0 || missingMovementCount > 0 || shortage === null || averageAge === null
  return {
    coreMetrics,
    modules,
    qualityIssues,
    status: partial ? '部分生成' : '已生成',
    riskLevel: partial ? '数据待核验' : '存在待复核事项',
    visibleObjectKeys: [...allowed],
    title: '库存运营日报',
    date,
    generatedAt: input.generatedAt,
    scope: input.localPreview ? '本地验证范围' : '当前权限范围',
    bases,
    localPreview: input.localPreview,
    empty: current === null,
    summary,
    metrics: [
      {
        label: '当前库存',
        value: current,
        unit: '件',
        note: stock.length ? '目标库存主表口径' : '货龄表口径'
      },
      {
        label: missingTargetCount ? '已知目标库存' : '目标库存',
        value: target,
        unit: '件',
        note: missingTargetCount ? `${missingTargetCount}个对象缺目标` : input.targetVersion
      },
      {
        label: missingTargetCount ? '库存差额（对已知目标）' : '库存差额',
        value: gap,
        unit: '件'
      },
      {
        label: '周转天数',
        value: turnover,
        unit: '天',
        note: missingDemandCount ? '部分：库存÷已知日均计划量' : '库存÷日均计划量'
      },
      {
        label: '目标天数',
        value: targetTurnover,
        unit: '天',
        note: missingTargetCount ? '按已知目标计算' : undefined
      },
      {
        label: '平均货龄',
        value: averageAge,
        unit: '天',
        note: '货龄表按库存量加权'
      },
      {
        label: '当月订单满足率',
        value: fulfillmentRate === null ? null : fulfillmentRate * 100,
        unit: '%',
        note: '沿用履约口径，完成状态待确认'
      },
      { label: '当前订单量', value: order, unit: '件' },
      {
        label: '当前缺货量',
        value: shortage,
        unit: '件',
        note: missingShortageCount ? '部分：仅已核验对象测算线索' : '测算线索'
      },
      { label: '当前占用量', value: allocated, unit: '件' },
      {
        label: missingMovementCount ? '已知近30日量' : '近30日量',
        value: knownTotal(stock.map(row => row.shipment30)),
        unit: '件',
        note: '基地/SKU粒度'
      }
    ],
    ageInventory,
    ageBands: ['0–30天（含30）', '31–40天', '41–60天', '60+天', '货龄未知'].map((label, index) => ({
      label,
      quantity: bandTotals[index],
      share: ageInventory !== null && ageInventory > 0 && bandTotals[index] !== null ? bandTotals[index]! / ageInventory : null,
      objects:
        age
          .filter(row => !row.invalidQuantity && (row.bands[index] ?? 0) > 0)
          .sort((a, b) => (b.bands[index] ?? 0) - (a.bands[index] ?? 0))
          .slice(0, 2)
          .map(objectName)
          .join('；') || '—'
    })),
    risks: input.includeAllRisks ? risks : selectedRisks,
    riskCount: risks.length,
    missingTargetCount,
    missingMovementCount,
    sources,
    notes
  }
}
