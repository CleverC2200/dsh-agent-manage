import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { AgentSourceResolution } from '../contracts/agent-sources.js'

export const sourceResolutions = z
  .record(
    z.string(),
    z.discriminatedUnion('choice', [
      z.object({ choice: z.literal('local') }).strict(),
      z.object({ choice: z.literal('upstream') }).strict(),
      z.object({ choice: z.literal('manual'), value: z.unknown() }).strict()
    ])
  )
  .default({})

export interface SourceSyncEntry {
  key: string
  base: unknown
  local: unknown
  upstream: unknown
  conflict: boolean
  localChanged: boolean
  upstreamChanged: boolean
}

export function sourceSyncEntry(key: string, base: unknown, local: unknown, upstream: unknown): SourceSyncEntry {
  return {
    key,
    base,
    local,
    upstream,
    localChanged: !isDeepStrictEqual(local, base),
    upstreamChanged: !isDeepStrictEqual(upstream, base),
    conflict: !isDeepStrictEqual(local, base) && !isDeepStrictEqual(upstream, base) && !isDeepStrictEqual(local, upstream)
  }
}

export function resolveSourceEntry(row: SourceSyncEntry, resolution?: AgentSourceResolution, manual = (value: unknown): unknown => value): unknown {
  if (row.conflict && !resolution) throw Error(`AGENT_SOURCE_CONFLICT_UNRESOLVED: ${row.key}`)
  if (resolution?.choice === 'local') return row.local
  if (resolution?.choice === 'upstream') return row.upstream
  if (resolution?.choice === 'manual') return manual(resolution.value)
  return row.localChanged ? row.local : row.upstream
}
