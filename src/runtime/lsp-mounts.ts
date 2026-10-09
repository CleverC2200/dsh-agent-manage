/** 文件作用：将套件 LSP 声明挂载为宿主插件，维护重试、冲突和释放状态。 */
/**
 * Runtime LSP mounts: one live `dsh-lsp-stdio` child plugin per enabled
 * suite's inline `lspServers` table, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set exactly like the MCP mounts:
 * reconcile() unmounts rows whose suite was disabled or removed and mounts
 * rows that appeared. The host LSP package is optional at runtime — without
 * it, suites keep every other surface and the manager reports a one-line
 * `host-missing` diagnostic that does not enter the retry schedule (a missing
 * package is not a transient failure). Mount failures that can resolve after
 * user action (installing the language server executable) do retry.
 *
 * Provider identity: one `${suiteId}/${serverKey}` provider id per server, so
 * two suites declaring the same server key mount independently. Extension
 * ownership in `ctx.lsp` is exclusive by design; when two enabled suites
 * claim the same extension the later mount fails with `seam-conflict` and the
 * user resolves it through per-suite surface toggles.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
import type { Context } from '@deepseek-ai/cordis'
import { DIRECT_LSP_SUITE_ID } from './lsp-status.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { Suite } from '../model/types.js'

export interface LspMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: 'mount-failed' | 'unmount-failed' | 'seam-conflict' | 'host-missing'
}

interface LiveMount {
  fingerprint: string
  suiteId: string
  serverKeys: string[]
  disposer: () => void | Promise<void>
}

/**
 * Bounded retry schedule for a failed mount/unmount, mirroring the MCP
 * mounts: a permanently broken server must stop consuming attempt budget,
 * and the schedule resets with every reconcile pass.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

/** One dsh-lsp-stdio server configuration row (its Config.servers entry). */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface LspStdioServerConfig {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}

/** Build one dsh-lsp-stdio Config.servers entry from a normalized spec. */
/** 将领域 LSP 声明转换成宿主 stdio 插件所需的命令、参数和扩展配置。 */
export function toLspServerConfig(spec: {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}): LspStdioServerConfig {
  return {
    command: spec.command,
    args: spec.args,
    extensionToLanguage: spec.extensionToLanguage,
    ...(spec.env === undefined ? {} : { env: spec.env }),
    ...(spec.initializationOptions === undefined ? {} : { initializationOptions: spec.initializationOptions }),
    ...(spec.configuration === undefined ? {} : { configuration: spec.configuration })
  }
}

interface MountPluginHandle {
  /** 中文：等待 LSP 子插件完成初始化。 */
  await(): Promise<unknown>
  /** 中文：释放单个 LSP 子插件挂载。 */
  dispose(): void | Promise<void>
}

