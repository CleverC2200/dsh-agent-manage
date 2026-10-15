/** 文件作用：把套件 hooks 配置挂载到宿主生命周期，并隔离单套件失败。 */
/**
 * Claude Code hook compatibility: each enabled suite's `hooks/hooks.json`
 * mounts one live `dsh-hooks-claude-code` bridge on the harness's canonical
 * interception points (SessionStart, UserPromptSubmit, PreToolUse,
 * PostToolUse, Stop, SubagentStart, SubagentStop).
 *
 * The bridge is a cordis function plugin (`inject: ['shell']`) whose config
 * is a single `configPath` plus `pluginRoot` for `${CLAUDE_PLUGIN_ROOT}`
 * substitution — exactly the shape a suite hook file needs. Mounts reconcile
 * on every enable/disable/install/uninstall; a missing bridge package, a
 * broken hook file, or a mount failure is contained per suite.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type * as HooksBridge from '@deepseek-ai/dsh-hooks-claude-code'
import { qualifiedSuiteId } from '../catalog/paths.js'
import type { Suite } from '../model/types.js'

export interface HooksMountDiagnostic {
  suiteId: string
  reason: string
}

interface MountHandle {
  /** 中文：等待 hooks 子插件初始化完成。 */
  await(): Promise<unknown>
  /** 中文：释放单个 hooks 子插件挂载。 */
  dispose(): void | Promise<void>
}

interface PluginMountContext {
  /** 中文：按配置创建宿主插件挂载并返回生命周期句柄。 */
  plugin(plugin: unknown, config: unknown): MountHandle
}

export class HooksMountRegistry {
  private readonly live = new Map<string, MountHandle>()
  private readonly fingerprints = new Map<string, string>()
  private readonly temporary = new Map<string, string>()
  private queue: Promise<void> = Promise.resolve()

  /** 绑定 Cordis 上下文，所有 hooks 插件都在该作用域创建和释放。 */
  constructor(private readonly ctx: Context) {}

  /** Mount/unmount one bridge per suite to match the enabled suites exactly. */
  /** 串行对账 hooks 挂载，避免并发变更破坏宿主拦截链。 */
  async reconcile(enabledSuites: Suite[]): Promise<HooksMountDiagnostic[]> {
    const run = this.queue.then(() => this.reconcileNow(enabledSuites))
    this.queue = run.then(
      () => {},
      () => {}
    )
    return run
  }

  /** 在队列内执行实际增删，逐套件隔离文件和插件错误。 */
  private async reconcileNow(enabledSuites: Suite[]): Promise<HooksMountDiagnostic[]> {
    const diagnostics: HooksMountDiagnostic[] = []
    const active = enabledSuites.filter(suite => suite.activeSurfaces?.hooks !== false && (suite.resources === undefined || suite.hooks !== undefined))
    // Keys are the qualified suite id: bare ids are unique per source only.
    const wanted = new Set(active.map(suite => qualifiedSuiteId(suite.sourceId, suite.id)))
    for (const [suiteId, handle] of [...this.live]) {
      if (!wanted.has(suiteId)) {
        await this.unmount(suiteId, handle)
      }
    }
    for (const suite of active) {
      const key = qualifiedSuiteId(suite.sourceId, suite.id)
      const originalPath = suite.hooks === undefined ? await hookConfigPath(suite.root) : undefined
      const content =
        suite.hooks === undefined
          ? originalPath === undefined
            ? undefined
            : await readFile(originalPath, 'utf8').catch(() => undefined)
          : JSON.stringify({ hooks: suite.hooks.events })
      const fingerprint =
        content === undefined
          ? undefined
          : createHash('sha256')
              .update(JSON.stringify([content, suite.root, suite.hooks?.projectRoot]))
              .digest('hex')
      const previous = this.live.get(key)
      if (previous !== undefined && fingerprint === this.fingerprints.get(key)) continue
      if (previous !== undefined) await this.unmount(key, previous)
      if (content === undefined || fingerprint === undefined) continue
      const reason = await this.mount(key, suite, content, fingerprint, originalPath)
      if (reason !== undefined) diagnostics.push({ suiteId: key, reason })
    }
    return diagnostics
  }

  /** Dispose every live bridge; used at plugin teardown. */
  /** 串行释放全部 hooks 挂载并清理临时配置文件。 */
  async disposeAll(): Promise<void> {
    const run = this.queue.then(async () => {
      for (const [suiteId, handle] of [...this.live]) await this.unmount(suiteId, handle)
    })
    this.queue = run.catch(() => {})
    await run
  }

  /** 为单套件写入临时 hook 配置并挂载桥接插件，返回失败原因或 undefined。 */
  private async mount(key: string, suite: Suite, content: string, fingerprint: string, originalPath?: string): Promise<string | undefined> {
    let bridge: typeof HooksBridge | undefined
    try {
      bridge = await import('@deepseek-ai/dsh-hooks-claude-code')
    } catch {
      return 'the @deepseek-ai/dsh-hooks-claude-code package is not installed in this profile'
    }
    const mountCtx = this.ctx as unknown as PluginMountContext
    if (typeof mountCtx.plugin !== 'function') return 'the host context does not support dynamic plugin mounting'
    let temporary: string | undefined
    let handle: MountHandle | undefined
    try {
      let configPath = originalPath
      if (configPath === undefined) {
        temporary = await mkdtemp(join(tmpdir(), 'dsh-project-hooks-'))
        configPath = join(temporary, 'hooks.json')
        await writeFile(configPath, content, { mode: 0o600 })
      }
      handle = mountCtx.plugin(bridge, {
        configPath,
        pluginRoot: suite.root,
        ...(suite.hooks === undefined ? {} : { projectDir: suite.hooks.projectRoot })
      })
      await handle.await()
      this.live.set(key, handle)
      this.fingerprints.set(key, fingerprint)
      if (temporary !== undefined) this.temporary.set(key, temporary)
      return undefined
    } catch (error) {
      try {
        await handle?.dispose()
      } catch {
        /* Preserve the startup failure. */
      }
      if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
      return `mount failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  /** 释放单套件 hook 插件并删除临时文件，失败向上转成诊断。 */
  private async unmount(suiteId: string, handle: MountHandle): Promise<void> {
    this.live.delete(suiteId)
    this.fingerprints.delete(suiteId)
    try {
      await handle.dispose()
    } catch (error) {
      this.ctx.logger?.warn(`[dsh-agent-plugins-market] hooks unmount ${suiteId} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      const temporary = this.temporary.get(suiteId)
      this.temporary.delete(suiteId)
      if (temporary !== undefined) await rm(temporary, { recursive: true, force: true })
    }
  }
}

/** The first existing CC hook config of a suite root. */
/** 读取套件 hooks.json 路径；不存在返回 undefined，区分无 hooks 与坏配置。 */
export async function hookConfigPath(root: string): Promise<string | undefined> {
  for (const relative of [join('hooks', 'hooks.json'), 'hooks.json']) {
    const path = join(root, relative)
    try {
      if ((await stat(path)).isFile()) return path
    } catch {
      // try the next candidate
    }
  }
  return undefined
}
