/** Resource runtime operations share one owner for configuration, live mounts and their lifecycle. */
import type { Context } from '@deepseek-ai/cordis'
import type { Suite } from '../model/types.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { RuntimeReconciler } from '../runtime/reconciler.js'
import type { HostTranslate } from '../runtime/host-locale.js'
import { connectionState } from '../runtime/mcp-client/bridge.js'
import { buildMcpStatus, type McpToolSnapshot } from '../runtime/mcp-status.js'
import { addUserMcpServer, loadUserMcpSuite, USER_MCP_SOURCE, USER_MCP_SUITE } from '../runtime/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { buildLspStatus } from '../runtime/lsp-status.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from '../runtime/lsp-server-state.js'
import { applyOverride, loadSuiteOverrides, mergeOverridePatch, saveSuiteOverrides, type McpServerOverride, type McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import { applyLspOverrides, lspConfig, restoreRedactedConfig, saveLspOverride, validateServerLsp, validateServerMcp } from '../runtime/server-config.js'
import { probeHostMcpClient, type HostMcpClientProbe, type McpBackend } from '../runtime/mcp-backend.js'
import { resolveRegion, type DownloadRegionSetting, type EffectiveRegion } from '../runtime/regions.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { redactMcpConfig, redactMcpOverrides } from '../runtime/mcp-redaction.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { ServerConfigPayload } from '../contracts/market.js'

/** Host adapters are resolved lazily because Cordis services can arrive after Manage. */
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

  /** Latest completed mount diagnostics, also used in Catalog's coherent market projection. */
  get mcpDiagnostics(): McpMountDiagnostic[] {
    return this.diagnostics
  }

  /** Coalesce slow mounts into the current pass and one fresh follow-up snapshot. */
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

  /** Stop events and release each surface after its own active pass, without delaying local cleanup behind MCP. */
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

  /**
   * Drop one MCP server's OAuth grant record so the next mount re-runs the
   * browser authorization — the path for "I picked too narrow a scope".
   * @param serverName - the derived serverName whose folded form keys the record.
   * @throws when the credentials service is not mounted.
   * 中文：删除指定服务的授权记录，标记其挂载键重建，并触发一次运行时协调。
   */
  async reauthorizeMcpServer(serverName: string): Promise<void> {
    await this.catalog.change(async () => {
      await this.host?.deleteGrantRecord(serverName)
      // Dropping a grant changes no resolved config field, so a fingerprint
      // reconcile would keep the live bridge — with its in-memory tokens —
      // untouched. The serverName maps back to exactly one mount key (the
      // registry reserved the name), so flag it for an explicit rebuild.
      // 中文：授权记录删除不改变配置指纹，必须显式标记挂载重建才能清掉内存令牌。
      const key = this.reconciler?.mcp.serverOwner(serverName)
      if (key !== undefined) this.reconciler?.mcp.forceRemount(key.suiteId, key.serverKey)
    })
  }

  /** Whether the re-authorize action can run in this composition. */
  /** 中文：报告当前宿主组合是否提供凭据存储。 */
  mcpReauthorizeAvailable(): boolean {
    return this.host !== undefined
  }

  /** Build the flat MCP service inventory for the status surface. */
  /** 中文：合并套件、用户直配服务、挂载诊断和工具快照，生成 MCP 平面清单。 */
  async mcpStatus(): Promise<McpStatusPayload> {
    const suitesSnapshot = await this.catalog.suites()
    const suites = [...suitesSnapshot, await loadUserMcpSuite(this.dataRoot)]
    const payload = buildMcpStatus(suites, this.mcpDiagnostics, this.host?.tools() ?? [], await this.allMcpOverrides(suites))
    for (const entry of payload.entries)
      if (entry.suiteId === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) {
        entry.kind = 'direct'
        entry.managed = true
      }
    const oauthBackend = (await this.mcpBackend()) === 'builtin' && this.mcpReauthorizeAvailable()
    for (const entry of payload.entries) {
      if (this.host) entry.connectionState = connectionState(this.host.ctx.root, entry.name)
      if (entry.connectionState === 'connected' && !['disabled', 'foreign', 'orphaned'].includes(entry.state)) entry.state = 'connected'
      const auth = entry.config?.auth as { enabled?: boolean } | undefined
      entry.canReauthorize =
        oauthBackend &&
        (entry.kind === 'plugin' || entry.managed === true) &&
        (entry.transport === 'sse' || entry.transport === 'streamable-http') &&
        auth?.enabled !== false &&
        !['disabled', 'foreign', 'orphaned'].includes(entry.state)
    }
    for (const key of ['connected', 'degraded', 'failed', 'orphaned', 'disabled', 'foreign'] as const) payload.totals[key] = payload.entries.filter(entry => entry.state === key).length
    return payload
  }

  /** Persist a user-owned MCP service and reconcile its bridge mount. */
  /** 中文：保存用户直配 MCP 服务，并通知宿主重新协调其挂载。 */
  async addMcpServer(name: string, server: unknown, sourceRoot?: string): Promise<void> {
    return this.catalog.change(async () => {
      await addUserMcpServer(this.dataRoot, name, server, sourceRoot)
    })
  }

  /** Read effective service configuration without exposing credential literals. */
  /** 中文：读取服务生效配置并脱敏凭据，供客户端详情编辑器使用。 */
  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    const config = await this.resolveServerConfig(kind, id)
    return { kind, id, editable: kind !== 'mcp' || config.suiteKey === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`, config: redactMcpConfig(config.value) as Record<string, unknown> }
  }

  /** 按客户端服务 ID 定位套件或直配服务，并返回可编辑配置上下文。 */
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
          return { key, suiteKey, root: suite.mcp?.serverRoots?.[key] ?? suite.root, value: { ...applyOverride(server, overrides[key]) } }
        }
      } else {
        for (const [key, server] of Object.entries(suite.lsp?.servers ?? {})) {
          if (id === `${suiteKey}/${key}`) return { key, suiteKey, root: suite.root, value: lspConfig(server) }
        }
      }
    }
    throw new Error('service configuration is not managed by this plugin')
  }

  /** Validate a complete replacement before writing; plugin checkouts remain untouched. */
  /** 中文：校验完整替换配置并写入覆盖层/直配文件，不修改插件源检出内容。 */
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

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  /** 中文：合并套件声明、用户直配服务和挂载诊断，生成 LSP 状态面板数据。 */
  async lspStatus(): Promise<LspStatusPayload> {
    const suitesSnapshot = await this.catalog.suites()
    const direct = await loadLspServers(this.dataRoot)
    return buildLspStatus(
      await applyLspOverrides(this.dataRoot, suitesSnapshot),
      this.reconciler?.lsp ?? { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false },
      direct
    )
  }

  /** The user's direct LSP server table (normalized specs). */
  /** 中文：读取用户直接配置且已规范化的 LSP 服务表。 */
  async lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return (await loadLspServers(this.dataRoot)).servers
  }

  /** Create one direct LSP declaration without replacing other user servers. */
  /** 中文：校验并新增一个用户直配 LSP，不覆盖现有服务。 */
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

  /** Validate and persist the user's direct LSP server table. */
  /** 中文：校验并整体保存用户直配 LSP 服务表，然后触发挂载协调。 */
  async setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return this.catalog.change(async () => {
      const { servers } = await saveLspServers(this.dataRoot, raw)
      return servers
    })
  }

  /** 切换单个用户直配 LSP 的禁用集合记录，并触发状态刷新。 */
  async setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
    return this.catalog.change(async () => {
      const disabled = await loadDisabledLspServers(this.dataRoot)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      await saveDisabledLspServers(this.dataRoot, disabled)
    })
  }

  /** One suite's persisted MCP overrides, addressed by qualified suite id. */
  /** 中文：读取指定套件的 MCP 覆盖配置，并在返回前脱敏。 */
  async mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    const suitesSnapshot = await this.catalog.suites()
    if (!suitesSnapshot.some(suite => suite.sourceId === sourceId && suite.id === suiteId)) throw new Error(`suite "${suiteKey}" not found`)
    return redactMcpOverrides(await loadSuiteOverrides(this.dataRoot, suiteKey))
  }

  /**
   * Set or clear one server's MCP override and remount it. `override === null`
   * clears the override (back to the source config). The serverKey must exist
   * in the suite's parsed mcp.json.
   * 中文：设置或清除指定 MCP 服务覆盖，并在保存后触发重新挂载。
   */
  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    return this.catalog.change(async () => {
      const suiteKey = qualifiedSuiteId(sourceId, suiteId)
      if ((sourceId !== USER_MCP_SOURCE || suiteId !== USER_MCP_SUITE) && (override === null || Object.keys(override).some(key => key !== 'enabled'))) throw Error('PLUGIN_MCP_EDIT_FORBIDDEN')
      const suite = sourceId === USER_MCP_SOURCE && suiteId === USER_MCP_SUITE ? await loadUserMcpSuite(this.dataRoot) : await this.catalog.resolveSuite(sourceId, suiteId)
      if (suite.mcp?.servers[serverKey] === undefined) throw new Error(`server "${serverKey}" is not defined by suite "${suiteId}"`)
      // Override files are keyed by the qualified id so two sources' same-named
      // suites never share one override record.
      // 中文：覆盖文件使用限定套件 ID，避免不同源的同名套件互相覆盖。
      const overrides = await loadSuiteOverrides(this.dataRoot, suiteKey)
      if (override === null) {
        delete overrides[serverKey]
      } else {
        // Merge onto the stored record: the UI never receives literal secret
        // values, so a verbatim write would drop keys it simply redacted.
        // 中文：合并到旧记录，避免客户端脱敏后回写时误删未展示的密钥字段。
        overrides[serverKey] = mergeOverridePatch(overrides[serverKey] ?? {}, override)
      }
      await saveSuiteOverrides(this.dataRoot, suiteKey, overrides)
    })
  }

  /**
   * Re-run the MCP reconcile pass: retries failed mounts and clears residual
   * tools, without changing any catalog state.
   * 中文：仅重新执行 MCP 协调，不改变目录状态。
   */
  async retryMounts(): Promise<void> {
    await this.catalog.change(async () => {})
  }

  /** The persisted backend choice without the host-client probe (mount-time provider). */
  /** 中文：读取持久化后端选择，不额外探测宿主客户端。 */
  async mcpBackend(): Promise<McpBackend> {
    return this.host?.backend() ?? Promise.resolve('builtin')
  }

  /**
   * The active MCP mount backend plus a live probe of the host client, and
   * the download-region setting with its locale-resolved effective route —
   * everything the plugin-config card renders.
   * 中文：返回配置卡所需的后端选择、宿主客户端探针和区域生效线路。
   */
  async mcpBackendInfo(): Promise<{
    backend: McpBackend
    hostClient: HostMcpClientProbe
    downloadRegion: { setting: DownloadRegionSetting; effective: EffectiveRegion }
  }> {
    const [backend, hostClient, regionSetting, locale] = await Promise.all([this.mcpBackend(), probeHostMcpClient(), this.catalog.downloadRegion(), readLocalePreference()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, locale) } }
  }

  /**
   * Switch the MCP mount backend and remount every suite server through it.
   * A host-client switch takes effect only where the host package resolves;
   * unresolvable or unsupported transports surface as per-server diagnostics.
   * 中文：切换 MCP 挂载后端并触发全部套件服务重新协调，逐服务暴露不可用原因。
   */
  async setMcpBackend(backend: McpBackend): Promise<void> {
    return this.catalog.change(async () => {
      if (this.host === undefined) throw new Error('the settings service is not mounted')
      await this.host.writeBackend(backend)
    })
  }

  /** MCP overrides for a supplied runtime selection, or the full market catalog when omitted. */
  /** 中文：读取指定运行时套件集合的 MCP 覆盖；未传集合时读取完整市场目录。 */
  async allMcpOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>> {
    const map = new Map<string, McpSuiteOverrides>()
    for (const suite of suites ?? (await this.catalog.suites())) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      const overrides = await loadSuiteOverrides(this.dataRoot, suiteKey)
      if (Object.keys(overrides).length > 0) map.set(suiteKey, overrides)
    }
    return map
  }
}
