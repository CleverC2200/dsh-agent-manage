/** 文件作用：定义来源、套件、组件、覆盖配置和扫描结果等核心领域类型。 */
/**
 * Shared shapes for the dsh-agent-plugins-market Agent Plugins manager.
 *
 * A suite is the portable Agent Plugins package defined by the
 * agent-plugins.org v1.0.0 specification, plus the two dialect layouts this
 * manager normalizes as inputs (Claude Code `.claude-plugin/plugin.json` and
 * Codex `.codex-plugin/plugin.json`). Discovery maps every layout onto this
 * internal shape; runtime injection consumes only the internal shape.
 */
/** 中文：集中定义来源、套件、surface 及运行时注入共用的领域类型，catalog 负责归一化，runtime 只消费归一化结构。 */

/** How a source's content is acquired. */
/** 中文：数据源内容的获取方式。 */
export type SourceKind = 'git' | 'local' | 'archive'

/** One configured repository source. */
/** 中文：一条已配置的仓库数据源。 */
export interface SourceRef {
  /** Stable local id; `[a-z0-9][a-z0-9-]*`, unique across sources. */
  /** 中文：稳定的本地 ID，符合 `[a-z0-9][a-z0-9-]*` 且在来源间唯一。 */
  id: string
  /** Git URL, archive (zip / tar.gz) URL, or a local directory path. */
  /** 中文：Git 地址、压缩包地址或本地目录路径。 */
  url: string
  /** Optional branch to pin (git sources only). */
  /** 中文：可选的固定分支，仅 Git 来源适用。 */
  branch?: string
  /** Read the source directory directly instead of cloning it (legacy flag; `kind: 'local'`). */
  /** 中文：直接读取来源目录而不克隆；历史标记，与 `kind: 'local'` 等价。 */
  local?: boolean
  /** Acquisition kind; inferred from the URL shape when omitted. */
  /** 中文：采集类型；缺省时根据 URL 形状推断。 */
  kind?: SourceKind
  /** Expected SHA-256 of an archive download (archive sources only). */
  /** 中文：压缩包下载的预期 SHA-256，仅 archive 来源适用。 */
  sha256?: string
  /** The checkout pre-existed (manually cloned or adopted); never deleted on source removal. */
  /** 中文：检出目录在纳管前已存在，移除来源时不得删除。 */
  adopted?: boolean
}

/** Archive URL extensions the archive acquisition path understands. */
/** 中文：压缩包采集路径识别的 URL 扩展名。 */
const ARCHIVE_URL_PATTERN = /\.(zip|tgz|tar\.gz|tar)$/i

/** Whether a URL points at a downloadable archive. */
/** 中文：判断 URL 是否指向可下载的压缩包。 */
export function isArchiveUrl(url: string): boolean {
  /** 去除首尾空格后按支持的压缩包后缀进行大小写不敏感匹配。 */
  return ARCHIVE_URL_PATTERN.test(url.trim())
}

/**
 * Effective acquisition kind of a source: the explicit `kind` wins, the
 * legacy `local` flag maps to `'local'`, archive-shaped URLs infer
 * `'archive'`, and everything else stays `'git'`.
 */
/** 中文：显式 kind 优先，其次兼容 legacy local 标记，再按 URL 推断 archive，剩余视为 git。 */
export function resolveSourceKind(source: Pick<SourceRef, 'url' | 'local' | 'kind'>): SourceKind {
  /** 将来源输入归一化为 runtime 使用的唯一采集类型。 */
  if (source.local === true || source.kind === 'local') return 'local'
  if (source.kind === 'git' || source.kind === 'archive') return source.kind
  return isArchiveUrl(source.url) ? 'archive' : 'git'
}

/** The manifest layout a suite root was discovered under. */
/** 中文：套件根目录被发现时所使用的 manifest 布局。 */
export type SuiteLayoutKind = import('./layouts.js').ManifestKind | 'skill-collection' | 'remote' | 'project-native'

/** Normalized suite manifest fields. */
/** 中文：归一化后的套件 manifest 字段。 */
export interface SuiteManifest {
  components?: SuiteComponents
  skillInstructions?: string
  startupSkill?: string
  systemPrompt?: string
  systemPromptPath?: string
  layout: SuiteLayoutKind
  /** Absolute manifest file path. */
  /** 中文：manifest 文件的绝对路径。 */
  path: string
  /** Suite id derived from the manifest name or its root directory, sanitized to `[a-z0-9-]`. */
  /** 中文：由 manifest 名称或根目录生成并清洗为 `[a-z0-9-]` 的套件 ID。 */
  id: string
  name: string
  version?: string
  description?: string
  author?: string
  keywords?: string[]
  /** For agent-plugin-v1: the recognized `$schema` identifier. */
  /** 中文：agent-plugin-v1 中识别到的 `$schema` 标识。 */
  schemaVersion?: string
}

