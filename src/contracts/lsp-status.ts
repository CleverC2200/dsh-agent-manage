/** 文件作用：定义 LSP 状态、诊断和直接配置接口共用的传输契约。 */
/** Browser-safe LSP status records shared by host aggregation and client rendering. */
/** 中文：定义主机聚合与客户端渲染共用的浏览器安全 LSP 状态传输结构。 */

/** Whether an LSP row comes from a suite declaration or direct user configuration. */
/** 中文：标记 LSP 行来自套件声明还是用户直接配置。 */
export type LspStatusKind = 'plugin' | 'direct'

/** Operational state rendered for an LSP server row. */
/** 中文：定义状态面板展示的 LSP 运行状态。 */
export type LspStatusState = 'mounted' | 'starting' | 'host-missing' | 'failed' | 'conflict' | 'disabled'

/**
 * One declared language-server row for the status surface.
 *
 * Rows are built from the enabled suites' inline `lspServers` declarations
 * plus the user's direct configuration, merged with the latest mount
 * diagnostics; the DSH `ctx.lsp` seam exposes no provider snapshot, so this
 * is a declaration-and-diagnostic model, not a process probe.
 */
/** 中文：该模型依据声明和诊断构造，不代表对 LSP 进程本身的实时探测。 */
export interface LspStatusEntry {
  /** Stable row id: `${suiteId}/${serverKey}` (suite rows) or `direct/${serverKey}`. */
  /** 中文：稳定行 ID；套件行为 `${suiteId}/${serverKey}`，直配行为 `direct/${serverKey}`。 */
  id: string
  /** Server key from the declaring `lspServers` table. */
  /** 中文：声明方 lspServers 表中的服务器键。 */
  serverKey: string
  /** Declaring suite id; the sentinel `direct` for user-configured rows. */
  /** 中文：声明套件 ID；用户直配行使用 `direct` 占位值。 */
  suiteId: string
  /** Declaring suite display name. */
  /** 中文：声明套件的展示名称。 */
  suiteName: string
  /** Source id of the declaring suite; empty for user-configured rows. */
  /** 中文：声明套件所属 source ID；用户直配行为空字符串。 */
  sourceId: string
  /** Where the row comes from. */
  /** 中文：该状态行的来源类别。 */
  kind: LspStatusKind
  /** Executable the host will spawn. */
  /** 中文：主机将要启动的可执行文件。 */
  command: string
  /** Executable arguments. */
  /** 中文：传给可执行文件的参数列表。 */
  args: string[]
  /** Lowercase leading-dot extension → LSP language id. */
  /** 中文：小写、带前导点的扩展名到 LSP 语言 ID 的映射。 */
  extensions: Record<string, string>
  /** Operational state. */
  /** 中文：当前运行状态。 */
  state: LspStatusState
  /** Latest diagnostic reason, when the state is not `mounted`/`disabled`. */
  /** 中文：当状态不是 `mounted`/`disabled` 时记录最新诊断原因。 */
  reason?: string
  /** Whether a failed mount will be retried automatically. */
  /** 中文：挂载失败时是否会自动重试。 */
  retryable?: boolean
}

/** The LSP status response returned by the host. */
/** 中文：主机返回给状态页面的 LSP 状态响应。 */
export interface LspStatusPayload {
  entries: LspStatusEntry[]
  observedAt: string
  totals: { all: number; mounted: number; failed: number; blocked: number; disabled: number }
  /** True when the host lacks the LSP packages, so every declaration is blocked. */
  /** 中文：主机缺少 LSP 包时为 true，此时所有声明都会被阻断。 */
  hostMissing: boolean
}
