/** 文件作用：提供市场查询和配置变更服务，统一编排目录、运行时和用户面板数据。 */
/**
 * Narrow application interfaces consumed by the HTTP transport adapter.
 *
 * 中文：本文件定义 HTTP 路由层可调用的应用服务边界，将只读查询与写操作分开，避免路由依赖 Catalog 的内部实现。
 */
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail } from '../contracts/market.js'
import type { SourceRef, SuiteSurfaceKey } from '../model/types.js'
import type { RuntimeManagement } from './runtime-management.js'

/** Runtime operations consumed by HTTP; implementations and diagnostics stay with RuntimeManagement. */
export type MarketRuntime = Pick<
  RuntimeManagement,
  | 'serverConfig'
  | 'saveServerConfig'
  | 'mcpStatus'
  | 'lspStatus'
  | 'lspServers'
  | 'mcpOverrides'
  | 'setMcpOverride'
  | 'addMcpServer'
  | 'addLspServer'
  | 'setLspServers'
  | 'setLspServerEnabled'
  | 'retryMounts'
  | 'reauthorizeMcpServer'
  | 'mcpReauthorizeAvailable'
  | 'mcpBackendInfo'
  | 'setMcpBackend'
>

/** Read-only market operations required by HTTP routes. 中文：HTTP 路由所需的只读市场查询集合。 */
export interface MarketQueries {
  readonly runtime: MarketRuntime
  /** 返回当前已登记的源引用。 */
  readonly sources: SourceRef[]
  /** 读取市场源、套件和安装统计总览。 */
  overview(): Promise<OverviewPayload>
  /** 返回当前源获取/刷新进度。 */
  sourceProgress(): SourceProgress
  /** 读取指定套件的完整详情。 */
  suiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail>
  /** 读取指定套件技能的完整正文。 */
  skillContent(sourceId: string, suiteId: string, skillName: string): Promise<SkillContent>
}

/** Mutating market operations required by HTTP routes. 中文：HTTP 路由允许触发的市场写操作集合。 */
export interface MarketMutations {
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
}

/** Complete application surface required by the HTTP routes. 中文：路由层所需的完整应用服务约定，由查询与写操作组合而成。 */
export type MarketService = MarketQueries & MarketMutations
