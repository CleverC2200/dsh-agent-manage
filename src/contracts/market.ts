/** 文件作用：定义市场 HTTP 路由、请求载荷和响应记录等主机/客户端共用契约。 */
/** Browser-safe market wire records and route constants shared by host and client. */
/** 中文：定义主机与客户端共用的市场路由、请求载荷和响应记录。 */

/** Prefix for all Agent Plugins Market HTTP routes. */
/** 中文：所有 Agent Plugins Market HTTP 路由共用的前缀。 */
export const MARKET_API_PREFIX = '/api/agent-plugins/' as const

/** Fixed Agent Plugins Market HTTP routes. */
/** 中文：集中维护市场各功能的固定 HTTP 路由，避免客户端和主机拼接不一致。 */
export const MARKET_ROUTES = {
  modelCatalog: `${MARKET_API_PREFIX}model-catalog`,
  mcpBackend: `${MARKET_API_PREFIX}mcp-backend`
} as const

/** Editable service configuration; masked values are preserved when unchanged. */
/** 中文：可编辑的服务配置；未修改时保留服务端脱敏值。 */
export interface ServerConfigPayload {
  kind: 'mcp' | 'lsp'
  id: string
  editable: boolean
  config: Record<string, unknown>
}

/** Public model identities and exact-model reasoning options; never provider configuration. */
/** 中文：只提供公开模型身份和精确模型的推理选项，不暴露 provider 配置。 */
export interface ModelCatalogPayload {
  providers: Array<{ id: string; name: string }>
  models: Array<{ id: string; name: string }>
  reasoning?: { efforts: Array<{ id: string; name: string; description?: string }>; defaultEffort?: string }
}

