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

const RETRY_SCHEDULE_MS = [1_500, 5_000, 15_000, 45_000, 120_000]
const MAX_RETRY_ATTEMPTS = RETRY_SCHEDULE_MS.length

export interface LspStdioServerConfig {
  command: string
  args: string[]
  extensionToLanguage: Record<string, string>
  env?: Record<string, string>
  initializationOptions?: unknown
  configuration?: unknown
}

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
  await(): Promise<unknown>

  dispose(): void | Promise<void>
}

interface PluginMountContext {
  plugin(plugin: unknown, config: unknown): MountPluginHandle
}

interface LspStdioModule {
  default?: unknown
}

const LSP_STDIO_IMPORT = '@deepseek-ai/dsh-lsp-stdio'

export class LspMountRegistry {
  private readonly live = new Map<string, LiveMount>()

  private reconcileQueue: Promise<void> = Promise.resolve()

  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()

  private readonly attempts = new Map<string, number>()

  private lastEnabled: Suite[] = []

  private loadHost: () => Promise<LspStdioModule | undefined>

  private readonly lastDiagnostics = new Map<string, LspMountDiagnostic>()

  private directProvider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>> = async () => ({})
  private disabledProvider: () => Promise<Set<string>> = async () => new Set()
  private disabledSnapshot = new Set<string>()

  constructor(
    private readonly ctx: Context,
    loadHost?: () => Promise<LspStdioModule | undefined>
  ) {
    this.loadHost =
      loadHost ??
      (async () => {
        try {
          return (await import(LSP_STDIO_IMPORT)) as LspStdioModule
        } catch {
          return undefined
        }
      })
  }

  reconcile(enabledSuites: Suite[]): Promise<LspMountDiagnostic[]> {
    const run = this.reconcileQueue.then(() => this.reconcileNow(enabledSuites))
    this.reconcileQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

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

      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const config: Record<string, LspStdioServerConfig> = {}
      for (const spec of servers) if (!disabled.has(`${key}/${spec.key}`)) config[`${key}/${spec.key}`] = toLspServerConfig(spec)
      if (Object.keys(config).length > 0) wanted.set(key, { suite, config })
    }

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

  setDirectProvider(provider: () => Promise<Record<string, import('../model/types.js').LspServerSpec>>): void {
    this.directProvider = provider
  }

  setDisabledProvider(provider: () => Promise<Set<string>>): void {
    this.disabledProvider = provider
  }

  disabledServers(): Set<string> {
    return new Set(this.disabledSnapshot)
  }

  diagnosticsSnapshot(): Map<string, LspMountDiagnostic> {
    return new Map(this.lastDiagnostics)
  }

  hasLiveMounts(): boolean {
    return this.live.size > 0
  }

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
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch {}
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
  }
}

const HOST_MISSING_REASON =
  'the @deepseek-ai/dsh-lsp-stdio package is not installed in this profile; upgrade to a DSH build carrying the LSP packages (@deepseek-ai/dsh-lsp, dsh-lsp-stdio, dsh-tool-lsp) and mount tool-lsp in the profile to expose the `lsp` tool'
