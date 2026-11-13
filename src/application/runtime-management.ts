import type { Context } from '@deepseek-ai/cordis'
import type { Suite } from '../model/types.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { RuntimeReconciler } from '../runtime/reconciler.js'
import type { HostTranslate } from '../runtime/host-locale.js'
import { cancelAuthorization, connectionState } from '../runtime/mcp-client/bridge.js'
import { buildMcpStatus, type McpToolSnapshot } from '../runtime/mcp-status.js'
import { addUserMcpServer, loadUserMcpSuite, USER_MCP_SOURCE, USER_MCP_SUITE } from '../runtime/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { buildLspStatus } from '../runtime/lsp-status.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from '../runtime/lsp-server-state.js'
import {
  effectiveSuiteOverrides,
  suiteOverridePath,
  applyOverride,
  loadSuiteOverrides,
  mergeOverridePatch,
  saveSuiteOverrides,
  type McpServerOverride,
  type McpSuiteOverrides
} from '../runtime/mcp-overrides.js'
import { applyLspOverrides, lspConfig, restoreRedactedConfig, saveLspOverride, validateServerLsp, validateServerMcp } from '../runtime/server-config.js'
import { probeHostMcpClient, type HostMcpClientProbe, type McpBackend } from '../runtime/mcp-backend.js'
import { resolveRegion, type DownloadRegionSetting, type EffectiveRegion } from '../runtime/regions.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { redactMcpConfig, redactMcpOverrides } from '../runtime/mcp-redaction.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { ServerConfigPayload } from '../contracts/market.js'

export interface RuntimeHost {
  ctx: Context
  translate: HostTranslate
  backend(): Promise<McpBackend>
  writeBackend(backend: McpBackend): Promise<void>
  tools(): readonly McpToolSnapshot[]
  deleteGrantRecord(serverName: string): Promise<void>
}

interface RuntimeCatalog {
  suites(): Promise<Suite[]>
  enabledSuites(): Promise<Suite[]>
  resolveSuite(sourceId: string, suiteId: string): Promise<Suite>
  change<T>(operation: () => Promise<T>): Promise<T>
  downloadRegion(): Promise<DownloadRegionSetting>
}

export class RuntimeManagement {
  private readonly reconciler: RuntimeReconciler | undefined
  private diagnostics: McpMountDiagnostic[] = []
  private requested = false
  private reconciliation: Promise<void> | undefined
  private disposed = false
  private credentialFlush: ReturnType<typeof setTimeout> | undefined
  private readonly stopCredentials: () => void

  constructor(
    private readonly dataRoot: string,
    private readonly catalog: RuntimeCatalog,
    private readonly host?: RuntimeHost
  ) {
    if (host !== undefined) {
      const runtime = new RuntimeReconciler(host.ctx, dataRoot, host.translate)
      this.reconciler = runtime
      runtime.mcp.setOverridesProvider(async () => this.allMcpOverrides(await catalog.enabledSuites()))
      runtime.mcp.setBackendProvider(() => this.mcpBackend())
      runtime.mcp.setToolNamesProvider(() => host.tools().map(tool => tool.name))
      runtime.lsp.setDirectProvider(async () => (await loadLspServers(dataRoot)).servers)
      runtime.lsp.setDisabledProvider(() => loadDisabledLspServers(dataRoot))
      const eventHost = host.ctx as unknown as { on?: (event: string, listener: (ref: string) => void) => () => void }
      this.stopCredentials =
        eventHost.on?.('credentials/reference-updated', () => {
          if (this.disposed) return
          if (this.credentialFlush !== undefined) clearTimeout(this.credentialFlush)
          this.credentialFlush = setTimeout(() => {
            this.credentialFlush = undefined
            void this.reconcile().catch(() => {})
          }, 150)
          this.credentialFlush.unref?.()
        }) ?? (() => {})
    } else this.stopCredentials = () => {}
  }

  get mcpDiagnostics(): McpMountDiagnostic[] {
    return this.diagnostics
  }

