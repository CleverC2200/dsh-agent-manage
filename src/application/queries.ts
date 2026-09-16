/** 文件作用：提供市场查询和配置变更服务，统一编排目录、运行时和用户面板数据。 */
/**
 * Narrow application interfaces consumed by the HTTP transport adapter.
 *
 * 中文：本文件定义 HTTP 路由层可调用的应用服务边界，将只读查询与写操作分开，避免路由依赖 Catalog 的内部实现。
 */
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { SourceRef, SuiteSurfaceKey } from '../model/types.js'
import type { McpServerOverride, McpSuiteOverrides } from '../runtime/mcp-overrides.js'
import type { HostMcpClientProbe, McpBackend } from '../runtime/mcp-backend.js'
import type { ServerConfigPayload } from '../contracts/market.js'

/** Read-only market operations required by HTTP routes. 中文：HTTP 路由所需的只读市场查询集合。 */
export interface MarketQueries {
  /** 读取服务配置并返回脱敏后的可编辑视图。 */
  serverConfig(kind: 'mcp' | 'lsp', id: string): Promise<ServerConfigPayload>
  /** 返回当前已登记的源引用。 */
  readonly sources: SourceRef[]
  /** 读取市场源、套件和安装统计总览。 */
  overview(): Promise<OverviewPayload>
  /** 读取 MCP 服务状态、来源和工具清单。 */
  mcpStatus(): Promise<McpStatusPayload>
  /** 读取 LSP 声明与挂载诊断状态。 */
  lspStatus(): Promise<LspStatusPayload>
  /** 读取用户直配的规范化 LSP 服务表。 */
  lspServers(): Promise<Record<string, import('../model/types.js').LspServerSpec>>
  /** 返回当前源获取/刷新进度。 */
  sourceProgress(): SourceProgress
  /** 读取指定套件的完整详情。 */
  suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail>
  /** 读取指定套件技能的完整正文。 */
  skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent>
  /** 读取指定套件的脱敏 MCP 覆盖配置。 */
  mcpOverrides(sourceId: string, suiteId: string): Promise<McpSuiteOverrides>
}

/** Mutating market operations required by HTTP routes. 中文：HTTP 路由允许触发的市场写操作集合。 */
export interface MarketMutations {
  /** 校验并保存 MCP/LSP 服务完整配置替换。 */
  saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: unknown): Promise<void>
  /** 新增并挂载用户直配 MCP 服务。 */
  addMcpServer(name: string, server: unknown): Promise<void>
  /** 新增用户直配 LSP 服务。 */
  addLspServer(name: string, config: unknown): Promise<void>
  /** 登记源并立即获取其内容。 */
  addSource(input: { url: string; branch?: string; local?: boolean; kind?: 'git' | 'local' | 'archive'; sha256?: string }): Promise<SourceRef>
  /** 更新源元数据，并按需要处理旧检出。 */
  updateSource(sourceId: string, patch: { url?: string; branch?: string; local?: boolean; kind?: 'git' | 'local' | 'archive'; sha256?: string }): Promise<void>
  /**
   * Remove a source registration; `deleteCheckout` also physically deletes
   * its managed `.sources/<id>` checkout. External local paths are never deleted.
   *
   * 中文：删除源的登记信息；只有显式设置 `deleteCheckout` 时才删除受管 checkout，外部本地目录永不删除。
   */
  removeSource(sourceId: string, deleteCheckout?: boolean): Promise<void>
  /** Register an unmanaged `.sources/` checkout in place (manual-clone repair). 中文：就地接管手工克隆但未纳管的 checkout。 */
  adoptSource(id: string): Promise<SourceRef>
  /** 刷新指定源或全部源的内容。 */
  refreshSource(sourceId?: string): Promise<void>
  /** 安装并启用一个套件。 */
  install(sourceId: string, suiteId: string): Promise<void>
  /** 移除套件安装记录并保留源检出。 */
  uninstall(sourceId: string, suiteId: string): Promise<void>
  /** 切换已安装套件整体启用状态。 */
  setEnabled(sourceId: string, suiteId: string, enabled: boolean): Promise<void>
  /** 切换已安装套件的单个能力面。 */
  setSurface(sourceId: string, suiteId: string, surface: SuiteSurfaceKey, enabled: boolean): Promise<void>
  /** 设置或清除指定 MCP 服务的脱敏覆盖。 */
  setMcpOverride(sourceId: string, suiteId: string, serverKey: string, override: McpServerOverride | null): Promise<void>
  /** Validate and persist the user's direct LSP server table. 中文：验证并保存用户直接配置的 LSP 服务表。 */
  setLspServers(raw: unknown): Promise<Record<string, import('../model/types.js').LspServerSpec>>
  /** 切换用户直配 LSP 的禁用状态。 */
  setLspServerEnabled(id: string, enabled: boolean): Promise<void>
  /** Re-run the MCP reconcile pass: retries failed mounts and clears residual tools. 中文：重跑 MCP 对账，重试失败挂载并清理残留工具。 */
  retryMounts(): Promise<void>
  /** 清除一个 MCP 服务授权记录并请求重新挂载。 */
  reauthorizeMcpServer(serverName: string): Promise<void>
  /** 报告当前组合是否支持重新授权。 */
  mcpReauthorizeAvailable(): boolean
  /** The active MCP backend, host-client probe, and download region. 中文：返回当前 MCP 后端、主机客户端探测与下载地区信息。 */
  mcpBackendInfo(): Promise<{
    backend: McpBackend
    hostClient: HostMcpClientProbe
    downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
  }>
  /** Switch the MCP mount backend and remount every suite server through it. 中文：切换 MCP 挂载后端，并让全部 suite 服务按新后端重新挂载。 */
  setMcpBackend(backend: McpBackend): Promise<void>
  /**
   * Panel change hook: the HTTP layer notifies after a user-panel mutation
   * (skills / commands / agent personas) so the runtime remounts commands
   * and the skill providers re-read their catalogs.
   *
   * 中文：用户面板资源变更后由 HTTP 层触发，让运行时重挂命令，并让技能提供器重读目录。
   */
  notifyPanelsChanged(): Promise<void>
}

/** Complete application surface required by the HTTP routes. 中文：路由层所需的完整应用服务约定，由查询与写操作组合而成。 */
export type MarketService = MarketQueries & MarketMutations
