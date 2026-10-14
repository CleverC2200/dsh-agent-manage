/** 文件作用：对账套件 MCP 挂载，维护后端切换、重试、冲突和工具所有权。 */
/**
 * Runtime MCP mounts: one live self-built bridge child plugin per enabled
 * suite's mcp.json server, mounted through `ctx.plugin`.
 *
 * Mounts reconcile against the enabled-suite set: reconcile() unmounts rows
 * whose suite was disabled or removed and mounts rows that appeared. A
 * duplicate derived serverName or a load failure is contained per server — a
 * broken third-party suite must not take the host down — and reported through
 * the manager's diagnostic list.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import * as mcpBridge from './mcp-client/bridge.js'
import type { McpBackend } from './mcp-backend.js'
import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import { credentialRefsInServer, deriveServerName, toMcpMounts, type McpMountFailureCode, type McpMountRequest } from './mcp-config.js'
import { mcpCredentialResolver } from './mcp-credentials.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'

export interface McpMountDiagnostic {
  suiteId: string
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  credentialRefs?: string[]
}

interface LiveMount {
  suiteId: string
  serverKey: string
  serverName: string
  /** Fingerprint of the request config this mount was built from. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  configFingerprint: string
  disposer: () => void | Promise<void>
}

/**
 * Bounded retry schedule for a failed mount/unmount. A crash-looping or
 * permanently broken server must eventually stop consuming attempt budget, so
 * the schedule is capped and resets with every reconcile pass.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

interface MountPluginHandle {
  /** 中文：等待 MCP 子插件完成初始化。 */
  await(): Promise<unknown>
  /** 中文：释放单个 MCP 子插件挂载及其工具注册。 */
  dispose(): void | Promise<void>
}

