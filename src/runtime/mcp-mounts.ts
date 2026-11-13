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

  configFingerprint: string
  disposer: () => void | Promise<void>
}

const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

interface MountPluginHandle {
  await(): Promise<unknown>

  dispose(): void | Promise<void>
}

interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

export class McpMountRegistry {
  private readonly live = new Map<string, LiveMount>()
  private readonly names = new Map<string, string>()
  private readonly credentialRefs = new Set<string>()
  private overridesProvider: () => Promise<Map<string, McpSuiteOverrides>> = async () => new Map()

  private toolNamesProvider: () => string[] = () => []

  private backendProvider: () => Promise<McpBackend> = async () => 'builtin'

  private reconcileQueue: Promise<void> = Promise.resolve()

  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()

  private readonly attempts = new Map<string, number>()

  private readonly forcedRemounts = new Set<string>()

  private lastEnabled: Suite[] = []

  constructor(
    private readonly ctx: Context,
    private readonly pluginDataRoot: string,
    private readonly namespace?: string
  ) {}

  setOverridesProvider(provider: () => Promise<Map<string, McpSuiteOverrides>>): void {
    this.overridesProvider = provider
  }

  setToolNamesProvider(provider: () => string[]): void {
    this.toolNamesProvider = provider
  }

  setBackendProvider(provider: () => Promise<McpBackend>): void {
    this.backendProvider = provider
  }

  usesCredential(ref: string): boolean {
    return this.credentialRefs.has(ref)
  }

  forceRemount(suiteId: string, serverKey: string): void {
    this.forcedRemounts.add(mountKey(suiteId, serverKey))
  }

  serverOwner(serverName: string): { suiteId: string; serverKey: string } | undefined {
    const owner = this.names.get(serverName)
    if (owner === undefined) return undefined

    const separator = owner.indexOf('\u0000')
    return { suiteId: owner.slice(0, separator), serverKey: owner.slice(separator + 1) }
  }

  async reconcile(enabledSuites: Suite[]): Promise<McpMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

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

      if (live !== undefined && !this.forcedRemounts.has(key) && live.configFingerprint === fingerprintOf(entry.request, backend)) continue

      if (live !== undefined) {
        const reason = await this.unmount(key, live)
        if (reason !== undefined) {
          diagnostics.push({ suiteId: live.suiteId, serverKey: live.serverKey, reason, code: 'unmount-failed' })
          continue
        }
      }
      this.forcedRemounts.delete(key)

      const failure = await this.mountWith(entry.request, backend)
      if (failure !== undefined) {
        diagnostics.push({ suiteId: qualifiedSuiteId(entry.suite.sourceId, entry.suite.id), serverKey: entry.serverKey, reason: failure.reason, code: failure.code })

        const informational = failure.code === 'foreign-mount' || failure.code === 'duplicate-mount'
        this.scheduleRetry(key, entry.suite.id, entry.serverKey, informational ? undefined : failure.reason)
      }
    }
    return diagnostics.filter(diagnostic => diagnostic.reason !== 'unmounted')
  }

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

      void this.reconcile(this.lastEnabled).catch(() => {})
    }, delay)
    timer.unref?.()
    this.retries.set(key, timer)
  }

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

  private async mountWith(request: McpMountRequest, backend: McpBackend): Promise<{ reason: string; code: McpMountFailureCode } | undefined> {
    const owner = this.names.get(request.config.serverName)
    if (owner !== undefined) {
      return {
        reason: `server "${request.config.serverName}" is already mounted from ${owner} — this suite's copy is redundant and was skipped`,
        code: 'duplicate-mount'
      }
    }

    const prefix = `mcp__${request.config.serverName}__`
    const foreign = this.toolNamesProvider().filter(name => name.startsWith(prefix))
    if (foreign.length > 0) {
      return {
        reason: `serverName "${request.config.serverName}" is already mounted by another MCP client (native config or another plugin; matching tools: ${foreign.slice(0, 3).join(', ')}${foreign.length > 3 ? `, +${foreign.length - 3} more` : ''}) — skipped to avoid a duplicate mount; restart the Host if these tools are a leftover`,
        code: 'foreign-mount'
      }
    }

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
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {}
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

function mountKey(suiteId: string, serverKey: string): string {
  return `${suiteId}\u0000${serverKey}`
}

function fingerprintOf(request: McpMountRequest, backend: McpBackend): string {
  return createHash('sha256')
    .update(JSON.stringify({ backend, config: request.config }))
    .digest('hex')
}
