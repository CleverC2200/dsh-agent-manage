import type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../contracts/lsp-status.js'
import type { LspMountDiagnostic } from './lsp-mounts.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { LspServerSpec, Suite } from '../model/types.js'

export const DIRECT_LSP_SUITE_ID = 'direct'

export interface LspMountStatusSource {
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic>
  hasLiveMounts(): boolean
  disabledServers?(): Set<string>
}

export interface LspDirectServersSource {
  servers: Record<string, LspServerSpec>
  errors: string[]
}

function deriveState(disabled: boolean, diagnostic: LspMountDiagnostic | undefined, anyLive: boolean): { state: LspStatusState; reason?: string; retryable?: boolean } {
  if (disabled) return { state: 'disabled' }
  if (diagnostic?.code === 'host-missing') return { state: 'host-missing', reason: diagnostic.reason }
  if (diagnostic?.code === 'seam-conflict') return { state: 'conflict', reason: diagnostic.reason }
  if (diagnostic?.code === 'mount-failed' || diagnostic?.code === 'unmount-failed') {
    return { state: 'failed', reason: diagnostic.reason, retryable: true }
  }
  if (diagnostic !== undefined) return { state: 'failed', reason: diagnostic.reason }
  if (anyLive) return { state: 'mounted' }

  return { state: 'starting' }
}

export function buildLspStatus(suites: readonly Suite[], registry: LspMountStatusSource, direct: LspDirectServersSource = { servers: {}, errors: [] }): LspStatusPayload {
  const diagnostics = registry.diagnosticsSnapshot()
  const anyLive = registry.hasLiveMounts()
  const disabledServers = registry.disabledServers?.() ?? new Set<string>()
  const entries: LspStatusEntry[] = []
  const mountedSuiteIds = new Set<number | string>()
  for (const suite of suites) {
    if (suite.lsp === undefined || suite.installedAt === undefined || !suite.enabled) continue
    const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
    const disabled = suite.activeSurfaces?.lsp === false
    const diagnostic = diagnostics.get(suiteKey)
    const { state, reason, retryable } = deriveState(disabled, diagnostic, anyLive)
    if (state === 'mounted') mountedSuiteIds.add(suiteKey)
    for (const spec of Object.values(suite.lsp.servers)) {
      entries.push({
        id: `${suiteKey}/${spec.key}`,
        serverKey: spec.key,
        suiteId: suiteKey,
        suiteName: suite.manifest.name,
        sourceId: suite.sourceId,
        kind: 'plugin',
        command: spec.command,
        args: spec.args,
        extensions: spec.extensionToLanguage,
        state: disabled || disabledServers.has(`${suiteKey}/${spec.key}`) ? 'disabled' : state,
        ...(reason === undefined ? {} : { reason }),
        ...(retryable === undefined ? {} : { retryable })
      })
    }
  }

  const directDiagnostic = diagnostics.get(DIRECT_LSP_SUITE_ID)
  const { state: directState, reason: directReason, retryable: directRetryable } = deriveState(false, directDiagnostic, anyLive)
  if (directState === 'mounted') mountedSuiteIds.add(DIRECT_LSP_SUITE_ID)
  for (const spec of Object.values(direct.servers)) {
    entries.push({
      id: `${DIRECT_LSP_SUITE_ID}/${spec.key}`,
      serverKey: spec.key,
      suiteId: DIRECT_LSP_SUITE_ID,
      suiteName: spec.key,
      sourceId: '',
      kind: 'direct',
      command: spec.command,
      args: spec.args,
      extensions: spec.extensionToLanguage,
      state: disabledServers.has(`${DIRECT_LSP_SUITE_ID}/${spec.key}`) ? 'disabled' : directState,
      ...(directReason === undefined ? {} : { reason: directReason }),
      ...(directRetryable === undefined ? {} : { retryable: directRetryable })
    })
  }
  const mounted = entries.filter(entry => entry.state === 'mounted').length
  const failed = entries.filter(entry => entry.state === 'failed').length
  const disabled = entries.filter(entry => entry.state === 'disabled').length
  const blocked = entries.filter(entry => entry.state === 'host-missing' || entry.state === 'conflict').length
  return {
    entries,
    observedAt: new Date().toISOString(),
    totals: { all: entries.length, mounted, failed, blocked, disabled },
    hostMissing: entries.length > 0 && mountedSuiteIds.size === 0 && entries.every(entry => entry.state === 'host-missing')
  }
}
