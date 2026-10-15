/** 文件作用：统一编排命令、hooks、MCP、LSP 四类运行时表面的对账和释放。 */
/**
 * Runtime reconciliation for enabled suites.
 *
 * One catalog snapshot is fanned out to the existing MCP, command, hook, and
 * LSP mount adapters. The adapters remain separate because their host surfaces
 * and failure semantics differ; this module owns ordering, containment, and
 * disposal only.
 */
import type { Context } from '@deepseek-ai/cordis'
import { CommandMountRegistry, type CommandMountDiagnostic } from './commands-mounts.js'
import { HooksMountRegistry, type HooksMountDiagnostic } from './hooks-mounts.js'
import { LspMountRegistry, type LspMountDiagnostic } from './lsp-mounts.js'
import { McpMountRegistry, type McpMountDiagnostic } from './mcp-mounts.js'
import type { Suite } from '../model/types.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

/** Diagnostics returned by one runtime reconciliation pass. */
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

  /** 创建四类运行时表面的协调器，所有表面共享同一宿主上下文和数据根。 */
  constructor(ctx: Context, dataRoot: string, t: HostTranslate = bindHostLocale(undefined)) {
    this.mcp = new McpMountRegistry(ctx, dataRoot)
    this.commands = new CommandMountRegistry(ctx, t)
    this.hooks = new HooksMountRegistry(ctx)
    this.lsp = new LspMountRegistry(ctx)
  }

  /** Reconcile all runtime surfaces against one enabled-suite snapshot. */
  /** 并行触发四类表面对账，按表面隔离异常并返回完整诊断快照。 */
  async reconcile(enabledSuites: readonly Suite[]): Promise<RuntimeDiagnostics> {
    const suites = [...enabledSuites]
    const diagnostics: RuntimeDiagnostics = { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
    if (this.disposed) return diagnostics
    /** 串行排队同一运行时表面的对账，并将失败转换为该表面诊断。 */
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
    // Network-backed MCP startup must not delay local commands, hooks or LSP.
    // Each surface retains its own order when catalog mutations overlap.
    // 中文：网络 MCP 启动不能阻塞本地表面；各表面独立排队但保持自身顺序。
    await Promise.all([
      reconcileSurface('mcp', () => this.mcp.reconcile(suites)),
      reconcileSurface('commands', () => this.commands.reconcile(suites)),
      reconcileSurface('hooks', () => this.hooks.reconcile(suites)),
      reconcileSurface('lsp', () => this.lsp.reconcile(suites))
    ])
    return diagnostics
  }

  /** Dispose all live mounts and registrations. */
  /** 并行释放四类表面；单表面失败记录为错误而不阻塞其他释放。 */
  async dispose(): Promise<void> {
    this.disposed = true
    /** 等待该表面已有对账完成后释放挂载，避免销毁与注册交换交叉。 */
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

/** 将未知异常规范化为可展示文本，避免诊断层依赖具体错误类型。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
