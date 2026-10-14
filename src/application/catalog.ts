/** 文件作用：目录应用层的宿主权威入口，统一管理源、套件发现、安装状态和一致性快照。 */
/**
 * Catalog application module: the host-authoritative owner of source state,
 * discovery, install mutations, and coherent suite snapshots.
 *
 * The module deliberately keeps the existing filesystem and Git operations
 * behind one interface while callers migrate from SuiteManager. User and
 * project snapshots use their own persisted state files and share the same
 * source-selection and suite-scanning rules.
 *
 * 业务职责：编排文件系统/Git 获取、用户级与项目级扫描、运行时状态查询及变更通知；不把这些副作用散落到调用方。
 */
import { mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { repoName } from '../catalog/manifests.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { discoverSourceListWithNotes } from '../catalog/source-catalog.js'
import { discoverSuitesInSource } from '../catalog/suite-scanner.js'
import { archiveInstall } from '../catalog/archive.js'
import { gitClone, gitCurrentBranch, gitHead, gitRemoteUrl, gitRemove, gitSetRemoteUrl, gitSync, type GitOptions } from '../catalog/git.js'
import { buildMcpStatus, type McpToolSnapshot } from '../runtime/mcp-status.js'
import { addUserMcpServer, loadUserMcpSuite, USER_MCP_SOURCE, USER_MCP_SUITE } from '../runtime/mcp-direct-config.js'
import type { McpMountDiagnostic } from '../runtime/mcp-mounts.js'
import { buildLspStatus, type LspMountStatusSource } from '../runtime/lsp-status.js'
import { loadLspServers, saveLspServers } from '../runtime/lsp-direct-config.js'
import { loadDisabledLspServers, saveDisabledLspServers } from '../runtime/lsp-server-state.js'
import { applyOverride, loadSuiteOverrides, mergeOverridePatch, saveSuiteOverrides, type McpServerOverride, type McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import { applyLspOverrides, lspConfig, restoreRedactedConfig, saveLspOverride, validateServerLsp, validateServerMcp } from '../runtime/server-config.js'
import { probeHostMcpClient, type HostMcpClientProbe, type McpBackend } from '../runtime/mcp-backend.js'
import { githubCloneUrl, resolveRegion, type DownloadRegionSetting, type EffectiveRegion } from '../runtime/regions.js'
import { readLocalePreference } from '../runtime/host-locale.js'
import { redactMcpConfig, redactMcpOverrides } from '../runtime/mcp-redaction.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, ServerConfigPayload, SkillContent, SourceOverview, SuiteDetail } from '../contracts/market.js'
import { buildSuiteDetail, readSkillContent } from './details.js'
import {
  deriveSourceIdCandidates,
  expandHome,
  isDirectory,
  pathExists,
  qualifiedSuiteId,
  resolveProjectRoot,
  sanitizeId,
  sourceCheckoutDir,
  sourcesDir,
  STATE_FILE_NAME
} from '../catalog/paths.js'
import { loadState, saveState, EMPTY_STATE } from '../model/state.js'
import {
  effectiveSurfaces,
  SUITE_SURFACE_KEYS,
  type InstalledEntry,
  type SourceKind,
  type SourceRef,
  type Suite,
  type SuiteDimension,
  type SuiteState,
  type SuiteSurfaceKey,
  type SurfaceOverrides,
  resolveSourceKind
} from '../model/types.js'

/**
 * Git network tuning, plumbed from the host config to every remote-touching
 * invocation (proxy, `insteadOf` mirrors, timeout, retry). `fallbackTarball`
 * additionally lets a failed GitHub clone fall back to a codeload tarball
 * download through the archive pipeline.
 * 中文：将代理、镜像、超时、重试和 GitHub 压缩包回退策略集中传给所有远程获取动作。
 */
export interface CatalogGitOptions extends GitOptions {
  /** Retry a failed GitHub clone as a codeload tarball download; default false. */
  /** 中文：GitHub 克隆失败时是否改用 codeload 压缩包，默认关闭。 */
  fallbackTarball?: boolean
  /** Allow plain-http archive downloads (intranet mirrors); default false. */
  /** 中文：是否允许内网镜像使用明文 HTTP 下载压缩包，默认关闭。 */
  allowHttpArchives?: boolean
}

/** Dependencies and host callback used by the catalog application module. */
/** 中文：目录应用层运行所需的用户目录、数据目录和宿主变更回调。 */
export interface CatalogOptions {
  userRoot: string
  dataRoot: string
  onChanged: () => void | Promise<void>
  /** Git/archive acquisition tuning. */
  /** 中文：Git 与压缩包获取策略。 */
  git?: CatalogGitOptions
  /**
   * Freshness window for cached project-dimension snapshots. The project
   * catalog sits on the skill-list hot path (every provider `list()` call),
   * and its inputs — the project's own files — change only through editor
   * saves; a short window keeps listing cheap without going stale. Defaults
   * to 5 seconds; 0 disables caching.
   * 中文：项目快照缓存有效期；0 表示每次读取都扫描项目文件。
   */
  projectSnapshotTtlMs?: number
  /**
   * Freshness window for the cached user-dimension snapshot (defaults to the
   * scan-cache TTL). It bounds how long out-of-band edits to local sources
   * stay invisible; 0 disables snapshot caching. Tests pass a small value so
   * staleness regressions need no real sleeps.
   * 中文：用户快照缓存有效期，限制外部修改本地源后的可见延迟；0 表示关闭快照缓存。
   */
  userSnapshotTtlMs?: number
}

/** A coherent discovered-and-installed view for one catalog dimension. */
/** 中文：某个目录维度下，源、发现套件和安装启用状态的一致视图。 */
export interface CatalogSnapshot {
  revision: number
  sources: SourceRef[]
  suites: Suite[]
  enabledSuites: Suite[]
  /** Per-source scan diagnostics (sourceId → notes), absent when clean. */
  /** 中文：按源保存扫描诊断；没有问题时省略。 */
  scanNotes?: Record<string, string[]>
}

/** 目录应用服务：串行协调源获取、套件快照、安装状态和运行时变更通知。 */
export class Catalog {
  private state: SuiteState = EMPTY_STATE
  private mutationQueue: Promise<unknown> = Promise.resolve()
  private readonly statePath: string
  private readonly headCache = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private revision = 0
  private userSnapshot: CatalogSnapshot | undefined
  private userSnapshotExpiresAt = 0
  private userSnapshotPromise: Promise<CatalogSnapshot> | undefined
  /**
   * Discovery scan cache: per-sources-fingerprint scan results with a TTL.
   * Install / enable / surface toggles re-derive the snapshot from cached
   * discovery (cheap mapping) instead of re-walking every checkout — a full
   * rescan of a 2,500-suite catalog costs ~1s and UI mutations happen in
   * bursts. Content-changing mutations (add / update / remove / adopt /
   * refresh / acquire) clear every cached discovery generation; the TTL
   * bounds staleness for in-place working-tree
   * edits of local sources.
   * 中文：按源指纹缓存扫描结果；状态开关只重映射缓存，内容变更或 TTL 到期才重新扫描。
   */
  private readonly scanCache = new Map<string, { at: number; discovered: Suite[]; scanNotes: Record<string, string[]> }>()
  private scanGeneration = 0
  private readonly scanPromises = new Map<string, Promise<{ suites: Suite[]; scanNotes: Record<string, string[]> }>>()
  private static readonly SCAN_CACHE_TTL_MS = 30_000
  private static readonly SCAN_CACHE_MAX_ENTRIES = 8
  /**
   * User-dimension snapshot TTL: bounded staleness for edits made outside the
   * plugin (a new skill dropped into a local source's working tree, a hand
   * edit in a project layout) becomes visible on the next read past the TTL
   * instead of living until the next mutation. Configurable; a 0 value
   * disables snapshot caching entirely.
   * 中文：用户维度快照的缓存时长，避免外部改动永久不可见；设为 0 时完全禁用。
   */
  private readonly userSnapshotTtlMs: number
  /** Project-dimension snapshots keyed by project root, with TTL freshness. */
  /** 中文：按项目根目录保存带 TTL 的项目维度快照。 */
  private readonly projectSnapshots = new Map<string, { snapshot: CatalogSnapshot; expiresAt: number }>()
  private readonly projectSnapshotPromises = new Map<string, Promise<CatalogSnapshot>>()
  private readonly projectSnapshotTtlMs: number
  /** Latest MCP mount diagnostics (suiteId -> reasons), fed by host reconcile. */
  /** 中文：宿主协调器提供的最新 MCP 挂载诊断。 */
  mcpDiagnostics: McpMountDiagnostic[] = []
  /** Latest LSP mount diagnostics source, wired by the host entry. */
  /** 中文：由宿主入口接入的 LSP 挂载诊断来源。 */
  private lspStatusSource: LspMountStatusSource | undefined
  /** Credential-store seam for dropping a grant record (MCP re-authorize). */
  /** 中文：用于删除 MCP 授权记录的凭据存储接缝。 */
  private credentialsStore: { deleteGrantRecord(serverName: string): Promise<void> } | undefined
  private toolSnapshotProvider: () => readonly McpToolSnapshot[] = () => []
  /** Mount-registry seam: flags a mount key for an explicit rebuild (re-authorize). */
  /** 中文：标记挂载键，在重新授权后要求显式重建连接。 */
  private mcpRemount: (suiteId: string, serverKey: string) => void = () => {}
  /** Resolves the mount key owning one derived serverName; absent when the server is not mounted. */
  /** 中文：把派生 serverName 反查到所属挂载键；未挂载时返回空。 */
  private mcpServerOwner: (serverName: string) => { suiteId: string; serverKey: string } | undefined = () => undefined
  /** Backend source (the host settings namespace scope); default is the built-in client. */
  /** 中文：读取宿主设置中的 MCP 后端选择，默认使用插件内置客户端。 */
  private mcpBackendProvider: () => Promise<McpBackend> = async () => 'builtin'
  /** Backend writer (a scope update); absent until the settings service resolves. */
  /** 中文：写回宿主设置中的 MCP 后端；设置服务尚未挂载时拒绝写入。 */
  private mcpBackendWriter: (backend: McpBackend) => Promise<void> = async () => {
    throw new Error('the settings service is not mounted')
  }
  /** Download-region source (the host settings namespace scope). */
  /** 中文：读取宿主设置中的下载区域。 */
  private downloadRegionProvider: () => Promise<DownloadRegionSetting> = async () => 'auto'
  private scanProjectLayouts = true

  /** Apply the host's project-layout switch and invalidate every project snapshot. */
  /** 中文：切换项目布局扫描开关，并使已有项目快照失效。 */
  async setScanProjectLayouts(enabled: boolean): Promise<void> {
    if (this.scanProjectLayouts === enabled) return
    this.scanProjectLayouts = enabled
    await this.notifyChanged()
  }

  /** 初始化目录路径、快照 TTL 和宿主依赖，但不主动读取磁盘状态。 */
  constructor(private readonly options: CatalogOptions) {
    this.statePath = join(options.userRoot, STATE_FILE_NAME)
    this.projectSnapshotTtlMs = options.projectSnapshotTtlMs ?? 5_000
    this.userSnapshotTtlMs = options.userSnapshotTtlMs ?? Catalog.SCAN_CACHE_TTL_MS
  }

  /** Install the host tool snapshot provider used by the MCP status surface. */
  /** 中文：接入宿主当前工具快照，供 MCP 状态面板计算服务工具清单。 */
  setMcpToolSnapshotProvider(provider: () => readonly McpToolSnapshot[]): void {
    this.toolSnapshotProvider = provider
  }

  /** Install the credential-store seam backing the MCP re-authorize action. */
  /** 中文：接入凭据存储，使 MCP 重新授权动作可以删除授权记录。 */
  setCredentialsStore(store: { deleteGrantRecord(serverName: string): Promise<void> }): void {
    this.credentialsStore = store
  }

  /**
   * Drop one MCP server's OAuth grant record so the next mount re-runs the
   * browser authorization — the path for "I picked too narrow a scope".
   * @param serverName - the derived serverName whose folded form keys the record.
   * @throws when the credentials service is not mounted.
   * 中文：删除指定服务的授权记录，标记其挂载键重建，并触发一次运行时协调。
   */
  async reauthorizeMcpServer(serverName: string): Promise<void> {
    await this.enqueue(async () => {
      await this.credentialsStore?.deleteGrantRecord(serverName)
      // Dropping a grant changes no resolved config field, so a fingerprint
      // reconcile would keep the live bridge — with its in-memory tokens —
      // untouched. The serverName maps back to exactly one mount key (the
      // registry reserved the name), so flag it for an explicit rebuild.
      // 中文：授权记录删除不改变配置指纹，必须显式标记挂载重建才能清掉内存令牌。
      const key = this.mcpServerOwner(serverName)
      if (key !== undefined) this.mcpRemount?.(key.suiteId, key.serverKey)
      await this.notifyChanged(true)
    })
  }

  /**
   * Install the MCP remount seam used by re-authorize: the registry flags the
   * mount so the next reconcile tears the live bridge down and rebuilds it.
   * 中文：接入重新授权使用的挂载注册表回调和 serverName 归属查询。
   */
  setMcpRemountHook(hook: (suiteId: string, serverKey: string) => void, serverOwner: (serverName: string) => { suiteId: string; serverKey: string } | undefined): void {
    this.mcpRemount = hook
    this.mcpServerOwner = serverOwner
  }

  /** Whether the re-authorize action can run in this composition. */
  /** 中文：报告当前宿主组合是否提供凭据存储。 */
  mcpReauthorizeAvailable(): boolean {
    return this.credentialsStore !== undefined
  }

  /** Install the LSP mount status source used by the LSP status surface. */
  /** 中文：接入 LSP 挂载诊断来源，供状态面板读取。 */
  setLspStatusSource(source: LspMountStatusSource): void {
    this.lspStatusSource = source
  }

  /** Subscribe to completed catalog mutations; returns an unsubscribe function. */
  /** 中文：订阅目录变更完成事件，并返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Build the flat MCP service inventory for the status surface. */
  /** 中文：合并套件、用户直配服务、挂载诊断和工具快照，生成 MCP 平面清单。 */
  async mcpStatus(): Promise<McpStatusPayload> {
    const snapshot = await this.readUserCatalog()
    const suites = [...snapshot.suites, await loadUserMcpSuite(this.options.dataRoot)]
    const payload = buildMcpStatus(suites, this.mcpDiagnostics, this.toolSnapshotProvider(), await this.allMcpOverrides(suites))
    for (const entry of payload.entries)
      if (entry.suiteId === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) {
        entry.kind = 'direct'
        entry.managed = true
      }
    const oauthBackend = (await this.mcpBackend()) === 'builtin' && this.mcpReauthorizeAvailable()
    for (const entry of payload.entries) {
      const auth = entry.config?.auth as { enabled?: boolean } | undefined
      entry.canReauthorize =
        oauthBackend &&
        (entry.kind === 'plugin' || entry.managed === true) &&
        (entry.transport === 'sse' || entry.transport === 'streamable-http') &&
        auth?.enabled !== false &&
        !['disabled', 'foreign', 'orphaned'].includes(entry.state)
    }
    return payload
  }

  /** Persist a user-owned MCP service and reconcile its bridge mount. */
  /** 中文：保存用户直配 MCP 服务，并通知宿主重新协调其挂载。 */
  async addMcpServer(name: string, server: unknown): Promise<void> {
    return this.enqueue(async () => {
      await addUserMcpServer(this.options.dataRoot, name, server)
      await this.notifyChanged(true)
    })
  }

  /** Read effective service configuration without exposing credential literals. */
  /** 中文：读取服务生效配置并脱敏凭据，供客户端详情编辑器使用。 */
  async serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload> {
    const config = await this.resolveServerConfig(kind, id)
    return { kind, id, editable: true, config: redactMcpConfig(config.value) as Record<string, unknown> }
  }

  /** 按客户端服务 ID 定位套件或直配服务，并返回可编辑配置上下文。 */
  private async resolveServerConfig(kind: 'mcp' | 'lsp', id: string) {
    if (kind === 'lsp' && id.startsWith('direct/')) {
      const key = id.slice(7)
      const server = (await loadLspServers(this.options.dataRoot)).servers[key]
      if (server === undefined) throw new Error('LSP server not found')
      return { key, suiteKey: 'direct', root: this.options.dataRoot, value: lspConfig(server) }
    }
    const suites = [...(await this.readUserCatalog()).suites, await loadUserMcpSuite(this.options.dataRoot)]
    for (const suite of await applyLspOverrides(this.options.dataRoot, suites)) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      if (kind === 'mcp') {
        for (const [key, server] of Object.entries(suite.mcp?.servers ?? {})) {
          if (id !== `plugin:${suiteKey}/${key}`) continue
          const overrides = await loadSuiteOverrides(this.options.dataRoot, suiteKey)
          return { key, suiteKey, root: suite.root, value: { ...applyOverride(server, overrides[key]) } }
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
    return this.enqueue(async () => {
      const current = await this.resolveServerConfig(kind, id)
      const value = restoreRedactedConfig(config, current.value)
      if (kind === 'mcp') {
        const server = await validateServerMcp(current.root, current.key, value)
        const overrides = await loadSuiteOverrides(this.options.dataRoot, current.suiteKey)
        const enabled = overrides[current.key]?.enabled
        overrides[current.key] = { config: server, ...(enabled === undefined ? {} : { enabled }) }
        await saveSuiteOverrides(this.options.dataRoot, current.suiteKey, overrides)
      } else {
        const server = validateServerLsp(current.key, value)
        if (current.suiteKey === 'direct') {
          const direct = await loadLspServers(this.options.dataRoot)
          if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
          direct.servers[current.key] = server
          await saveLspServers(this.options.dataRoot, { lspServers: Object.fromEntries(Object.entries(direct.servers).map(([key, spec]) => [key, lspConfig(spec)])) })
        } else await saveLspOverride(this.options.dataRoot, id, server)
      }
      await this.notifyChanged(true)
    })
  }

  /** The LSP status surface: declared servers merged with mount diagnostics. */
  /** 中文：合并套件声明、用户直配服务和挂载诊断，生成 LSP 状态面板数据。 */
  async lspStatus(): Promise<LspStatusPayload> {
    const snapshot = await this.readUserCatalog()
    const direct = await loadLspServers(this.options.dataRoot)
    return buildLspStatus(
      await applyLspOverrides(this.options.dataRoot, snapshot.suites),
      this.lspStatusSource ?? { diagnosticsSnapshot: () => new Map(), hasLiveMounts: () => false },
      direct
    )
  }

  /** The user's direct LSP server table (normalized specs). */
  /** 中文：读取用户直接配置且已规范化的 LSP 服务表。 */
  async lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return (await loadLspServers(this.options.dataRoot)).servers
  }

  /** Create one direct LSP declaration without replacing other user servers. */
  /** 中文：校验并新增一个用户直配 LSP，不覆盖现有服务。 */
  async addLspServer(name: string, config: unknown): Promise<void> {
    return this.enqueue(async () => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid LSP server name')
      const direct = await loadLspServers(this.options.dataRoot)
      if (direct.errors.length > 0) throw new Error(direct.errors.join('; '))
      if (Object.hasOwn(direct.servers, name)) throw new Error('LSP server already exists')
      const spec = validateServerLsp(name, config)
      await saveLspServers(this.options.dataRoot, {
        lspServers: { ...Object.fromEntries(Object.entries(direct.servers).map(([key, value]) => [key, lspConfig(value)])), [name]: lspConfig(spec) }
      })
      await this.notifyChanged(true)
    })
  }

  /** Validate and persist the user's direct LSP server table. */
  /** 中文：校验并整体保存用户直配 LSP 服务表，然后触发挂载协调。 */
  async setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>> {
    return this.enqueue(async () => {
      const { servers } = await saveLspServers(this.options.dataRoot, raw)
      await this.notifyChanged(true)
      return servers
    })
  }

  /** 切换单个用户直配 LSP 的禁用集合记录，并触发状态刷新。 */
  async setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const disabled = await loadDisabledLspServers(this.options.dataRoot)
      if (enabled) disabled.delete(id)
      else disabled.add(id)
      await saveDisabledLspServers(this.options.dataRoot, disabled)
      await this.notifyChanged(true)
    })
  }

  /** One suite's persisted MCP overrides, addressed by qualified suite id. */
  /** 中文：读取指定套件的 MCP 覆盖配置，并在返回前脱敏。 */
  async mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides> {
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    const snapshot = await this.readUserCatalog()
    if (!snapshot.suites.some(suite => suite.sourceId === sourceId && suite.id === suiteId)) throw new Error(`suite "${suiteKey}" not found`)
    return redactMcpOverrides(await loadSuiteOverrides(this.options.dataRoot, suiteKey))
  }

  /**
   * Set or clear one server's MCP override and remount it. `override === null`
   * clears the override (back to the source config). The serverKey must exist
   * in the suite's parsed mcp.json.
   * 中文：设置或清除指定 MCP 服务覆盖，并在保存后触发重新挂载。
   */
  async setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void> {
    return this.enqueue(async () => {
      const suiteKey = qualifiedSuiteId(sourceId, suiteId)
      const source = this.state.sources.find(entry => entry.id === sourceId)
      let suites: Suite[]
      if (sourceId === USER_MCP_SOURCE && suiteId === USER_MCP_SUITE) {
        suites = [await loadUserMcpSuite(this.options.dataRoot)]
      } else {
        if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
        const checkout = this.sourceCheckoutPath(source)
        if (!(await isDirectory(checkout))) await this.acquire(source)
        suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      }
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.mcp?.servers[serverKey] === undefined) throw new Error(`server "${serverKey}" is not defined by suite "${suiteId}"`)
      // Override files are keyed by the qualified id so two sources' same-named
      // suites never share one override record.
      // 中文：覆盖文件使用限定套件 ID，避免不同源的同名套件互相覆盖。
      const overrides = await loadSuiteOverrides(this.options.dataRoot, suiteKey)
      if (override === null) {
        delete overrides[serverKey]
      } else {
        // Merge onto the stored record: the UI never receives literal secret
        // values, so a verbatim write would drop keys it simply redacted.
        // 中文：合并到旧记录，避免客户端脱敏后回写时误删未展示的密钥字段。
        overrides[serverKey] = mergeOverridePatch(overrides[serverKey] ?? {}, override)
      }
      await saveSuiteOverrides(this.options.dataRoot, suiteKey, overrides)
      await this.notifyChanged(true)
    })
  }

  /**
   * Re-run the MCP reconcile pass: retries failed mounts and clears residual
   * tools, without changing any catalog state.
   * 中文：仅重新执行 MCP 协调，不改变目录状态。
   */
  async retryMounts(): Promise<void> {
    await this.notifyChanged(true)
  }

  /** The persisted backend choice without the host-client probe (mount-time provider). */
  /** 中文：读取持久化后端选择，不额外探测宿主客户端。 */
  async mcpBackend(): Promise<McpBackend> {
    return this.mcpBackendProvider()
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
    const [backend, hostClient, regionSetting, locale] = await Promise.all([this.mcpBackendProvider(), probeHostMcpClient(), this.downloadRegionProvider(), readLocalePreference()])
    return { backend, hostClient, downloadRegion: { setting: regionSetting, effective: resolveRegion(regionSetting, locale) } }
  }

  /**
   * Switch the MCP mount backend and remount every suite server through it.
   * A host-client switch takes effect only where the host package resolves;
   * unresolvable or unsupported transports surface as per-server diagnostics.
   * 中文：切换 MCP 挂载后端并触发全部套件服务重新协调，逐服务暴露不可用原因。
   */
  async setMcpBackend(backend: McpBackend): Promise<void> {
    return this.enqueue(async () => {
      await this.mcpBackendWriter(backend)
      await this.notifyChanged(true)
    })
  }

  /** Install the backend source (the host settings namespace's scope). */
  /** 中文：接入宿主设置命名空间中的 MCP 后端读取器。 */
  setMcpBackendProvider(provider: () => Promise<McpBackend>): void {
    this.mcpBackendProvider = provider
  }

  /** Install the backend writer (a scope update on the same namespace). */
  /** 中文：接入宿主设置命名空间中的 MCP 后端写入器。 */
  setMcpBackendWriter(writer: (backend: McpBackend) => Promise<void>): void {
    this.mcpBackendWriter = writer
  }

  /** Install the download-region source (the host settings namespace scope). */
  /** 中文：接入宿主设置命名空间中的下载区域读取器。 */
  setDownloadRegionProvider(provider: () => Promise<DownloadRegionSetting>): void {
    this.downloadRegionProvider = provider
  }

  /** MCP overrides for a supplied runtime selection, or the full market catalog when omitted. */
  /** 中文：读取指定运行时套件集合的 MCP 覆盖；未传集合时读取完整市场目录。 */
  async allMcpOverrides(suites?: readonly Suite[]): Promise<Map<string, McpSuiteOverrides>> {
    const map = new Map<string, McpSuiteOverrides>()
    for (const suite of suites ?? (await this.readUserCatalog()).suites) {
      const suiteKey = qualifiedSuiteId(suite.sourceId, suite.id)
      const overrides = await loadSuiteOverrides(this.options.dataRoot, suiteKey)
      if (Object.keys(overrides).length > 0) map.set(suiteKey, overrides)
    }
    return map
  }

  /** Load persisted user state once at plugin activation. */
  /** 中文：插件激活时读取一次用户持久化状态，并清空旧扫描/快照缓存。 */
  async load(): Promise<void> {
    this.state = await loadState(this.statePath)
    this.invalidateScans()
    this.invalidateSnapshot(false)
  }

  /** 返回当前内存中的已登记源列表。 */
  get sources(): SourceRef[] {
    return this.state.sources
  }

  /** The user-dimension suite root this catalog operates. */
  /** 中文：返回用户维度目录扫描所使用的根路径。 */
  get userRoot(): string {
    return this.options.userRoot
  }

  /** Read one coherent user-dimension snapshot, reusing in-flight discovery. */
  /** 中文：读取用户维度一致性快照，并复用有效缓存或正在进行的扫描。 */
  async readUserCatalog(): Promise<CatalogSnapshot> {
    // TTL 0 disables snapshot caching: every read observes fresh discovery,
    // mirroring the project dimension's caching-disabled semantics.
    // 中文：TTL 为 0 时每次读取都重新发现，和项目维度关闭缓存时的语义一致。
    if (this.userSnapshotTtlMs <= 0) return this.buildSnapshot(this.state, 'user', this.options.userRoot)
    if (this.userSnapshot !== undefined && Date.now() < this.userSnapshotExpiresAt) return this.userSnapshot
    if (this.userSnapshotPromise !== undefined) return this.userSnapshotPromise
    const revision = this.revision
    const generation = this.scanGeneration
    const promise = this.buildSnapshot(this.state, 'user', this.options.userRoot)
      .then(snapshot => {
        if (revision === this.revision && generation === this.scanGeneration) {
          this.userSnapshot = snapshot
          this.userSnapshotExpiresAt = Date.now() + this.userSnapshotTtlMs
        }
        return snapshot
      })
      .finally(() => {
        if (this.userSnapshotPromise === promise) this.userSnapshotPromise = undefined
      })
    this.userSnapshotPromise = promise
    return promise
  }

  /** Read installed suites from one captured install state without market checkout probes. */
  async readInstalledSuites(sourceId?: string): Promise<Suite[]> {
    const state = this.state
    const installedSources = new Set(Object.keys(state.installed).map(key => key.slice(0, key.indexOf('/'))))
    const sources = state.sources.filter(source => installedSources.has(source.id) && (sourceId === undefined || source.id === sourceId))
    if (sources.length === 0) return []
    const snapshot = await this.buildSnapshot({ ...state, sources }, 'user', this.options.userRoot)
    return snapshot.suites.filter(suite => suite.remote === undefined && state.installed[installKey(suite.sourceId, suite.id)] !== undefined)
  }

  /** Read one coherent project-dimension snapshot for a workspace cwd. */
  /** 中文：根据工作区 cwd 定位项目根，并读取项目维度一致性快照。 */
  async readProjectCatalog(cwd: string): Promise<CatalogSnapshot> {
    const projectRoot = await resolveProjectRoot(cwd)
    if (this.projectSnapshotTtlMs <= 0) return this.buildProjectSnapshot(projectRoot)
    const cached = this.projectSnapshots.get(projectRoot)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.snapshot
    const inFlight = this.projectSnapshotPromises.get(projectRoot)
    if (inFlight !== undefined) return inFlight
    const revision = this.revision
    const generation = this.scanGeneration
    const promise = this.buildProjectSnapshot(projectRoot)
      .then(snapshot => {
        if (revision === this.revision && generation === this.scanGeneration) {
          this.projectSnapshots.set(projectRoot, { snapshot, expiresAt: Date.now() + this.projectSnapshotTtlMs })
        }
        return snapshot
      })
      .finally(() => {
        if (this.projectSnapshotPromises.get(projectRoot) === promise) this.projectSnapshotPromises.delete(projectRoot)
      })
    this.projectSnapshotPromises.set(projectRoot, promise)
    return promise
  }

  /** 从项目根加载状态文件并构建项目快照，必要时跳过扫描缓存。 */
  private async buildProjectSnapshot(projectRoot: string): Promise<CatalogSnapshot> {
    const state = await loadState(join(projectRoot, STATE_FILE_NAME))
    // TTL 0 means caching is disabled for this dimension: bypass the scan
    // cache so every read observes the working tree as it stands.
    // 中文：该维度关闭缓存时绕过扫描缓存，确保每次看到当前工作树。
    return this.buildSnapshot(state, 'project', projectRoot, this.projectSnapshotTtlMs <= 0)
  }

  /** One suite's full detail for the market detail modal. */
  /** 中文：读取指定套件的完整详情，包含安装状态、诊断和脱敏后的 MCP 覆盖。 */
  async suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    const suiteKey = qualifiedSuiteId(sourceId, suiteId)
    return buildSuiteDetail(suite, this.state.installed[installKey(sourceId, suiteId)], this.mcpDiagnostics, await loadSuiteOverrides(this.options.dataRoot, suiteKey))
  }

  /** One skill's full SKILL.md text for the market detail modal. */
  /** 中文：读取指定套件技能的完整 SKILL.md 正文。 */
  async skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent> {
    const snapshot = await this.readUserCatalog()
    const suite = snapshot.suites.find(entry => entry.sourceId === sourceId && entry.id === suiteId)
    if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
    return readSkillContent(suite, skillName)
  }

  /** The full market overview from one user snapshot. */
  /** 中文：把用户快照、源检出状态和安装记录组装成市场总览响应。 */
  async overview(): Promise<OverviewPayload> {
    const snapshot = await this.readUserCatalog()
    const sourceRows: SourceOverview[] = []
    for (const source of snapshot.sources) {
      const inFlight = this.currentSourceState?.sourceId === source.id ? this.currentSourceState : undefined
      const checkout = this.sourceCheckoutPath(source)
      const kind = resolveSourceKind(source)
      let cloned = false
      let lockCommit: string | undefined
      let error: string | undefined
      if (kind === 'local') {
        cloned = await isDirectory(checkout)
        if (!cloned) error = `local source directory ${checkout} is missing`
      } else if (kind === 'archive') {
        cloned = await isDirectory(checkout)
        lockCommit = this.headCache.get(source.id)
      } else if (inFlight !== undefined) {
        // A mutation owns this source right now: do not race git against its checkout.
        // 中文：源正在变更时使用进行中的状态，避免与 Git 检查同时访问检出目录。
        cloned = inFlight.cloned || (await isDirectory(checkout))
        lockCommit = inFlight.head
      } else {
        const cachedHead = this.headCache.get(source.id)
        if (cachedHead !== undefined && (await isDirectory(checkout))) {
          cloned = true
          lockCommit = cachedHead
        } else {
          try {
            lockCommit = await gitHead(checkout)
            cloned = true
            this.headCache.set(source.id, lockCommit)
          } catch {
            // Not cloned yet or a broken checkout; refresh reports the actionable error.
            // 中文：尚未克隆或检出已损坏时保留未克隆状态，由刷新流程提供可操作错误。
          }
        }
      }
      const sourceSuites = snapshot.suites.filter(suite => suite.sourceId === source.id)
      const scanNotes = snapshot.scanNotes?.[source.id]
      sourceRows.push({
        id: source.id,
        url: source.url,
        ...(source.branch === undefined ? {} : { branch: source.branch }),
        ...(source.local === true ? { local: true } : {}),
        kind,
        ...(source.adopted === true ? { adopted: true } : {}),
        cloned,
        ...(lockCommit === undefined ? {} : { lockCommit }),
        ...(error === undefined ? {} : { error }),
        ...(scanNotes === undefined ? {} : { scanNotes }),
        suiteIds: sourceSuites.map(suite => suite.id)
      })
    }
    const installed = new Set(Object.keys(this.state.installed))
    const cards = snapshot.suites.map(suite => ({
      sourceId: suite.sourceId,
      suiteId: suite.id,
      name: suite.manifest.name,
      version: suite.manifest.version,
      description: suite.manifest.description,
      keywords: suite.manifest.keywords ?? [],
      surfaces: suite.surfaces,
      enabled: suite.enabled,
      installed: installed.has(installKey(suite.sourceId, suite.id)),
      ...(installed.has(installKey(suite.sourceId, suite.id)) ? { surfaceToggles: suite.activeSurfaces } : {}),
      ...(suite.remote === undefined ? {} : { remoteUrl: suite.remote.url }),
      dimension: suite.dimension,
      layout: suite.manifest.layout,
      errors: suite.errors,
      mcpErrors: this.mcpDiagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
    }))
    return {
      sources: sourceRows,
      suites: cards,
      totals: {
        all: cards.length,
        installed: cards.filter(card => card.installed).length,
        enabled: cards.filter(card => card.enabled).length
      },
      roots: { user: this.options.userRoot, data: this.options.dataRoot },
      unmanaged: await this.unmanagedSources()
    }
  }

  /** Runtime discovery scans only sources containing an enabled install. No acquisition or network access. */
  /** 中文：运行时只扫描存在启用安装项的源，不执行获取或网络操作。 */
  async enabledUserSuites(): Promise<Suite[]> {
    const enabledSources = new Set(
      Object.entries(this.state.installed)
        .filter(([, entry]) => entry.enabled)
        .map(([key]) => key.slice(0, key.indexOf('/')))
    )
    const sources = this.state.sources.filter(source => enabledSources.has(source.id))
    const suites = sources.length === 0 ? [] : (await this.buildSnapshot({ ...this.state, sources }, 'user', this.options.userRoot)).enabledSuites
    const direct = await loadUserMcpSuite(this.options.dataRoot)
    return applyLspOverrides(this.options.dataRoot, Object.keys(direct.mcp!.servers).length === 0 ? suites : [...suites, direct])
  }

  /** Enabled user- and project-dimension suites for a workspace cwd. */
  /** 中文：返回指定工作区下用户维度和项目维度的启用套件。 */
  async enabledSuitesForCwd(cwd: string): Promise<{ user: Suite[]; project: Suite[] }> {
    const [user, project] = await Promise.all([this.enabledUserSuites(), this.readProjectCatalog(cwd)])
    return { user, project: project.enabledSuites }
  }

  /** All suites of one dimension. */
  /** 中文：读取一个目录维度的全部套件，不限于已启用项。 */
  async suitesForDimension(dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
    const state = dimension === 'user' && dimensionRoot === this.options.userRoot ? this.state : await loadState(join(dimensionRoot, STATE_FILE_NAME))
    return (await this.buildSnapshot(state, dimension, dimensionRoot)).suites
  }

  /**
   * Add a source and acquire it immediately (clone, download, or in-place).
   *
   * Git sources with an already-present checkout whose `origin` matches the
   * input URL are adopted in place — the manual-clone repair path — so no
   * second clone is made and no `-2` suffixed id is invented. Adopted
   * checkouts are never deleted on source removal.
   * 中文：登记源并立即获取内容；已有匹配远程地址的检出会原地收编，避免重复克隆。
   */
  async addSource(input: { url: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<SourceRef> {
    return this.enqueue(async () => {
      const kind = input.local === true ? ('local' as const) : resolveSourceKind({ url: input.url, kind: input.kind })
      if (kind === 'git') {
        // Adoption first: a pre-existing checkout with a matching origin URL
        // is registered as-is, skipping the clone entirely.
        // 中文：优先识别同源的既有检出，原地登记，不再创建第二份目录。
        const adoptable = await this.findAdoptableCheckout(input.url, deriveSourceIdCandidates(input.url))
        if (adoptable !== undefined) {
          const source: SourceRef = {
            id: adoptable,
            url: input.url,
            ...(input.branch === undefined ? {} : { branch: input.branch }),
            kind: 'git',
            adopted: true
          }
          const head = await tryHead(sourceCheckoutDir(this.options.userRoot, adoptable))
          if (head !== undefined) this.headCache.set(source.id, head)
          this.state = { ...this.state, sources: [...this.state.sources, source] }
          await saveState(this.statePath, this.state)
          await this.notifyChanged()
          return source
        }
      }
      const baseId = await this.pickSourceId(deriveSourceIdCandidates(input.url), kind === 'local')
      const source: SourceRef = {
        id: baseId,
        url: input.url,
        ...(input.branch === undefined ? {} : { branch: input.branch }),
        ...(kind === 'local' ? { local: true as const } : { kind }),
        ...(input.kind === 'archive' && input.sha256 !== undefined && input.sha256 !== '' ? { sha256: input.sha256 } : {})
      }
      let checkout = this.sourceCheckoutPath(source)
      if (kind === 'local') {
        if (!(await isDirectory(checkout))) throw new Error(`local source directory ${checkout} is missing`)
      } else {
        this.beginSourceState(baseId, kind === 'archive' ? 'downloading' : 'cloning', false)
        try {
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
        } catch (error) {
          this.endSourceState()
          throw error
        }
        this.updateSourceStep('reading')
      }
      // The repo's own manifest names the source; move the checkout along so
      // the registered id and its `.sources/` directory stay coherent. URL
      // derived candidates stay as readable fallbacks before numeric suffixes.
      // 中文：优先采用清单/仓库可读名称，并保持登记 ID 与 `.sources/` 目录一致。
      const named = [...new Set([sanitizeId(await repoName(checkout)), ...deriveSourceIdCandidates(input.url)])]
      const finalId = await this.pickSourceId(named, kind === 'local', kind === 'local' ? undefined : checkout)
      if (kind !== 'local' && finalId !== baseId) {
        const targetDir = sourceCheckoutDir(this.options.userRoot, finalId)
        await rename(checkout, targetDir)
        checkout = targetDir
      }
      source.id = finalId
      if (resolveSourceKind(source) === 'git') {
        const head = await tryHead(checkout)
        if (head !== undefined) this.headCache.set(source.id, head)
      }
      this.endSourceState()
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
      return source
    })
  }

  /**
   * First candidate id whose `.sources/` checkout already exists and whose
   * `origin` remote matches the input URL (canonical-form equality) — the
   * signature of a manual clone of the very same repository. Registered ids
   * and checkouts of differently-origined directories never adopt.
   * 中文：只收编远程地址规范化后完全相同、且尚未登记的既有 Git 检出。
   */
  private async findAdoptableCheckout(url: string, candidates: string[]): Promise<string | undefined> {
    const registered = new Set(this.state.sources.map(source => source.id))
    for (const candidate of candidates) {
      if (registered.has(candidate)) continue
      const dir = sourceCheckoutDir(this.options.userRoot, candidate)
      if (!(await isDirectory(dir))) continue
      let origin: string | undefined
      try {
        origin = await gitRemoteUrl(dir)
      } catch {
        continue
      }
      if (origin !== '' && canonicalGitUrl(origin) === canonicalGitUrl(url)) return candidate
    }
    return undefined
  }

  /** Register one unmanaged `.sources/` checkout as a source without touching its files. */
  /** 中文：将磁盘上未登记的 `.sources/` 检出登记为源，不复制或修改其文件。 */
  async adoptSource(id: string): Promise<SourceRef> {
    return this.enqueue(async () => {
      if (this.state.sources.some(source => source.id === id)) throw new Error(`source "${id}" is already registered`)
      // The id becomes one path segment under `.sources/`: only flat safe
      // names qualify. Anything else (separators, `..`, leading dots) could
      // traverse out of the checkouts root and register an outside directory.
      // 中文：ID 必须是单一路径段，拒绝分隔符、`..` 和前导点，防止越出检出根目录。
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id.includes('..')) {
        throw new Error(`invalid checkout id "${id}" — use letters, digits, dots, dashes, or underscores`)
      }
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      if (!(await isDirectory(dir))) throw new Error(`no checkout directory at ${dir}`)
      let source: SourceRef
      try {
        const origin = await gitRemoteUrl(dir)
        source = { id, url: origin, kind: 'git', adopted: true }
        const head = await tryHead(dir)
        if (head !== undefined) this.headCache.set(id, head)
      } catch {
        // Not a git checkout: read it in place, like a local source.
        // 中文：非 Git 目录按本地源原地读取，不尝试修改或转换。
        source = { id, url: dir, local: true, adopted: true }
      }
      this.state = { ...this.state, sources: [...this.state.sources, source] }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
      return source
    })
  }

  /** Unmanaged `.sources/` checkouts: present on disk, absent from state. */
  /** 中文：列出磁盘存在但状态文件未登记的 `.sources/` 检出。 */
  async unmanagedSources(): Promise<Array<{ id: string; url?: string }>> {
    const checkoutRoot = sourcesDir(this.options.userRoot)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(checkoutRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const registered = new Set(this.state.sources.map(source => source.id))
    const unmanaged: Array<{ id: string; url?: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || registered.has(entry.name)) continue
      const dir = join(checkoutRoot, entry.name)
      try {
        unmanaged.push({ id: entry.name, url: await gitRemoteUrl(dir) })
      } catch {
        unmanaged.push({ id: entry.name })
      }
    }
    return unmanaged
  }

  /** Progress snapshot of the source mutation currently in flight. */
  /** 中文：记录当前正在执行的源变更及其步骤，供进度接口读取。 */
  private currentSourceState: { sourceId: string; step: string; cloned: boolean; head?: string } | undefined

  /** Begin reporting progress for a source mutation. */
  /** 中文：开始报告指定源的获取步骤。 */
  beginSourceState(sourceId: string, step: string, cloned: boolean): void {
    this.currentSourceState = { sourceId, step, cloned }
  }

  /** Advance the in-flight source mutation step. */
  /** 中文：推进当前源变更的进度步骤。 */
  updateSourceStep(step: string): void {
    if (this.currentSourceState !== undefined) this.currentSourceState = { ...this.currentSourceState, step }
  }

  /** Stop reporting source mutation progress. */
  /** 中文：结束当前源变更的进度报告。 */
  endSourceState(): void {
    this.currentSourceState = undefined
  }

  /** Progress snapshot for the progress route. */
  /** 中文：返回进度路由所需的当前步骤快照。 */
  sourceProgress(): { active: boolean; sourceId: string; step: string } {
    const state = this.currentSourceState
    return state === undefined ? { active: false, sourceId: '', step: '' } : { active: true, sourceId: state.sourceId, step: state.step }
  }

  /**
   * First candidate id not claimed by a registered source; for git candidates
   * the checkout directory must also be free, so a stale or foreign directory
   * under `.sources/` is never cloned over (it would fail `git clone` with a
   * confusing "destination exists" error). `ownedCheckout` marks the directory
   * the in-flight mutation already controls, keeping a rename onto it legal.
   * Local sources skip the disk check: they read their own path in place and
   * never occupy `.sources/`.
   * 中文：选择第一个未被状态或磁盘占用的源 ID；本地源不占用托管检出目录。
   */
  private async pickSourceId(candidates: string[], skipDisk: boolean, ownedCheckout?: string): Promise<string> {
    /** 检查候选 ID 是否既未被状态占用，也未覆盖非本次操作所有的 checkout 目录。 */
    const free = async (id: string): Promise<boolean> => {
      if (this.state.sources.some(source => source.id === id)) return false
      if (skipDisk) return true
      const dir = sourceCheckoutDir(this.options.userRoot, id)
      return dir === ownedCheckout || !(await pathExists(dir))
    }
    for (const candidate of candidates) {
      if (await free(candidate)) return candidate
    }
    for (let suffix = 2; ; suffix++) {
      const candidate = `${candidates[0]}-${suffix}`
      if (await free(candidate)) return candidate
    }
  }

  /** Update one source's URL, branch, kind, or archive digest. */
  /** 中文：更新一个源的地址、分支、类型或压缩包摘要，并处理旧检出失效。 */
  async updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean; kind?: SourceKind; sha256?: string }): Promise<void> {
    return this.enqueue(async () => {
      const index = this.state.sources.findIndex(source => source.id === sourceId)
      if (index === -1) throw new Error(`unknown source "${sourceId}"`)
      const current = this.state.sources[index]!
      const nextLocal = patch.local !== undefined ? patch.local : current.local === true
      // A local source carries the legacy flag only; `kind` stays unwritten
      // so the persisted shape matches the pre-kind records.
      // 中文：本地源继续只保存旧 local 标记，保持历史状态文件结构兼容。
      const nextKind: SourceKind | undefined = nextLocal ? undefined : (patch.kind ?? current.kind)
      const next: SourceRef = {
        id: sourceId,
        url: patch.url ?? current.url,
        ...(patch.branch !== undefined ? { branch: patch.branch } : current.branch === undefined ? {} : { branch: current.branch }),
        ...(nextLocal ? { local: true } : {}),
        ...(nextKind === undefined ? {} : { kind: nextKind }),
        ...(patch.sha256 !== undefined ? (patch.sha256 === '' ? {} : { sha256: patch.sha256 }) : current.sha256 === undefined ? {} : { sha256: current.sha256 }),
        ...(current.adopted === true ? { adopted: true } : {})
      }
      const urlChanged = patch.url !== undefined && patch.url !== current.url
      // A URL change invalidates the old checkout — except for adopted (user
      // cloned) and local sources, whose directories we never own.
      // 中文：地址变化会使托管检出失效，但不删除收编检出或外部本地目录。
      if (urlChanged && current.local !== true && current.adopted !== true) {
        this.headCache.delete(sourceId)
        await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      }
      this.state = { ...this.state, sources: this.state.sources.map((source, i) => (i === index ? next : source)) }
      await saveState(this.statePath, this.state)
      await this.notifyChanged()
    })
  }

  /**
   * Remove a source and its install entries. `deleteCheckout` (the UI's
   * "also delete the managed market directory" option) physically removes the
   * `.sources/<id>` checkout — including an adopted one, since a directory
   * under `.sources` is manager-owned storage. A `local` source whose URL
   * points outside `.sources` is registration-only: its directory is never
   * touched. Deleting the checkout is what keeps a removed source from
   * reappearing as an unmanaged entry.
   * 中文：移除源及其安装记录；仅在明确要求且目录属于管理器存储时删除托管检出。
   */
  async removeSource(sourceId: string, deleteCheckout = false): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      this.state = {
        ...this.state,
        sources: this.state.sources.filter(entry => entry.id !== sourceId),
        installed: Object.fromEntries(Object.entries(this.state.installed).filter(([key]) => !key.startsWith(`${sourceId}/`)))
      }
      await saveState(this.statePath, this.state)
      this.headCache.delete(sourceId)
      // A checkout under `.sources` is manager-owned even when it was first
      // discovered/adopted. Only an explicit local path points outside the
      // manager's storage and must remain untouched.
      // 中文：`.sources` 下目录均属于管理器存储；外部本地路径始终保留。
      const externalLocal = source?.local === true && source.url !== sourceCheckoutDir(this.options.userRoot, sourceId)
      if (!externalLocal && deleteCheckout) await gitRemove(sourceCheckoutDir(this.options.userRoot, sourceId))
      await this.notifyChanged()
    })
  }

  /** Refresh one source checkout, or every source when sourceId is omitted. */
  /** 中文：刷新指定源或全部源，区分本地目录、压缩包、收编 Git 和托管 Git 的安全策略。 */
  async refreshSource(sourceId?: string): Promise<void> {
    return this.enqueue(async () => {
      const targets = sourceId === undefined ? this.state.sources : this.state.sources.filter(source => source.id === sourceId)
      for (const source of targets) {
        const kind = resolveSourceKind(source)
        if (kind === 'local') {
          if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
          continue
        }
        const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
        this.headCache.delete(source.id)
        if (kind === 'archive') {
          // Re-download and swap; the fresh digest becomes the lock value.
          // 中文：重新下载并替换压缩包检出，新摘要成为锁定值。
          const lock = await this.acquire(source)
          if (lock !== undefined) this.headCache.set(source.id, lock)
          continue
        }
        // Adopted checkouts are user-owned working trees: no `reset --hard`
        // (it would destroy uncommitted work), and no re-acquire either —
        // a broken HEAD means the user repairs the checkout, not that the
        // manager may clone or extract over their directory.
        // 中文：收编检出属于用户工作树，不执行破坏性重置或重新获取。
        if (source.adopted === true) {
          try {
            this.headCache.set(source.id, await gitHead(checkout))
          } catch {
            // A failed HEAD read means the next overview re-probes.
            // 中文：HEAD 读取失败时留给下一次总览重新探测。
          }
          continue
        }
        try {
          await gitHead(checkout)
        } catch {
          const lock = await this.acquire(source)
          if (lock !== undefined) {
            this.headCache.set(source.id, lock)
          } else {
            try {
              this.headCache.set(source.id, await gitHead(checkout))
            } catch {
              // A failed HEAD read means the next overview re-probes.
              // 中文：HEAD 读取失败时留给下一次总览重新探测。
            }
          }
          continue
        }
        // Shallow-friendly sync: fetch depth 1 into FETCH_HEAD, hard reset.
        // 中文：使用浅同步更新托管检出，再将工作树重置到远程最新提交。
        const branch = source.branch ?? (await gitCurrentBranch(checkout).catch(() => undefined))
        // Keep origin on the region's route: a clone made before a region
        // switch (or an explicit flip) re-points origin so the fetch follows.
        // Only origins this plugin itself wrote (the direct or proxied
        // source.url) are re-pointed — a foreign remote is left untouched.
        // 中文：只改写插件自己设置的 origin，外部远程地址保持不动。
        if (source.kind === 'git' || (source.kind === undefined && source.local !== true)) {
          try {
            const region = resolveRegion(await this.downloadRegionProvider(), await readLocalePreference())
            const routed = githubCloneUrl(region, source.url)
            const origin = await gitRemoteUrl(checkout)
            if (origin !== routed && (origin === source.url || origin === githubCloneUrl('china', source.url))) {
              await gitSetRemoteUrl(checkout, routed)
            }
          } catch {
            // Origin reconciliation is best effort; plain sync still runs.
            // 中文：远程地址校准失败不阻断普通同步。
          }
        }
        await gitSync(checkout, branch, this.options.git ?? {})
        try {
          this.headCache.set(source.id, await gitHead(checkout))
        } catch {
          // A failed HEAD read means the next overview re-probes.
          // 中文：HEAD 读取失败时留给下一次总览重新探测。
        }
      }
      await this.notifyChanged()
    })
  }

  /** Install a suite from a source and enable it. The client confirms the
   * injected surfaces (skills / MCP / hooks / commands) in a pre-install
   * dialog before this runs; disabling afterwards is always available.
   * 中文：确认源和套件后获取缺失检出、记录锁定值并启用安装项；后续仍可关闭。
   */
  async install(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const source = this.state.sources.find(entry => entry.id === sourceId)
      if (source === undefined) throw new Error(`unknown source "${sourceId}"`)
      const checkout = this.sourceCheckoutPath(source)
      let freshLock: string | undefined
      if (!(await isDirectory(checkout))) freshLock = await this.acquire(source)
      const suites = await discoverSuitesInSource(checkout, sourceId, 'user', source.url)
      const suite = suites.find(entry => entry.id === suiteId)
      if (suite === undefined) throw new Error(`suite "${suiteId}" not found in source "${sourceId}"`)
      if (suite.remote !== undefined) throw new Error(`suite "${suiteId}" is a remote reference (${suite.remote.url}); add its repository as a source before installing`)
      // Archive (or tarball-fallback) sources have no git HEAD; their digest
      // is the lock value.
      // 中文：压缩包或 tarball 回退没有 Git HEAD，使用内容摘要作为锁定值。
      const lockCommit = (await tryHead(checkout)) ?? freshLock ?? this.headCache.get(sourceId)
      await this.setInstalled(sourceId, suiteId, { enabled: true, installedAt: new Date().toISOString(), lockCommit })
      await this.notifyChanged(true)
    })
  }

  /** Uninstall a suite while retaining the source checkout. */
  /** 中文：移除套件安装记录但保留源检出目录。 */
  async uninstall(sourceId: string, suiteId: string): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      if (this.state.installed[key] === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      const rest = Object.fromEntries(Object.entries(this.state.installed).filter(([entryKey]) => entryKey !== key))
      this.state = { ...this.state, installed: rest }
      await saveState(this.statePath, this.state)
      await this.notifyChanged(true)
    })
  }

  /** Enable or disable an installed suite. */
  /** 中文：切换已安装套件整体启用状态。 */
  async setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      await this.setInstalled(sourceId, suiteId, { ...entry, enabled })
      await this.notifyChanged(true)
    })
  }

  /** Enable or disable one runtime surface of an installed suite. */
  /** 中文：切换已安装套件的单个运行时能力面。 */
  async setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      const key = installKey(sourceId, suiteId)
      const entry = this.state.installed[key]
      if (entry === undefined) throw new Error(`suite "${suiteId}" is not installed`)
      if (!SUITE_SURFACE_KEYS.includes(surface as SuiteSurfaceKey)) throw new Error(`surface "${surface}" is not toggleable`)
      const surfaces: SurfaceOverrides = { ...(entry.surfaces ?? {}), [surface]: enabled }
      await this.setInstalled(sourceId, suiteId, { ...entry, surfaces })
      await this.notifyChanged(true)
    })
  }

  /** Append config-seeded sources missing from user state and persist them. */
  /** 中文：将配置预置但状态中缺失的源追加保存，并使扫描/快照失效。 */
  async mergeSources(sources: SourceRef[]): Promise<void> {
    const existing = new Set(this.state.sources.map(source => source.id))
    const additions = sources.filter(source => !existing.has(source.id))
    if (additions.length === 0) return
    this.state = { ...this.state, sources: [...this.state.sources, ...additions] }
    await saveState(this.statePath, this.state)
    // New sources change the fingerprint, but their content arrives through
    // an acquire, so mark the scan cache dirty conservatively.
    // 中文：新增源会改变指纹，且内容由获取流程提供，因此保守地清空扫描缓存。
    this.invalidateScans()
    this.invalidateSnapshot(true)
  }

  /** Serialize a resource write with catalog changes and publish only successful writes. */
  async changePanelResources<T>(change: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const result = await change()
      await this.notifyChanged()
      return result
    })
  }

  /** 更新一个套件的持久化安装记录，不负责触发变更通知。 */
  private async setInstalled(sourceId: string, suiteId: string, entry: InstalledEntry): Promise<void> {
    this.state = { ...this.state, installed: { ...this.state.installed, [installKey(sourceId, suiteId)]: entry } }
    await saveState(this.statePath, this.state)
  }

  /**
   * Acquire one source's content by kind: clone (git), download+extract
   * (archive), or an in-place existence check (local). Returns a lock value
   * when the acquisition yields one (archive SHA-256, tarball fallback
   * digest); git HEAD is read separately by the callers.
   * 中文：按源类型获取内容；本地只检查存在，压缩包返回摘要，Git 由调用方另读 HEAD。
   */
  private async acquire(source: SourceRef): Promise<string | undefined> {
    const kind = resolveSourceKind(source)
    if (kind === 'local') {
      if (!(await isDirectory(expandHome(source.url)))) throw new Error(`local source directory ${expandHome(source.url)} is missing`)
      return undefined
    }
    const checkout = sourceCheckoutDir(this.options.userRoot, source.id)
    await mkdir(sourcesDir(this.options.userRoot), { recursive: true })
    if (kind === 'archive') {
      const { sha256 } = await archiveInstall(source.url, checkout, {
        ...(process.env['DSH_AGENT_MANAGE_GITHUB_TOKEN'] === undefined ? {} : { githubToken: process.env['DSH_AGENT_MANAGE_GITHUB_TOKEN'] }),
        ...(source.sha256 === undefined ? {} : { sha256: source.sha256 }),
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        ...(this.options.git?.allowHttpArchives === true ? { allowHttp: true } : {})
      })
      return sha256
    }
    try {
      // The region routes github.com clones through the China mirror prefix;
      // the proxied URL becomes `origin`, so refreshes follow the same route.
      // 中文：按生效下载区域选择 GitHub 克隆地址，并让 origin 沿用同一路由。
      const region = resolveRegion(await this.downloadRegionProvider(), await readLocalePreference())
      await gitClone(githubCloneUrl(region, source.url), source.branch, checkout, this.options.git ?? {})
      return undefined
    } catch (error) {
      if (this.options.git?.fallbackTarball !== true) throw error
      const tarballUrl = codeloadTarballUrl(source.url, source.branch)
      if (tarballUrl === undefined) throw error
      // The codeload URL ends in a branch path, not `.tar.gz`, so the format
      // must be stated explicitly — extension detection cannot see it.
      // 中文：codeload 地址以分支路径结尾，必须显式指定 targz 格式，不能依赖扩展名推断。
      const { sha256 } = await archiveInstall(tarballUrl, checkout, {
        ...(this.options.git?.timeoutMs === undefined ? {} : { timeoutMs: this.options.git.timeoutMs }),
        format: 'targz'
      })
      return sha256
    }
  }

  /** The filesystem location of one source. */
  /** 中文：解析一个源实际使用的文件系统路径，本地源读取自身目录。 */
  private sourceCheckoutPath(source: SourceRef): string {
    return source.local === true ? expandHome(source.url) : sourceCheckoutDir(this.options.userRoot, source.id)
  }

  /** 按维度、源状态和缓存策略构建一致性套件快照。 */
  private async buildSnapshot(state: SuiteState, dimension: SuiteDimension, dimensionRoot: string, skipScanCache = false): Promise<CatalogSnapshot> {
    const fingerprint = JSON.stringify([dimension, dimensionRoot, state.sources, this.scanProjectLayouts])
    const cached = this.scanCache.get(fingerprint)
    // The user snapshot's TTL also bounds scan reuse: a snapshot rebuild that
    // replays a 30s scan cache would silently outlive its own staleness bound.
    // 中文：用户快照 TTL 同样限制扫描缓存复用，避免快照重建后超过自身新鲜度边界。
    const scanCacheTtl = dimension === 'user' ? Math.min(this.userSnapshotTtlMs, Catalog.SCAN_CACHE_TTL_MS) : Catalog.SCAN_CACHE_TTL_MS
    const cacheFresh = !skipScanCache && cached !== undefined && Date.now() - cached.at < scanCacheTtl
    let discovered: Suite[]
    let scanNotes: Record<string, string[]>
    if (cacheFresh && cached !== undefined) {
      discovered = cached.discovered
      scanNotes = cached.scanNotes
    } else {
      const generation = this.scanGeneration
      let pending = this.scanPromises.get(fingerprint)
      if (pending === undefined) {
        pending = discoverSourceListWithNotes(state.sources, dimension, dimensionRoot, this.scanProjectLayouts)
        this.scanPromises.set(fingerprint, pending)
      }
      let result: Awaited<typeof pending>
      try {
        result = await pending
      } finally {
        if (this.scanPromises.get(fingerprint) === pending) this.scanPromises.delete(fingerprint)
      }
      discovered = result.suites
      scanNotes = result.scanNotes
      // A scan started before a content mutation must not repopulate its cache.
      // 中文：内容变更前启动的扫描不能在完成后重新填充旧缓存。
      if (generation === this.scanGeneration) {
        if (this.scanCache.size >= Catalog.SCAN_CACHE_MAX_ENTRIES) this.scanCache.clear()
        this.scanCache.set(fingerprint, { at: Date.now(), discovered, scanNotes })
      }
    }
    const suites = discovered.map(suite => {
      const installed = state.installed[installKey(suite.sourceId, suite.id)]
      // Native project layouts (`.claude/`, `.agents/`) are the repository's
      // own files read in place: they carry no install state and stay enabled.
      // 中文：项目原生布局直接读取仓库自身文件，不依赖安装记录且始终保持启用。
      const enabled = suite.manifest.layout === 'project-native' || installed?.enabled === true
      return {
        ...suite,
        enabled,
        activeSurfaces: {
          ...effectiveSurfaces(installed?.surfaces),
          ...(suite.manifest.layout === 'project-native' ? suite.activeSurfaces : {}),
          ...(dimension === 'project' ? { lsp: false } : {})
        },
        ...(installed?.lockCommit === undefined ? {} : { lockCommit: installed.lockCommit }),
        ...(installed?.installedAt === undefined ? {} : { installedAt: installed.installedAt })
      }
    })
    return {
      revision: this.revision,
      sources: [...state.sources],
      suites,
      enabledSuites: suites.filter(suite => suite.enabled),
      ...(Object.keys(scanNotes).length > 0 ? { scanNotes } : {})
    }
  }

  /** 清空用户/项目快照缓存，并按需递增目录修订号。 */
  private invalidateSnapshot(increment: boolean): void {
    if (increment) this.revision++
    this.userSnapshot = undefined
    this.userSnapshotExpiresAt = 0
    this.userSnapshotPromise = undefined
    this.projectSnapshots.clear()
    this.projectSnapshotPromises.clear()
  }

  /** 清空扫描结果与进行中的扫描承诺，并推进扫描代数。 */
  private invalidateScans(): void {
    this.scanGeneration++
    this.scanCache.clear()
    this.scanPromises.clear()
  }

  /**
   * Invalidate snapshots and run the change pipeline. `keepScanCache` marks
   * state-only mutations (install, enable, surface toggles, MCP overrides)
   * whose inputs leave every checkout untouched, so the next snapshot
   * re-derives from cached discovery instead of rescanning the filesystem.
   * 中文：失效快照并执行宿主变更回调；纯状态变更可保留发现缓存。
   */
  private async notifyChanged(keepScanCache = false): Promise<void> {
    if (!keepScanCache) this.invalidateScans()
    this.invalidateSnapshot(true)
    await this.options.onChanged()
    for (const listener of this.listeners) listener()
  }

  /** 串行排队所有目录变更，保证前一个失败后队列仍能继续处理。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.catch(() => {})
    return result
  }
}

/** 生成源 ID 与套件 ID 的稳定安装记录键。 */
function installKey(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

/** Read a checkout's HEAD when it is a Git repository. */
/** 中文：尽力读取 Git 检出的 HEAD；非 Git 或损坏目录返回 undefined。 */
async function tryHead(dir: string): Promise<string | undefined> {
  try {
    return await gitHead(dir)
  } catch {
    return undefined
  }
}

/**
 * The codeload tarball URL of a GitHub repository, or undefined for any
 * other host. `https://github.com/<owner>/<repo>` maps to
 * `https://codeload.github.com/<owner>/<repo>/tar.gz/refs/heads/<branch>`
 * (or `/tar.gz/HEAD` for the default branch) — the git-protocol fallback
 * when a clone cannot get through but plain HTTPS file download can.
 * 中文：仅把标准 GitHub 仓库地址转换成对应 codeload tarball，其他主机返回 undefined。
 */
export function codeloadTarballUrl(url: string, branch: string | undefined): string | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url.trim())
  if (match === null) return undefined
  const [, owner, repo] = match
  return `https://codeload.github.com/${owner}/${repo}/tar.gz/${branch === undefined ? 'HEAD' : `refs/heads/${branch}`}`
}
