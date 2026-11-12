import type { Context } from '@deepseek-ai/cordis'
import { CommandMountRegistry, type CommandMountDiagnostic } from './commands-mounts.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from './hooks-mounts.js'
import { LspMountRegistry, type LspMountDiagnostic } from './lsp-mounts.js'
import { McpMountRegistry, type McpMountDiagnostic } from './mcp-mounts.js'
import type { Suite } from '../model/types.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

export interface RuntimeDiagnostics {
  mcp: McpMountDiagnostic[]
  commands: CommandMountDiagnostic[]
  hooks: HooksMountDiagnostic[]
  lsp: LspMountDiagnostic[]
  errors: Array<{ surface: 'mcp' | 'commands' | 'hooks' | 'lsp'; reason: string }>
}

export class RuntimeReconciler {
  readonly mcp: McpMountRegistry
  private readonly commands: CommandMountRegistry
  private readonly hooks: HooksMountRegistry
  readonly lsp: LspMountRegistry
  private readonly queues = new Map<keyof Omit<RuntimeDiagnostics, 'errors'>, Promise<void>>()
  private disposed = false

  constructor(ctx: Context, dataRoot: string, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = new McpMountRegistry(ctx, dataRoot)
    this.commands = new CommandMountRegistry(ctx, t)
    this.hooks = new HooksMountRegistry(ctx)
    this.lsp = new LspMountRegistry(ctx)
  }

  async reconcile(enabledSuites: readonly Suite[]): Promise<RuntimeDiagnostics> {
    const suites = [...enabledSuites]
    const diagnostics: RuntimeDiagnostics = { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
    if (this.disposed) return diagnostics

    const reconcileSurface = <K extends keyof Omit<RuntimeDiagnostics, 'errors'>>(surface: K, reconcile: () => Promise<RuntimeDiagnostics[K]>): Promise<void> => {
      const run = (this.queues.get(surface) ?? Promise.resolve()).then(async () => {
        if (this.disposed) return
        try {
          diagnostics[surface] = await reconcile()
        } catch (error) {
          diagnostics.errors.push({ surface, reason: messageOf(error) })
        }
      })
      this.queues.set(surface, run)
      return run
    }

    await Promise.all([
      reconcileSurface('mcp', () => this.mcp.reconcile(suites)),
      reconcileSurface('commands', () => this.commands.reconcile(suites)),
      reconcileSurface('hooks', () => this.hooks.reconcile(suites)),
      reconcileSurface('lsp', () => this.lsp.reconcile(suites))
    ])
    return diagnostics
  }

  async dispose(): Promise<void> {
    this.disposed = true

    const disposeSurface = async (surface: keyof Omit<RuntimeDiagnostics, 'errors'>, dispose: () => void | Promise<void>): Promise<void> => {
      await this.queues.get(surface)
      await dispose()
    }
    await Promise.all([
      disposeSurface('mcp', () => this.mcp.disposeAll()),
      disposeSurface('commands', () => this.commands.disposeAll()),
      disposeSurface('hooks', () => this.hooks.disposeAll()),
      disposeSurface('lsp', () => this.lsp.disposeAll())
    ])
    this.queues.clear()
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