/** Raw layout declarations are resolved once by the catalog into runtime resources. */
/** 中文：原始布局声明由 catalog 一次解析为 runtime 资源。 */
export interface SuiteComponents {
  skills?: unknown
  commands?: unknown
  agents?: unknown
  hooks?: unknown
  mcpServers?: unknown
  lspServers?: unknown
}

export interface SuiteMarkdownResource {
  name: string
  file: string
  /** Inline resources retain their manifest as provenance, with content separate from its JSON file. */
  /** 中文：内联资源保留 manifest 作为来源依据，内容与 JSON 文件分开保存。 */
  content?: string
}

/** One skill shipped inside a suite (`<suiteRoot>/skills/<name>/SKILL.md`). */
/** 中文：套件内随附的单个 skill，对应 `<suiteRoot>/skills/<name>/SKILL.md`。 */
export interface SuiteSkill {
  /** Skill directory name; validated kebab-case. */
  /** 中文：skill 目录名，已校验为 kebab-case。 */
  name: string
  /** Absolute skill directory. */
  /** 中文：skill 目录绝对路径。 */
  directory: string
  /** Absolute SKILL.md path. */
  /** 中文：SKILL.md 文件绝对路径。 */
  file: string
  /** Frontmatter description, required for model catalogs. */
  /** 中文：frontmatter 描述，模型目录要求该字段。 */
  description: string
  /** Optional extra routing guidance from frontmatter. */
  /** 中文：frontmatter 中可选的额外路由指导。 */
  whenToUse?: string
  /** Invocation policy parsed from frontmatter with fail-closed semantics. */
  /** 中文：按 fail-closed 语义从 frontmatter 解析出的调用策略。 */
  invocation: { modelInvocable: boolean; userInvocable: boolean }
}

/** Counted surface tags rendered on market cards. */
/** 中文：市场卡片展示并计数的 surface 标签。 */
export interface SuiteSurfaceCounts {
  skills: number
  mcp: number
  hooks: number
  commands: number
  agents: number
  lsp: number
}

/** agent-plugins.org v1 `mcp.json` server variants. */
/** 中文：agent-plugins.org v1 `mcp.json` 支持的服务器变体。 */
export interface McpServerPolicy {
  enabledTools?: string[]
  disabledTools?: string[]
  startupTimeoutMs?: number
  toolCallTimeoutMs?: number
}

