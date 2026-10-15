/** 文件作用：定义 MCP 状态行、诊断和工具观察结果的浏览器安全传输契约。 */
/** Browser-safe MCP status records shared by host aggregation and client rendering. */
/** 中文：定义主机聚合与客户端渲染共用的浏览器安全 MCP 状态传输结构。 */

/** A tool observed in the host MCP tool registry. */
/** 中文：主机 MCP 工具注册表中观察到的一项工具。 */
export interface McpStatusTool {
  name: string
  description?: string
}

/** Whether an MCP row comes from a suite or direct host observation. */
/** 中文：标记 MCP 行来自套件声明还是主机直接观察。 */
export type McpStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an MCP row. `foreign` = mounted by another MCP client (informational). */
/** 中文：定义 MCP 行展示的运行状态；foreign 表示其他 MCP 客户端挂载，仅供提示。 */
export type McpStatusState = 'connected' | 'degraded' | 'failed' | 'needs-credentials' | 'orphaned' | 'disabled' | 'foreign'

export type McpConnectionState = 'connecting' | 'connected' | 'failed' | 'awaiting-authorization' | 'authorization-cancelled' | 'authorization-failed'

/** One MCP service row for the status surface. */
/** 中文：状态面板中的一条 MCP 服务记录。 */
export interface McpStatusEntry {
  id: string
  name: string
  kind: McpStatusKind
  /** A direct service whose persisted configuration is owned by this plugin. */
  /** 中文：直配服务的持久化配置由本插件负责管理。 */
  managed?: boolean
  /** The current backend and credential service support resetting this server's OAuth grant. */
  /** 中文：当前后端和凭据服务支持重置该服务器的 OAuth 授权。 */
  canReauthorize?: boolean
  /** Current supervised connection; zero advertised tools can still be connected. */
  connectionState?: McpConnectionState
  state: McpStatusState
  source?: string
  suiteId?: string
  serverKey?: string
  transport: string
  endpoint?: string
  config?: Record<string, unknown>
  tools: McpStatusTool[]
  reason?: string
  /** Mount-path classification when a diagnostic produced this row. */
  /** 中文：诊断生成该行时对应的挂载路径分类。 */
  code?: 'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed' | 'foreign-mount' | 'duplicate-mount'
  /** Environment-variable credential references required by this server. */
  /** 中文：该服务器通过环境变量引用的外部凭据名。 */
  credentialRefs?: string[]
  /** Whether this server advertised zero tools at observation time. Zero-tool
   *  servers are legitimate, so the panel never treats `degraded` as broken. */
  /** 中文：观察时服务器是否声明了零个工具；零工具是合法状态，不等同于故障。 */
  advertisedTools?: boolean
  /** Whether a failed server will be retried automatically. */
  /** 中文：服务器失败时是否会自动重试。 */
  retryable?: boolean
}

/** The MCP status response returned by the host. */
/** 中文：主机返回给状态页面的 MCP 状态响应。 */
export interface McpStatusPayload {
  entries: McpStatusEntry[]
  observedAt: string
  totals: { all: number; connected: number; degraded: number; failed: number; needsCredentials: number; orphaned: number; disabled: number; foreign: number }
  directObservationOnly: boolean
}