  reconcile(): Promise<void> {
    const runtime = this.reconciler
    if (this.disposed || runtime === undefined) return Promise.resolve()
    this.requested = true
    this.reconciliation ??= (async () => {
      try {
        do {
          this.requested = false
          const suites = await this.catalog.enabledSuites()
          if (this.disposed) return
          const diagnostics = await runtime.reconcile(suites)
          if (this.disposed) return
          this.diagnostics = diagnostics.mcp
          for (const diagnostic of diagnostics.mcp) this.warn(`suite "${diagnostic.suiteId}" mcp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
          for (const diagnostic of diagnostics.lsp) this.warn(`suite "${diagnostic.suiteId}" lsp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
          for (const diagnostic of diagnostics.commands)
            if (diagnostic.reason !== '') this.warn(`suite "${diagnostic.suiteId}" command "${diagnostic.command}": ${diagnostic.reason}`)
          for (const diagnostic of diagnostics.hooks) this.warn(`suite "${diagnostic.suiteId}" hooks: ${diagnostic.reason}`)
          for (const error of diagnostics.errors) this.warn(`${error.surface} reconcile failed: ${error.reason}`)
        } while (this.requested && !this.disposed)
      } catch (error) {
        this.warn(`runtime reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      } finally {
        this.reconciliation = undefined
      }
    })()
    return this.reconciliation
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.stopCredentials()
    if (this.credentialFlush !== undefined) clearTimeout(this.credentialFlush)
    this.credentialFlush = undefined
    await Promise.all([this.reconciliation?.catch(() => {}), this.reconciler?.dispose()])
  }

  private warn(message: string): void {
    this.host?.ctx.logger?.warn(`[dsh-agent-plugins-market] ${message}`)
  }

  async reauthorizeMcpServer(serverName: string): Promise<void> {
    await this.catalog.change(async () => {
      await this.host?.deleteGrantRecord(serverName)

      const key = this.reconciler?.mcp.serverOwner(serverName)
      if (key !== undefined) this.reconciler?.mcp.forceRemount(key.suiteId, key.serverKey)
    })
  }

  cancelMcpAuthorization(serverName: string): void {
    if (this.host) cancelAuthorization(this.host.ctx.root, serverName)
  }

  mcpReauthorizeAvailable(): boolean {
    return this.host !== undefined
  }

  async mcpStatus(): Promise<McpStatusPayload> {
    const suitesSnapshot = await this.catalog.suites()
    const suites = [...suitesSnapshot, await loadUserMcpSuite(this.dataRoot)]
    const storedOverrides = new Map(
      await Promise.all(
        suites.map(async suite => {
          const key = qualifiedSuiteId(suite.sourceId, suite.id)
          return [key, await loadSuiteOverrides(this.dataRoot, key)] as const
        })
      )
    )
    const overrides = new Map([...storedOverrides].map(([key, stored]) => [key, effectiveSuiteOverrides(key, stored)]))
    const payload = buildMcpStatus(suites, this.mcpDiagnostics, this.host?.tools() ?? [], overrides)
    for (const entry of payload.entries)
      if (entry.suiteId === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) {
        entry.kind = 'direct'
        entry.managed = true
      }
    const oauthBackend = (await this.mcpBackend()) === 'builtin' && this.mcpReauthorizeAvailable()
    for (const entry of payload.entries) {
      if (this.host) entry.connectionState = connectionState(this.host.ctx.root, entry.name)
      if (entry.connectionState === 'connected' && !['disabled', 'foreign', 'orphaned'].includes(entry.state)) entry.state = 'connected'
      if (entry.kind === 'plugin' && entry.suiteId && entry.serverKey) {
        const stored = storedOverrides.get(entry.suiteId)?.[entry.serverKey]
        if (stored && Object.keys(stored).some(key => key !== 'enabled')) {
          const diagnostic = `PLUGIN_MCP_OVERRIDE_RETIRED: connection edits are preserved at ${suiteOverridePath(this.dataRoot, entry.suiteId)}; create a personal Agent connection to customize them`
          entry.reason = entry.reason ? `${entry.reason}; ${diagnostic}` : diagnostic
        }
      }
      const auth = entry.config?.auth as { enabled?: boolean } | undefined
      entry.canReauthorize =
        oauthBackend &&
        (entry.kind === 'plugin' || entry.managed === true) &&
        (entry.transport === 'sse' || entry.transport === 'streamable-http') &&
        auth?.enabled !== false &&
        !['disabled', 'foreign', 'orphaned'].includes(entry.state)
    }
    for (const key of ['connected', 'degraded', 'failed', 'orphaned', 'disabled', 'foreign'] as const)
      payload.totals[key] = payload.entries.filter(entry => entry.state === key).length
    return payload
  }

  async addMcpServer(name: string, server: unknown, sourceRoot?: string): Promise<void> {
    return this.catalog.change(async () => {
      await addUserMcpServer(this.dataRoot, name, server, sourceRoot)
    })
  }

  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    const config = await this.resolveServerConfig(kind, id)
    return { kind, id, editable: kind !== 'mcp' || config.suiteKey === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`, config: redactMcpConfig(config.value) as Record<string, unknown> }
  }

  async sourceSyncConfig(id: string): Promise<{ base: unknown; local: unknown }> {
    const current = await this.resolveServerConfig('mcp', id)
    const suite = await loadUserMcpSuite(this.dataRoot)
    const base = suite.mcp?.servers[current.key]
    if (!base) throw Error('AGENT_SOURCE_MCP_BASE_MISSING')
    return { base, local: current.value }
  }

  private async resolveServerConfig(kind: 'mcp' | 'lsp', id: string) {
    if (kind === 'lsp' && id.startsWith('direct/')) {
      const key = id.slice(7)
      const server = (await loadLspServers(this.dataRoot)).servers[key]
      if (server === undefined) throw new Error('LSP server not found')
      return { key, suiteKey: 'direct', root: this.dataRoot, value: lspConfig(server) }
    }
    const suites = [...(await this.catalog.suites()), await loadUserMcpSuite(this.dataRoot)]
    for (const suite of await applyLspOverrides(this.dataRoot, suites)) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      if (kind === 'mcp') {
        for (const [key, server] of Object.entries(suite.mcp?.servers ?? {})) {
          if (id !== `plugin:${suiteKey}/${key}`) continue
          const overrides = await loadSuiteOverrides(this.dataRoot, suiteKey)
          return { key, suiteKey, root: suite.mcp?.serverRoots?.[key] ?? suite.root, value: { ...applyOverride(server, effectiveSuiteOverrides(suiteKey, overrides)[key]) } }
        }
      } else {
        for (const [key, server] of Object.entries(suite.lsp?.servers ?? {})) {
          if (id === `${suiteKey}/${key}`) return { key, suiteKey, root: suite.root, value: lspConfig(server) }
        }
      }
    }
    throw new Error('service configuration is not managed by this plugin')
  }

  async saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown): Promise<void> {
    return this.catalog.change(async () => {
      const current = await this.resolveServerConfig(kind, id)
      if (kind === 'mcp' && current.suiteKey !== `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) throw Error('PLUGIN_MCP_EDIT_FORBIDDEN')
      const value = restoreRedactedConfig(config, current.value)
      if (kind === 'mcp') {
        const server = await validateServerMcp(current.root, current.key, value)
        const overrides = await loadSuiteOverrides(this.dataRoot, current.suiteKey)
        const enabled = overrides[current.key]?.enabled
        overrides[current.key] = { config: server, ...(enabled === undefined ? {} : { enabled }) }
        await saveSuiteOverrides(this.dataRoot, current.suiteKey, overrides)
      } else {
        const server = validateServerLsp(current.key, value)
        if (current.suiteKey === 'direct') {
          const direct = await loadLspServers(this.dataRoot)
          if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
          direct.servers[current.key] = server
          await saveLspServers(this.dataRoot, { lspServers: Object.fromEntries(Object.entries(direct.servers).map(([key, spec]) => [key, lspConfig(spec)])) })
        } else await saveLspOverride(this.dataRoot, id, server)
      }
    })
  }

  async lspStatus(): Promise<LspStatusPayload> {
    const suitesSnapshot = await this.catalog.suites()
    const direct = await loadLspServers(this.dataRoot)
    return buildLspStatus(
      await applyLspOverrides(this.dataRoot, suitesSnapshot),
      this.reconciler?.lsp ?? { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false },
      direct
    )
  }

  async lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return (await loadLspServers(this.dataRoot)).servers
  }

  async addLspServer(name: string, config: unknown): Promise<void> {
    return this.catalog.change(async () => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid LSP server name')
      const direct = await loadLspServers(this.dataRoot)
      if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
      if (Object.hasOwn(direct.servers, name)) throw new Error('LSP server already exists')
      const spec = validateServerLsp(name, config)
      await saveLspServers(this.dataRoot, {
        lspServers: { ...Object.fromEntries(Object.entries(direct.servers).map(([key, value]) => [key, lspConfig(value)])), [name]: lspConfig(spec) }
      })
    })
  }

  async setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return this.catalog.change(async () => {
      const { servers } = await saveLspServers(this.dataRoot, raw)
      return servers
    })
  }

  async setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
    return this.catalog.change(async () => {
      const disabled = await loadDisabledLspServers(this.dataRoot)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      await saveDisabledLspServers(this.dataRoot, disabled)
    })
  }

  async mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    const suitesSnapshot = await this.catalog.suites()
    if (!suitesSnapshot.some(suite => suite.sourceId === sourceId && suite.id === suiteId)) throw new Error(`suite "${suiteKey}" not found`)
    return redactMcpOverrides(await loadSuiteOverrides(this.dataRoot, suiteKey))
  }

  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    return this.catalog.change(async () => {
      const suiteKey = qualifiedSuiteId(sourceId, suiteId)
      if ((sourceId !== USER_MCP_SOURCE || suiteId !== USER_MCP_SUITE) && (override === null || Object.keys(override).some(key => key !== 'enabled')))
        throw Error('PLUGIN_MCP_EDIT_FORBIDDEN')
      const suite = sourceId === USER_MCP_SOURCE && suiteId === USER_MCP_SUITE ? await loadUserMcpSuite(this.dataRoot) : await this.catalog.resolveSuite(sourceId, suiteId)
      if (suite.mcp?.servers[serverKey] === undefined) throw new Error(`server "${serverKey}" is not defined by suite "${suiteId}"`)

      const overrides = await loadSuiteOverrides(this.dataRoot, suiteKey)
      if (override === null) {
        delete overrides[serverKey]
      } else {
        overrides[serverKey] = mergeOverridePatch(overrides[serverKey] ?? {}, override)
      }
      await saveSuiteOverrides(this.dataRoot, suiteKey, overrides)
    })
  }

  async retryMounts(): Promise<void> {
    await this.catalog.change(async () => {})
  }

  async mcpBackend(): Promise<McpBackend> {
    return this.host?.backend() ?? Promise.resolve('builtin')
  }

  async mcpBackendInfo(): Promise<{
    backend: McpBackend
    hostClient: HostMcpClientProbe
    downloadRegion: { setting: DownloadRegionSetting; effective: EffectiveRegion }
  }> {
    const [backend, hostClient, regionSetting, locale] = await Promise.all([this.mcpBackend(), probeHostMcpClient(), this.catalog.downloadRegion(), readLocalePreference()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, locale) } }
  }

  async setMcpBackend(backend: McpBackend): Promise<void> {
    return this.catalog.change(async () => {
      if (this.host === undefined) throw new Error('the settings service is not mounted')
      await this.host.writeBackend(backend)
    })
  }

  async allMcpOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>> {
    const map = new Map<string, McpSuiteOverrides>()
    for (const suite of suites ?? (await this.catalog.suites())) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      const overrides = await loadSuiteOverrides(this.dataRoot, suiteKey)
      if (Object.keys(overrides).length > 0) map.set(suiteKey, effectiveSuiteOverrides(suiteKey, overrides))
    }
    return map
  }
}