/** Structural `ctx.plugin` surface for mounting one plugin instance. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

/** Minimal structural shape of the dynamically imported `dsh-lsp-stdio` module. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
interface LspStdioModule {
  default?: unknown
}

/** Import spec kept as a string literal so the optional dependency stays dynamic. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const LSP_STDIO_IMPORT = '@deepseek-ai/dsh-lsp-stdio'

export class LspMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  /** Serialize mount and unmount passes so a disable cannot race an in-flight spawn. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private reconcileQueue: Promise<void> = Promise.resolve()
  /** Pending retry timers keyed by mount key, so a teardown can cancel them. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  /** Attempt count per mount key; reset whenever a retry succeeds. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private readonly attempts = new Map<string, number>()
  /** Snapshot of the last reconciled suite set, replayed by retry passes. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private lastEnabled: Suite[] = []
  /** Host module loader; overridable for tests. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private loadHost: () => Promise<LspStdioModule | undefined>
  /** Latest diagnostic per suite id; cleared when its suite mounts or leaves the wanted set. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private readonly lastDiagnostics = new Map<string, LspMountDiagnostic>()
  /** Direct (user-configured) server provider; defaults to none. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private directProvider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>> = async () => ({})
  private disabledProvider: () => Promise<Set<string>> = async () => new Set()
  private disabledSnapshot = new Set<string>()

  /** 绑定宿主上下文和可选 LSP 主机加载器，初始化串行对账状态。 */
  constructor(
    private readonly ctx: Context,
    loadHost?: () => Promise<LspStdioModule | undefined>
  ) {
    this.loadHost =
      loadHost ??
      (async () => {
        try {
          return (await import(/* @vite-ignore */ LSP_STDIO_IMPORT)) as LspStdioModule
        } catch {
          return undefined
        }
      })
  }

  /** Queue one reconciliation behind any in-flight mount/unmount pass. */
  /** 将对账串入队列并吞掉已记录失败，避免一次失败污染后续刷新。 */
  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Mount/unmount LSP servers to match the enabled suites plus direct config exactly. */
  /** 计算期望 LSP 表，卸载失效项并挂载新增项，失败写入诊断。 */
  private async reconcileNow(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    this.lastEnabled = [...enabledSuites]
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.lsp !== false)
    const wanted = new Map<string, { suite: Suite; config: Record<string, LspStdioServerConfig> }>()
    const diagnostics: LspMountDiagnostic[] = []
    const disabled = await this.disabledProvider()
    this.disabledSnapshot = new Set(disabled)
    for (const suite of active) {
      const servers = Object.values(suite.lsp?.servers ?? {})
      if (servers.length === 0) continue
      // The wanted key is the qualified suite id: bare suite ids are unique
      // per source only, so two sources shipping the same suite name would
      // otherwise shadow each other's mount and diagnostics.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const config: Record<string, LspStdioServerConfig> = {}
      for (const spec of servers) if (!disabled.has(`${key}/${spec.key}`)) config[`${key}/${spec.key}`] = toLspServerConfig(spec)
      if (Object.keys(config).length > 0) wanted.set(key, { suite, config })
    }
    // Direct user-configured servers ride the same mount path under the
    // sentinel suite id, so their lifecycle (retries, diagnostics, disposal)
    // is identical to a suite's.
    // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
    const direct = await this.directProvider()
    const directKeys = Object.keys(direct)
    if (directKeys.length > 0) {
      const config: Record<string, LspStdioServerConfig> = {}
      for (const [key, spec] of Object.entries(direct)) if (!disabled.has(`${DIRECT_LSP_SUITE_ID}/${key}`)) config[`${DIRECT_LSP_SUITE_ID}/${key}`] = toLspServerConfig(spec)
      if (Object.keys(config).length > 0)
        wanted.set(DIRECT_LSP_SUITE_ID, {
          suite: {
            sourceId: '',
            id: DIRECT_LSP_SUITE_ID,
            root: '',
            manifest: { layout: 'claude-code', path: '', id: DIRECT_LSP_SUITE_ID, name: DIRECT_LSP_SUITE_ID },
            skills: [],
            surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: directKeys.length },
            dimension: 'user',
            enabled: true,
            errors: []
          },
          config
        })
    }
    for (const [key, live] of [...this.live]) {
      if (!wanted.has(key) || live.fingerprint !== JSON.stringify(wanted.get(key)!.config)) {
        const reason = await this.unmount(key, live)
        this.lastDiagnostics.delete(key)
        if (reason !== undefined) diagnostics.push({ suiteId: key, serverKey: live.serverKeys.join(','), reason, code: 'unmount-failed' })
      }
    }
    for (const [key, entry] of wanted) {
      if (this.live.has(key)) {
        this.lastDiagnostics.delete(key)
        continue
      }
      const failure = await this.mountWith(key, entry.suite, entry.config)
      if (failure !== undefined) {
        diagnostics.push(failure)
        this.lastDiagnostics.set(key, failure)
        this.scheduleRetry(key, failure.code === 'host-missing' ? undefined : failure)
      } else {
        this.lastDiagnostics.delete(key)
      }
    }
    return diagnostics
  }

  /** Install the direct (user-configured) server provider used at reconcile time. */
  /** 注入 direct LSP 读取器，使用户配置与套件挂载共享对账流程。 */
  setDirectProvider(provider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>>): void {
    this.directProvider = provider
  }
  /** 注入禁用状态读取器，供下次对账跳过用户明确关闭的服务。 */
  setDisabledProvider(provider: () => Promise<Set<string>>): void {
    this.disabledProvider = provider
  }
  /** 返回当前禁用服务快照，供状态聚合层区分 disabled。 */
  disabledServers(): Set<string> {
    return new Set(this.disabledSnapshot)
  }

  /** The latest mount diagnostic per suite, for the LSP status surface. */
  /** 返回诊断副本，避免状态读取修改注册表内部状态。 */
  diagnosticsSnapshot(): Map<string, LspMountDiagnostic> {
    return new Map(this.lastDiagnostics)
  }

  /** Whether at least one suite mount is live. */
  /** 判断是否至少存在一个成功挂载的 LSP 实例。 */
  hasLiveMounts(): boolean {
    return this.live.size > 0
  }

  /** Mount one suite's full server table as a single `dsh-lsp-stdio` instance. */
  /** 挂载单个限定套件的全部 LSP 服务，并在宿主冲突时整体回滚。 */
  private async mountWith(key: string, suite: Suite, servers: Record<string, LspStdioServerConfig>): Promise<LspMountDiagnostic | undefined> {
    const hostKeys = Object.keys(servers).join(',')
    const module = await this.loadHost()
    if (module === undefined) {
      return { suiteId: key, serverKey: hostKeys, reason: HOST_MISSING_REASON, code: 'host-missing' }
    }
    const plugin = module.default ?? module
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') {
      return { suiteId: key, serverKey: hostKeys, reason: 'the host context does not support dynamic plugin mounting', code: 'host-missing' }
    }
    let handle: MountPluginHandle | undefined
    try {
      handle = mountCtx.plugin(plugin, { servers })
      await handle.await()
    } catch (error) {
      // A failed startup can leave a half-mounted handle behind; drop it so
      // no orphan child process survives, then report the real signal.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {
          // Ignore teardown errors: the startup failure is the real signal.
          // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      const conflict = /already handled by another LSP provider|already registered/.test(message)
      return {
        suiteId: key,
        serverKey: hostKeys,
        reason: `mount failed: ${message}`,
        code: conflict ? 'seam-conflict' : 'mount-failed'
      }
    }
    this.live.set(key, { fingerprint: JSON.stringify(servers), suiteId: key, serverKeys: Object.keys(servers), disposer: () => handle.dispose() })
    return undefined
  }

  /** 释放单个套件 LSP 插件，返回可展示的释放错误。 */
  private async unmount(key: string, live: LiveMount): Promise<string | undefined> {
    try {
      await live.disposer()
      this.live.delete(key)
      return undefined
    } catch (error) {
      const reason = `unmount failed: ${error instanceof Error ? error.message : String(error)}`
      this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${reason} (${live.suiteId})`)
      return reason
    }
  }

  /**
   * Schedule a delayed re-attempt for a mount that still is not live. A
   * `host-missing` failure passes no diagnostic and is never retried; the
   * schedule is bounded and resets with every reconcile pass.
   */
  /** 按固定退避安排下一次对账；宿主缺失等确定性错误不进入重试。 */
  private scheduleRetry(key: string, failure: LspMountDiagnostic | undefined): void {
    const pending = this.retries.get(key)
    if (pending !== undefined) clearTimeout(pending)
    this.retries.delete(key)
    if (failure === undefined || failure.code === 'host-missing') {
      this.attempts.delete(key)
      return
    }
    const attempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attempt)
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.ctx.logger?.warn?.(`[dsh-agent-plugins-market] ${failure.suiteId}: giving up after ${MAX_RETRY_ATTEMPTS} attempts — ${failure.reason}`)
      return
    }
    const delay = RETRY_SCHEDULE_MS[attempt - 1] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!
    const timer = setTimeout(() => {
      this.retries.delete(key)
      // Re-run against the last known suite set: a retry must not resurrect
      // servers of a suite that has since been disabled or uninstalled.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      void this.reconcile(this.lastEnabled).catch(() => {})
    }, delay)
    timer.unref?.()
    this.retries.set(key, timer)
  }

  /** Dispose every live mount after queued reconciliation passes settle. */
  /** 取消重试并释放所有 LSP 挂载，供运行时整体销毁。 */
  async disposeAll(): Promise<void> {
    const run = this.reconcileQueue.then(async () => {
      for (const [key, live] of [...this.live]) {
        await this.unmount(key, live)
      }
    })
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    await run
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    this.attempts.clear()
  }
}

const HOST_MISSING_REASON =
  'the @deepseek-ai/dsh-lsp-stdio package is not installed in this profile; upgrade to a DSH build carrying the LSP packages (@deepseek-ai/dsh-lsp, dsh-lsp-stdio, dsh-tool-lsp) and mount tool-lsp in the profile to expose the `lsp` tool'
