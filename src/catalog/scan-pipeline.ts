import type { Suite } from '../model/types.js'

export interface ScanContext {
  marketplacePath?: string

  checkout: string

  sourceId: string

  dimension: 'user' | 'project'

  sourceUrl?: string

  notes: string[]
}

export type ScanAbstentionReason = string

export type ScanResolution = { kind: 'resolved'; suites: Suite[] } | { kind: 'abstain'; reason: ScanAbstentionReason }

export interface ScanChain {
  next(context: ScanContext): Promise<ScanResolution>
}

export interface ScanFilter {
  readonly name: string

  doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution>
}

export interface ScanAttempt {
  filter: string
  outcome: 'resolved' | 'abstain'

  detail: string

  suiteIds: string[]
}

export interface ScanResult {
  marketplacePath?: string
  suites: Suite[]
  attempts: ScanAttempt[]

  notes: string[]
}

export async function runScanChain(filters: readonly ScanFilter[], context: ScanContext): Promise<ScanResult> {
  const attempts: ScanAttempt[] = []
  const notes = context.notes

  const run = async (index: number): Promise<ScanResolution> => {
    const filter = filters[index]
    if (filter === undefined) {
      return { kind: 'resolved', suites: [] }
    }

    const productive = (resolution: ScanResolution): resolution is { kind: 'resolved'; suites: Suite[] } => resolution.kind === 'resolved' && resolution.suites.length > 0

    let delegated = false
    const remaining: ScanChain = {
      next: _ctx => {
        delegated = true
        return run(index + 1)
      }
    }
    const resolution = await filter.doScan(context, remaining)

    if (delegated) {
      attempts.push({ filter: filter.name, outcome: 'abstain', detail: 'delegated', suiteIds: [] })
      return resolution
    }
    const hit = productive(resolution)
    attempts.push({
      filter: filter.name,
      outcome: hit ? 'resolved' : 'abstain',
      detail: hit ? `${resolution.suites.length} suite(s)` : resolution.kind === 'abstain' ? resolution.reason : '0 suite(s)',
      suiteIds: hit ? resolution.suites.map(suite => suite.id) : []
    })
    if (!hit) {
      if (resolution.kind === 'abstain') {
        notes.push(`filter "${filter.name}" abstained: ${resolution.reason}`)
      } else {
        notes.push(`filter "${filter.name}" recognized the checkout but produced no suites; falling through`)
      }

      return run(index + 1)
    }
    return resolution
  }
  const resolution = await run(0)
  return {
    suites: resolution.kind === 'resolved' ? resolution.suites : [],
    attempts,
    notes,
    ...(context.marketplacePath === undefined ? {} : { marketplacePath: context.marketplacePath })
  }
}
