export type Risk = {
  id: string
  objectId: string
  object: string
  sku: string
  productName?: string
  category: string
  type: string
  tags: string[]
  priority: number
  issue: string
  action: string
  role: string
  details: unknown
}
export type MetricKey = 'inventory' | 'target' | 'age' | 'shortage' | 'stagnant' | 'over30'
export type ObjectData = {
  categories?: (ObjectData & { category: string })[]
  id: string
  name: string
  kind: 'base' | 'branch'
  inventory: number | null
  target: number | null
  age: number | null
  ageWeight: number | null
  shortage: number | null
  stagnant: number | null
  over30?: number | null
  partial?: Partial<Record<MetricKey, boolean>>
  snapshot: string
  risks: Risk[]
  error?: string
}
export const known = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
export const sum = (values: (number | null)[]) => (values.length && values.every(v => v !== null) ? values.reduce<number>((n, v) => n + v!, 0) : null)
export function summarize(objects: ObjectData[]) {
  const total = (key: MetricKey) => sum(objects.map(o => known(o[key])).filter(v => v !== null))
  const inventory = total('inventory'),
    target = total('target')
  const comparable = objects.filter(o => o.inventory !== null && o.target !== null)
  const ageObjects = objects.filter(o => o.age !== null && o.ageWeight !== null && o.ageWeight > 0)
  const weight = sum(ageObjects.map(o => o.ageWeight))
  const age = weight !== null && weight > 0 ? ageObjects.reduce((n, o) => n + o.age! * o.ageWeight!, 0) / weight : null
  const partial = Object.fromEntries(
    (['inventory', 'target', 'age', 'shortage', 'stagnant', 'over30'] as MetricKey[]).map(key => [
      key,
      objects.some(o => o.partial?.[key] || (key === 'age' ? o.age === null && o.ageWeight !== 0 : known(o[key]) === null))
    ])
  ) as Record<MetricKey, boolean>
  return {
    inventory,
    target,
    gap: sum(comparable.map(o => o.inventory! - o.target!)),
    age,
    over30: total('over30'),
    shortage: total('shortage'),
    stagnant: new Set(objects.map(o => o.kind)).size > 1 ? null : total('stagnant'),
    partial: { ...partial, gap: partial.inventory || partial.target },
    mixedStagnant: new Set(objects.map(o => o.kind)).size > 1
  }
}
export function dedupeRisks(risks: Risk[]) {
  const merged = new Map<string, Risk>()
  for (const risk of risks) {
    const key = JSON.stringify([risk.objectId, risk.sku || risk.id])
    const old = merged.get(key)
    if (!old) {
      merged.set(key, {
        ...risk,
        tags: [...new Set([risk.type, ...risk.tags])]
      })
      continue
    }
    const first = risk.priority < old.priority ? risk : old
    merged.set(key, {
      ...first,
      tags: [...new Set([...old.tags, risk.type, ...risk.tags])]
    })
  }
  return [...merged.values()].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
}