/** Structural `ctx.plugin` surface for mounting one plugin instance. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

export class McpMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  private readonly names = new Map<string, string>()
  private readonly credentialRefs = new Set<string>()
  private overridesProvider: () => Promise<Map<string, McpSuiteOverrides>> = async () => new Map()
  /** Live model-facing tool names, for foreign-namespace detection before a mount. */
  /** 中文：保存宿主当前工具名，用于挂载前识别外部占用的命名空间。 */
  private toolNamesProvider: () => string[] = () => []
  /** The active MCP mount backend ('builtin' bridge or host client compat mode). */
  /** 中文：记录当前 builtin/host 后端，后端切换会促使服务重挂载。 */
  private backendProvider: () => Promise<McpBackend> = async () => 'builtin'
  /** Serialize mount and unmount passes so a disable cannot race an in-flight spawn. */
  /** 中文：串行化增删，避免禁用操作与正在启动的子进程竞态。 */
  private reconcileQueue: Promise<void> = Promise.resolve()
  /** Pending retry timers keyed by mount key, so a teardown can cancel them. */
  /** 中文：按挂载键保存待定定时器，释放时可准确取消。 */
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  /** Attempt count per mount key; reset whenever a retry succeeds. */
  /** 中文：记录每个服务的连续失败次数，成功或显式不重试时清零。 */
  private readonly attempts = new Map<string, number>()
  /**
   * Mount keys flagged for an explicit rebuild (re-authorize): the next
   * reconcile must tear down and remount them even when the resolved config
   * fingerprint is unchanged — dropping a grant changes no config field.
   */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  private readonly forcedRemounts = new Set<string>()
  /** Snapshot of the last reconciled suite set, replayed by retry passes. */
  /** 中文：重试只重放最近快照，避免恢复已卸载或已禁用的服务。 */
  private lastEnabled: Suite[] = []

  /** 绑定宿主上下文、数据根和翻译器，初始化 MCP 对账状态。 */
  constructor(
    private readonly ctx: Context,
    private readonly pluginDataRoot: string,
    private readonly namespace?: string
  ) {}

  /** Install the per-suite overrides provider (suiteId -> overrides). */
  /** 注入覆盖配置读取器，使编辑后的服务能在下一次对账生效。 */
  setOverridesProvider(provider: () => Promise<Map<string, McpSuiteOverrides>>): void {
    this.overridesProvider = provider
  }

  /**
   * Install the live model-facing tool-name provider (the host registry
   * snapshot) used to detect foreign `mcp__<serverName>__` namespaces before
   * a mount is attempted.
   */
  /** 注入宿主工具观察器，用于检测外部占用和状态展示。 */
  setToolNamesProvider(provider: () => string[]): void {
    this.toolNamesProvider = provider
  }

  /** Install the backend provider deciding which client mounts each server. */
  /** 注入后端选择器，支持 builtin/host 切换触发重挂载。 */
  setBackendProvider(provider: () => Promise<McpBackend>): void {
    this.backendProvider = provider
  }

  /** Whether the last catalog snapshot uses one credential reference. */
  /** 判断当前活动配置是否引用某凭据，供凭据变更精确触发刷新。 */
  usesCredential(ref: string): boolean {
    return this.credentialRefs.has(ref)
  }

  /**
   * Flag one mount for an explicit rebuild on the next reconcile: used by
   * re-authorize, which deletes a grant without changing any resolved config
   * field, so a fingerprint-only reconcile would keep the live bridge (and
   * its in-memory tokens) untouched.
   */
  /** 标记单个服务需重挂载，下一次对账会绕过指纹短路。 */
  forceRemount(suiteId: string, serverKey: string): void {
    this.forcedRemounts.add(mountKey(suiteId, serverKey))
  }

  /** The mount key owning one derived serverName; undefined when not mounted here. */
  /** 根据公开 serverName 反查套件和服务键，供工具路由和诊断使用。 */
  serverOwner(serverName: string): { suiteId: string; serverKey: string } | undefined {
    const owner = this.names.get(serverName)
    if (owner === undefined) return undefined
    // Values are `${suiteId}\u0000${serverKey}` — suite ids may contain a
    // slash (qualified ids), so the separator is the NUL byte, not '/'.
    // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
    const separator = owner.indexOf('\u0000')
    return { suiteId: owner.slice(0, separator), serverKey: owner.slice(separator + 1) }
  }

  /** Queue one reconciliation behind any in-flight mount/unmount pass. */
  /** 串行执行 MCP 对账，容纳上一轮失败后继续处理新的快照。 */
  async reconcile(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** Mount/unmount MCP servers to match the enabled suites exactly. */
  /** 计算期望请求、处理后端和覆盖配置，再增删 MCP 挂载并收集诊断。 */
  private async reconcileNow(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    this.lastEnabled = [...enabledSuites]
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.mcp !== false)
    const overrides = await this.overridesProvider()
    const backend = await this.backendProvider()
    const resolver = mcpCredentialResolver(this.ctx)
    const wanted = new Map<string, { suite: Suite; serverKey: string; request: McpMountRequest }>()
    const diagnostics: McpMountDiagnostic[] = []
    this.credentialRefs.clear()
    for (const suite of active) {
      const suiteOverrides = overrides.get(qualifiedSuiteId(suite.sourceId, suite.id))
      for (const [serverKey, source] of Object.entries(suite.mcp?.servers ?? {})) {
        const override = suiteOverrides?.[serverKey]
        if (override?.enabled === false) continue
        const effective = applyOverride(source as McpServerStdio | McpServerStreamableHttp, override)
        for (const ref of credentialRefsInServer(effective)) this.credentialRefs.add(ref)
      }
      const { mounts, failures } = await toMcpMounts(suite, this.pluginDataRoot, suiteOverrides, resolver)
      for (const failure of failures) {
        diagnostics.push({
          suiteId: qualifiedSuiteId(suite.sourceId, suite.id),
          serverKey: failure.serverKey,
          reason: failure.reason,
          ...(failure.code === undefined ? {} : { code: failure.code }),
          ...(failure.credentialRefs === undefined ? {} : { credentialRefs: failure.credentialRefs })
        })
      }
      for (const mount of mounts) {
        // Bridge namespaces are reserved app-wide, even when tools are agent-scoped.
        // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
        if (this.namespace !== undefined) mount.config.serverName = deriveServerName(mount.config.serverName, this.namespace)
        wanted.set(mountKey(mount.suiteId, mount.serverKey), { suite, serverKey: mount.serverKey, request: mount })
      }
    }
    for (const [key, live] of [...this.live]) {
      if (!wanted.has(key)) {
        const reason = await this.unmount(key, live)
        diagnostics.push({
          suiteId: live.suiteId,
          serverKey: live.serverKey,
          reason: reason ?? 'unmounted',
          ...(reason === undefined ? {} : { code: 'unmount-failed' as const })
        })
      }
    }
    for (const [key, entry] of wanted) {
      const live = this.live.get(key)
      // A forced remount (re-authorize) skips the fingerprint match on
      // purpose: dropping a grant does not change the resolved config, so
      // only the explicit instruction tears the live bridge down and lets
      // the server's 401 restart the browser authorization.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      if (live !== undefined && !this.forcedRemounts.has(key) && live.configFingerprint === fingerprintOf(entry.request, backend)) continue
      // Either a fresh mount, or a remount because the resolved config moved
      // (a credential rotation rewrites the env/header/url values while the
      // suite stays enabled) — keeping the old mount would keep serving the
      // old token until disable or restart.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      if (live !== undefined) {
        const reason = await this.unmount(key, live)
        if (reason !== undefined) {
          diagnostics.push({ suiteId: live.suiteId, serverKey: live.serverKey, reason, code: 'unmount-failed' })
          continue
        }
      }
      this.forcedRemounts.delete(key)
      // A retry attempt runs the same mount path; only the last failure is
      // reported so a transient error does not shadow the final state.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      const failure = await this.mountWith(entry.request, backend)
      if (failure !== undefined) {
        diagnostics.push({ suiteId: qualifiedSuiteId(entry.suite.sourceId, entry.suite.id), serverKey: entry.serverKey, reason: failure.reason, code: failure.code })
        // Foreign and duplicate skips are deterministic, not transient:
        // retrying them just burns the attempt budget and log lines. The
        // next full reconcile re-checks them anyway, so the self-heal path
        // is intact.
        // 中文：外部占用和重复声明是确定性失败，不消耗重试预算；下一轮完整对账仍会重新确认。
        const informational = failure.code === 'foreign-mount' || failure.code === 'duplicate-mount'
        this.scheduleRetry(key, entry.suite.id, entry.serverKey, informational ? undefined : failure.reason)
      }
    }
    return diagnostics.filter(diagnostic => diagnostic.reason !== 'unmounted')
  }

  /**
   * Schedule a delayed re-attempt for a mount that still is not live.
   *
   * Mounts are retried because a remote endpoint or a credential may become
   * available slightly after the suite is enabled. The schedule is bounded, and
   * a server that keeps failing simply stops retrying until the next reconcile.
   */
  /** 为可恢复失败安排有界退避重试，确定性配置错误不无限重试。 */
  private scheduleRetry(key: string, suiteId: string, serverKey: string, reason: string | undefined): void {
    const pending = this.retries.get(key)
    if (pending !== undefined) clearTimeout(pending)
    this.retries.delete(key)
    if (reason === undefined) {
      this.attempts.delete(key)
      return
    }
    const attempt = (this.attempts.get(key) ?? 0) + 1
    this.attempts.set(key, attempt)
    if (attempt > MAX_RETRY_ATTEMPTS) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] ${suiteId}/${serverKey}: giving up after ${MAX_RETRY_ATTEMPTS} attempts — ${reason}`)
      return
    }
    const delay = RETRY_SCHEDULE_MS[attempt - 1] ?? RETRY_SCHEDULE_MS[RETRY_SCHEDULE_MS.length - 1]!
    const timer = setTimeout(() => {
      this.retries.delete(key)
      // Re-run against the last known suite set: a retry must not resurrect a
      // server that has since been disabled or uninstalled.
      // 中文：重试基于最近快照，不能复活期间已禁用或卸载的服务。
      void this.reconcile(this.lastEnabled).catch(() => {})
    }, delay)
    timer.unref?.()
    this.retries.set(key, timer)
  }

  /** Dispose every live mount after queued reconciliation passes settle. */
  /** 取消待定重试并释放所有 MCP 客户端插件。 */
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
    this.credentialRefs.clear()
  }

  /** Mount one precomputed request (source config merged with overrides). */
  /** 挂载单个 MCP 请求，后端不可用或工具命名冲突时返回结构化失败。 */
  private async mountWith(request: McpMountRequest, backend: McpBackend): Promise<{ reason: string; code: McpMountFailureCode } | undefined> {
    const owner = this.names.get(request.config.serverName)
    if (owner !== undefined) {
      // Two sources shipping the same suite/server pair derive one serverName:
      // the model only needs one copy, so later arrivals skip with an
      // informational diagnostic instead of double-registering.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      return {
        reason: `server "${request.config.serverName}" is already mounted from ${owner} — this suite's copy is redundant and was skipped`,
        code: 'duplicate-mount'
      }
    }
    // Foreign-namespace guard: a native host MCP client (or another plugin's
    // mount) may already own this `mcp__<serverName>__` namespace. Registering
    // into it would fail loudly mid-mount; skipping here reports the conflict
    // as a clear per-server diagnostic instead, and a later reconcile mounts
    // this server if the foreign owner goes away. The matching names ride the
    // diagnostic — a leftover of this plugin's own earlier mount (registry
    // record lost without a teardown) reads as an orphan here, and a Host
    // restart clears it; a genuinely foreign owner keeps the skip sticky.
    // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
    const prefix = `mcp__${request.config.serverName}__`
    const foreign = this.toolNamesProvider().filter(name => name.startsWith(prefix))
    if (foreign.length > 0) {
      return {
        reason: `serverName "${request.config.serverName}" is already mounted by another MCP client (native config or another plugin; matching tools: ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? `, +${foreign.length - 3} more` : ''}) — skipped to avoid a duplicate mount; restart the Host if these tools are a leftover`,
        code: 'foreign-mount'
      }
    }
    // Backend dispatch: the built-in bridge connects stdio, Streamable HTTP
    // (with OAuth), and legacy SSE servers in-process; the host backend
    // mounts the host's own `dsh-mcp-client` for compatibility, at the cost
    // of OAuth and SSE support.
    // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') {
      return { reason: 'the host context does not support dynamic plugin mounting', code: 'mount-failed' }
    }
    let pluginModule: unknown = mcpBridge
    if (backend === 'host') {
      if (request.config.enabledTools !== undefined || request.config.disabledTools !== undefined || request.config.startupTimeoutMs !== undefined) {
        return { reason: 'native MCP tool filters and startup timeouts require the built-in backend; host compatibility mode cannot enforce them', code: 'mount-failed' }
      }
      if (request.config.transport === 'sse') {
        return {
          reason: 'the host dsh-mcp-client does not support the legacy SSE transport — switch the MCP backend back to the built-in client for this server',
          code: 'mount-failed'
        }
      }
      try {
        pluginModule = await import('@deepseek-ai/dsh-mcp-client')
      } catch {
        return {
          reason: 'the @deepseek-ai/dsh-mcp-client package is not installed in this profile — switch the MCP backend back to the built-in client',
          code: 'mount-failed'
        }
      }
    }
    let handle: MountPluginHandle | undefined
    try {
      handle = mountCtx.plugin(pluginModule, request.config)
      await handle.await()
    } catch (error) {
      // The bridge mounts with failOnStartupError for suite servers, so a
      // connection or initialization failure rejects here. Drop the
      // half-mounted handle before reporting so no orphan child survives a
      // failed startup.
      // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {
          // Ignore teardown errors: the startup failure is the real signal.
          // 中文：这里补充该实现约束对运行时业务流程的影响，避免误改边界行为。
        }
      }
      return { reason: `mount failed: ${error instanceof Error ? error.message : String(error)}`, code: 'mount-failed' }
    }
    this.live.set(mountKey(request.suiteId, request.serverKey), {
      suiteId: request.suiteId,
      serverKey: request.serverKey,
      serverName: request.config.serverName,
      configFingerprint: fingerprintOf(request, backend),
      disposer: () => handle.dispose()
    })
    this.names.set(request.config.serverName, `${request.suiteId}\u0000${request.serverKey}`)
    return undefined
  }

  /** 释放单个 MCP 挂载并清理所有权索引，返回释放错误供诊断。 */
  private async unmount(key: string, live: LiveMount): Promise<string | undefined> {
    try {
      await live.disposer()
      this.live.delete(key)
      this.names.delete(live.serverName)
      return undefined
    } catch (error) {
      const reason = `unmount failed: ${error instanceof Error ? error.message : String(error)}`
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] ${reason} (${live.suiteId}/${live.serverKey})`)
      return reason
    }
  }
}

/** 生成套件限定服务键，保证不同来源同名服务互不覆盖。 */
function mountKey(suiteId: string, serverKey: string): string {
  return `${suiteId}\u0000${serverKey}`
}

/**
 * Stable fingerprint of one resolved mount request: any change to the
 * backend, transport, url, headers, env, args, or auth shape produces a different
 * fingerprint and forces a remount on the next reconcile pass.
 */
/** 生成挂载请求指纹，避免配置未变时重复断开重连。 */
function fingerprintOf(request: McpMountRequest, backend: McpBackend): string {
  return createHash('sha256')
    .update(JSON.stringify({ backend, config: request.config }))
    .digest('hex')
}