export interface McpServerStdio extends McpServerPolicy {
  type: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpServerStreamableHttp extends McpServerPolicy {
  type: 'streamable-http'
  url: string
  headers?: Record<string, string>
  /** Opt in to OAuth 2.1 authorization for servers that answer `401` with a challenge (on by default; `enabled: false` opts out). */
  /** 中文：可选启用 OAuth 2.1；默认启用，设置 `enabled: false` 可关闭。 */
  auth?: { enabled: boolean; scope?: string }
}

export interface McpServerSse extends McpServerPolicy {
  type: 'sse'
  url: string
  headers?: Record<string, string>
  /** OAuth 2.1 authorization, mirroring the streamable-http semantics. */
  /** 中文：OAuth 2.1 授权，语义与 streamable-http 保持一致。 */
  auth?: { enabled: boolean; scope?: string }
}

export type McpServer = McpServerStdio | McpServerStreamableHttp | McpServerSse

/** Parsed and validated `mcp.json` content. */
/** 中文：已解析并校验的 `mcp.json` 内容。 */
export interface McpSuiteConfig {
  /** Native project commands resolve from the project, not the agent configuration directory. */
  /** 中文：原生项目命令从项目目录解析，而不是从 agent 配置目录解析。 */
  root?: string
  schema: string
  servers: Record<string, McpServer>
}

/** One normalized inline LSP server declaration (`lspServers` table entry). */
/** 中文：一条归一化的内联 LSP 服务器声明，对应 lspServers 表项。 */
export interface LspServerSpec {
  /** Server key from the declaring table (e.g. `typescript`). */
  /** 中文：声明表中的服务器键，例如 `typescript`。 */
  key: string
  /** Executable to spawn (resolved on PATH by the LSP host). */
  /** 中文：要启动的可执行文件，由 LSP 主机从 PATH 解析。 */
  command: string
  /** Arguments passed to the executable. Default `[]`. */
  /** 中文：传给可执行文件的参数，默认是空数组。 */
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  /** 中文：小写、带前导点的扩展名到 LSP 语言 ID 的映射。 */
  extensionToLanguage: Record<string, string>
  /** Extra env vars merged over the ambient env. */
  /** 中文：在当前环境变量之上合并的额外环境变量。 */
  env?: Record<string, string>
  /** Static `initialize` options forwarded to the server. */
  /** 中文：转发给服务器的静态 `initialize` 选项。 */
  initializationOptions?: unknown
  /** Static answer to every `workspace/configuration` item. */
  /** 中文：对每个 `workspace/configuration` 请求返回的静态配置。 */
  configuration?: unknown
}

/** Parsed inline `lspServers` declarations of one suite. */
/** 中文：一个套件解析后的内联 lspServers 声明集合。 */
export interface LspSuiteConfig {
  servers: Record<string, LspServerSpec>
}

/** Install dimension of a suite. */
/** 中文：套件的安装维度。 */
export type SuiteDimension = 'user' | 'project'

/** One discovered suite with runtime-relevant fields resolved. */
/** 中文：一套已发现且已解析出运行时字段的套件。 */
export interface Suite {
  resources?: { commands: SuiteMarkdownResource[]; agents: SuiteMarkdownResource[] }
  systemPrompt?: string
  /** Validated native settings hooks; serialized only into a runtime-owned temporary file. */
  /** 中文：已校验的原生 settings hooks，只序列化到 runtime 管理的临时文件。 */
  hooks?: ProjectHooks
  sourceId: string
  id: string
  root: string
  manifest: SuiteManifest
  skills: SuiteSkill[]
  /** Validated mcp.json content; absent when the file is missing or invalid. */
  /** 中文：已校验的 mcp.json 内容；文件缺失或无效时省略。 */
  mcp?: McpSuiteConfig
  /** Parsed inline `lspServers` declarations; absent when the suite declares none. */
  /** 中文：解析后的内联 lspServers 声明；套件未声明时省略。 */
  lsp?: LspSuiteConfig
  surfaces: SuiteSurfaceCounts
  dimension: SuiteDimension
  enabled: boolean
  /** Effective per-surface enablement (overrides merged over enabled defaults). */
  /** 中文：合并启用默认值和用户覆盖后的各 surface 最终状态。 */
  activeSurfaces?: Record<SuiteSurfaceKey, boolean>
  lockCommit?: string
  installedAt?: string
  /** Remote marketplace reference (not cloned): the source URL plus the
   *  marketplace entry metadata; no local content is available. */
  /** 中文：未克隆的远程市场引用，只有来源 URL 和市场条目元数据，没有本地内容。 */
  remote?: { url: string }
  /** Surface diagnostics on a surviving suite; invalid declared manifests are rejected before discovery returns a suite. */
  /** 中文：仍保留在套件上的 surface 诊断；无效声明在发现返回前已被拒绝。 */
  errors: string[]
}

export interface ProjectHooks {
  projectRoot: string
  events: Record<string, Array<{ matcher?: string; hooks: Array<{ type: 'command'; command: string; timeout?: number }> }>>
}

/** Runtime surfaces that can be selectively enabled per installed suite. */
/** 中文：已安装套件可以单独启停的 runtime surface。 */
export type SuiteSurfaceKey = 'skills' | 'mcp' | 'hooks' | 'commands' | 'agents' | 'lsp'

/** Per-surface user overrides; absent keys default to enabled. */
/** 中文：按 surface 的用户覆盖；缺省键默认启用。 */
export type SurfaceOverrides = Partial<Record<SuiteSurfaceKey, boolean>>

/** The full set of toggleable surfaces, in display order. */
/** 中文：全部可切换 surface，顺序与界面展示顺序一致。 */
export const SUITE_SURFACE_KEYS: readonly SuiteSurfaceKey[] = ['skills', 'mcp', 'hooks', 'commands', 'agents', 'lsp']

/** Merge user overrides over the enabled default into the effective surface set. */
/** 中文：把用户覆盖合并到启用默认值，得到最终 surface 开关集合。 */
export function effectiveSurfaces(overrides: SurfaceOverrides | undefined): Record<SuiteSurfaceKey, boolean> {
  /** 对每个已知 surface 应用“只有明确 false 才关闭”的默认规则。 */
  return {
    skills: overrides?.skills !== false,
    mcp: overrides?.mcp !== false,
    hooks: overrides?.hooks !== false,
    commands: overrides?.commands !== false,
    agents: overrides?.agents !== false,
    lsp: overrides?.lsp !== false
  }
}

/** Persisted install entry, keyed `${sourceId}/${suiteId}`. */
/** 中文：按 `${sourceId}/${suiteId}` 索引的持久化安装记录。 */
export interface InstalledEntry {
  enabled: boolean
  lockCommit?: string
  installedAt: string
  /** Per-surface enable overrides; absent keys default to enabled. */
  /** 中文：各 surface 的启用覆盖；缺省键默认启用。 */
  surfaces?: SurfaceOverrides
}

/** The persisted suite state file (`<dimensionRoot>/state.json`). */
/** 中文：持久化套件状态文件，对应 `<dimensionRoot>/state.json`。 */
export interface SuiteState {
  version: 1
  sources: SourceRef[]
  installed: Record<string, InstalledEntry>
}

/** Browser-safe market records are shared from the transport contracts. */
/** 中文：浏览器安全的市场记录直接复用传输层 contract 类型。 */
export type { OverviewPayload, SourceOverview, SuiteOverviewCard } from '../contracts/market.js'