/** The MCP mount backend state reported to the settings page. */
/** 中文：设置页展示的 MCP 挂载后端状态。 */
export interface McpBackendPayload {
  backend: 'builtin' | 'host'
  /** Whether the host `dsh-mcp-client` resolves from the plugin context. */
  /** 中文：插件上下文中是否能解析到主机 dsh-mcp-client。 */
  hostClient: { available: boolean; version?: string }
  /** Download region: the persisted setting and its locale-resolved route. */
  /** 中文：下载区域的持久化设置及按本地化规则解析后的实际区域。 */
  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

/** One unmanaged `.sources/` checkout the user can adopt as a source. */
/** 中文：`.sources/` 中尚未纳管、可被用户接收为数据源的检出目录。 */
export interface UnmanagedSource {
  id: string
  /** The checkout's `origin` remote URL; absent for non-git directories. */
  /** 中文：检出目录的 origin 远程地址；非 Git 目录没有该字段。 */
  url?: string
}

/** A configured source row returned to the market client. */
/** 中文：市场客户端展示的一条已配置数据源记录。 */
export interface SourceOverview {
  id: string
  url: string
  branch?: string
  local?: boolean
  /** Acquisition kind (`git` / `local` / `archive`); `local` mirrors the legacy flag. */
  /** 中文：采集类型；local 与历史 local 标记保持兼容。 */
  kind: string
  /** The checkout pre-existed (manually cloned or adopted); never deleted on removal. */
  /** 中文：检出目录在纳管前已存在，移除数据源时不得删除该目录。 */
  adopted?: boolean
  cloned: boolean
  lockCommit?: string
  error?: string
  /** Scanner diagnostics for this source (dropped entries, fallbacks taken);
   *  absent when the scan completed with no notes. */
  /** 中文：扫描诊断信息；无诊断时省略该字段。 */
  scanNotes?: string[]
  suiteIds: string[]
}

/** Counts of runtime surfaces displayed on a suite card. */
/** 中文：套件卡片上展示的各运行 surface 数量。 */
export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

/** Effective per-surface enablement of an installed suite. */
/** 中文：已安装套件各 surface 合并默认值和覆盖后的最终启用状态。 */
export interface SuiteSurfaceToggles {
  skills: boolean
  mcp: boolean
  hooks: boolean
  commands: boolean
  agents: boolean
  lsp: boolean
}

/** One server's persisted MCP override (wire shape mirrors runtime types). */
/** 中文：单个 MCP 服务器的持久化覆盖项，传输结构与 runtime 类型对应。 */
export type McpServerOverrideWire = {
  enabled?: boolean
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
  args?: string[]
}

/** Overrides for one suite keyed by mcp.json server key. */
/** 中文：按 mcp.json 服务器键索引的单个套件覆盖配置。 */
export type McpSuiteOverridesWire = Record<string, McpServerOverrideWire>

/** A normalized suite card returned by the overview route. */
/** 中文：概览路由返回的标准化套件卡片数据。 */
export interface SuiteOverviewCard {
  sourceId: string
  suiteId: string
  name: string
  version?: string
  description?: string
  keywords: string[]
  surfaces: SuiteSurfaceCounts
  enabled: boolean
  installed: boolean
  /** Per-surface toggles; present on installed suites only. */
  /** 中文：各 surface 的开关，仅已安装套件返回。 */
  surfaceToggles?: SuiteSurfaceToggles
  dimension: string
  layout: string
  remoteUrl?: string
  errors: string[]
  mcpErrors?: string[]
}

/** The market overview response. */
/** 中文：市场概览响应，包含来源、套件、统计和根目录信息。 */
export interface OverviewPayload {
  sources: SourceOverview[]
  suites: SuiteOverviewCard[]
  totals: { all: number; installed: number; enabled: number }
  roots: { user: string; data: string }
  /** Unmanaged `.sources/` checkouts (manual clones) available for adoption. */
  /** 中文：可接收纳管的手工检出 `.sources/` 目录。 */
  unmanaged?: UnmanagedSource[]
}

/** Host-side progress of the source mutation currently in flight. */
/** 中文：主机正在执行的数据源变更进度。 */
export interface SourceProgress {
  active: boolean
  sourceId: string
  step: string
}

/** One skill's metadata inside a suite detail response. */
/** 中文：套件详情响应中的单个 skill 元数据。 */
export interface SuiteSkillMeta {
  name: string
  description: string
  whenToUse?: string
  path: string
}

/** One command or agent preview in a suite detail response. */
/** 中文：套件详情响应中的 command 或 agent 预览。 */
export interface MarkdownPreview {
  name: string
  description?: string
  content: string
}

/** Claude Code command preview alias retained for feature-specific readability. */
/** 中文：保留 Claude Code command 别名，提升业务特性代码可读性。 */
export type CommandPreview = MarkdownPreview
/** Claude Code agent preview alias retained for feature-specific readability. */
/** 中文：保留 Claude Code agent 别名，提升业务特性代码可读性。 */
export type AgentPreview = MarkdownPreview

/** One LSP definition preview in a suite detail response. */
/** 中文：套件详情响应中的一条 LSP 定义预览。 */
export interface LspPreview {
  name: string
  content: string
}

/** One inline-declared LSP server in a suite detail response. */
/** 中文：套件详情响应中的一条内联 LSP 服务器声明。 */
export interface LspServerPreview {
  /** Server key from the declaring `lspServers` table. */
  /** 中文：声明方 lspServers 表中的服务器键。 */
  key: string
  command: string
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  /** 中文：小写、带前导点的扩展名到 LSP 语言 ID 的映射。 */
  extensions: Record<string, string>
  env?: Record<string, string>
}

/** The suite's LSP surface: inline-declared servers plus directory definition files. */
/** 中文：套件 LSP surface，包含内联服务器和目录定义文件。 */
export interface LspSurfaceDetail {
  servers: LspServerPreview[]
  raw: LspPreview[]
}

/** One flattened hook entry in a suite detail response. */
/** 中文：套件详情响应中的一条扁平化 hook。 */
export interface HookPreview {
  event: string
  matcher?: string
  command: string
}

/** One validated MCP server detail in a suite detail response. */
/** 中文：套件详情响应中的一条已校验 MCP 服务器详情。 */
export interface McpServerDetail {
  key: string
  type: string
  command?: string
  url?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  headers?: Record<string, string>
  /** External credential references used by env/header/argument placeholders. */
  /** 中文：env、header 或参数占位符引用的外部凭据名。 */
  credentialRefs: string[]
}

/** Full suite detail response served by the detail modal. */
/** 中文：详情弹窗使用的完整套件详情响应。 */
export interface SuiteDetail {
  sourceId: string
  suiteId: string
  name: string
  version: string | null
  description: string | null
  author: string | null
  keywords: string[]
  layout: string
  dimension: string
  root: string
  remoteUrl: string | null
  installed: boolean
  enabled: boolean
  surfaceToggles: SuiteSurfaceToggles | null
  /** Persisted per-server MCP overrides (suite's mcp.json stays source-owned). */
  /** 中文：持久化的逐服务器 MCP 覆盖；套件 mcp.json 仍由来源拥有。 */
  mcpOverrides?: McpSuiteOverridesWire
  skills: SuiteSkillMeta[]
  mcpServers: McpServerDetail[]
  hooks: { count: number; entries: HookPreview[] }
  commands: MarkdownPreview[]
  agents: MarkdownPreview[]
  lsp: LspSurfaceDetail
  errors: string[]
  mcpErrors: string[]
}

/** One skill's full file text served by the skill route. */
/** 中文：skill 路由返回的一份完整文件文本。 */
export interface SkillContent {
  name: string
  description: string
  content: string
  path: string
}

/** A user panel entry (skills / commands / agent personas) over HTTP. */
/** 中文：通过 HTTP 提供给用户面板的 skill、command 或 agent persona 条目。 */
export interface UserPanelEntryWire {
  name: string
  description: string
  disabled: boolean
  /** User entries are editable; plugin source files remain read-only. */
  /** 中文：用户条目可编辑，插件来源文件保持只读。 */
  origin: 'user' | 'plugin'
  id?: string
  rawText: string
  /** Human-readable suite owner for a plugin-provided entry. */
  /** 中文：插件条目所属套件的人类可读名称。 */
  suiteName?: string
  metadata: Record<string, unknown>
  path: string
  content: string
}

/** The user panel surface the market exposes. */
/** 中文：市场对外提供的用户面板类型。 */
export type UserPanelKind = 'skills' | 'commands' | 'agents'
