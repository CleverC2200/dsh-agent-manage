/** 文件作用：把项目级命令、MCP、hooks 和说明挂载到现有及新建 Agent。 */
/** Native project effects are owned by the receiving agent's scoped host context. */
import type { Context } from '@deepseek-ai/cordis'
import type { Catalog } from '../application/catalog.js'
import { CommandMountRegistry } from './commands-mounts.js'
import type { HostTranslate } from './host-locale.js'
import { McpMountRegistry } from './mcp-mounts.js'
import { HooksMountRegistry } from './hooks-mounts.js'
import type { Suite } from '../model/types.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'

interface ProjectAgent {
  ctx: Context
  session: { id?: string; header: { cwd?: string } }
}

interface AgentMount {
  fiber: ReturnType<Context['inject']>
  /** 中文：刷新项目级表面挂载，使新建 Agent 继承当前配置。 */
  refresh(): Promise<void>
}

/** Mount under existing and newly created agents; the caller owns refresh and teardown. */
/** 将项目命令注册到现有/新建 Agent，并返回刷新与释放控制器。 */
export function mountProjectCommands(ctx: Context, catalog: Catalog, t: HostTranslate): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, 'commands', scope => new CommandMountRegistry(scope, t))
}

/** MCP uses a separate injected child so network startup cannot delay local commands. */
/** 将项目 MCP 注册到 Agent 作用域，配置来源由 catalog 和 dataRoot 决定。 */
export function mountProjectMcp(ctx: Context, catalog: Catalog, dataRoot: string): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, 'tools', (scope, agent) => {
    const registry = new McpMountRegistry(scope, dataRoot, agent.session.id ?? randomUUID())
    registry.setBackendProvider(() => catalog.runtime.mcpBackend())
    return registry
  })
}

/** Wait for both bridge dependencies before attempting a scoped hook mount. */
/** 将项目 hooks 注册到 Agent 作用域，生命周期由返回控制器管理。 */
export function mountProjectHooks(ctx: Context, catalog: Catalog): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(ctx, catalog, ['shell', 'sessionProjections'], scope => new HooksMountRegistry(scope))
}

/** Kimi's startup skill and system-prompt declarations use the existing scoped prompt service. */
/** 将套件说明注入 Agent 会话前置上下文，并随目录快照刷新。 */
export function mountSuiteInstructions(ctx: Context, catalog: Catalog): { refresh(): Promise<void>; dispose(): Promise<void> } {
  return mountProjectSurface(
    ctx,
    catalog,
    'systemPrompt',
    scope => {
      let text = ''
      const host = scope as unknown as { systemPrompt: { section(value: { name: string; order: number; text(): string }): () => void } }
      const dispose = host.systemPrompt.section({ name: 'agent-plugins:instructions', order: 500, text: () => text })
      return {
        /** 表面适配器回调：把最新项目套件快照传给具体注册表。 */
        async reconcile(projectSuites) {
          const result = await suiteInstructions([...(await catalog.enabledUserSuites()), ...projectSuites])
          text = result.text
          return result.errors
        },
        /** 表面适配器回调：释放该 Agent 作用域内全部注册。 */
        disposeAll() {
          text = ''
          dispose()
        }
      }
    },
    true
  )
}

/** 读取并拼接套件说明 Markdown，返回正文及逐套件读取错误。 */
export async function suiteInstructions(suites: readonly Suite[]): Promise<{ text: string; errors: Array<{ suiteId: string; reason: string }> }> {
  const chunks: string[] = []
  const errors: Array<{ suiteId: string; reason: string }> = []
  for (const suite of suites) {
    if (!suite.enabled || suite.configurationOnly || suite.activeSurfaces?.skills === false) continue
    if (suite.systemPrompt !== undefined) chunks.push(suite.systemPrompt)
    if (suite.manifest.startupSkill === undefined) continue
    const skill = suite.skills.find(skill => skill.name === suite.manifest.startupSkill)
    if (skill === undefined) {
      errors.push({ suiteId: `${suite.sourceId}/${suite.id}`, reason: `startup skill ${suite.manifest.startupSkill} was not discovered` })
      continue
    }
    try {
      const content = await readFile(skill.file, 'utf8')
      if (parseFrontmatterRecord(content).disabled === true) continue
      chunks.push(stripFrontmatter(content))
      if (suite.manifest.skillInstructions !== undefined) chunks.push(suite.manifest.skillInstructions)
    } catch {
      errors.push({ suiteId: `${suite.sourceId}/${suite.id}`, reason: `startup skill ${skill.name} is unreadable` })
    }
  }
  return { text: chunks.join('\n\n'), errors }
}

interface ProjectRegistry {
  /** 中文：把项目级表面与当前套件快照对账，返回无法挂载的诊断。 */
  reconcile(suites: Suite[]): Promise<Array<{ suiteId: string; reason: string }>>
  /** 中文：释放项目级表面的全部挂载和监听。 */
  disposeAll(): void | Promise<void>
}

/** 复用 Agent 创建/销毁事件，把一个项目表面注册器挂到所有 Agent。 */
function mountProjectSurface(
  ctx: Context,
  catalog: Catalog,
  service: string | string[],
  create: (scope: Context, agent: ProjectAgent) => ProjectRegistry,
  withoutProject = false
): { refresh(): Promise<void>; dispose(): Promise<void> } {
  const mounts = new Map<ProjectAgent, AgentMount>()
  let disposed = false
  /** 记录项目表面挂载或刷新失败，不中断其他 Agent 的生命周期处理。 */
  const warn = (error: unknown): void => ctx.logger?.warn(`[dsh-agent-plugins-market] project ${service}: ${String(error)}`)
  /** 为一个 Agent 建立指定项目表面挂载，并把后续刷新接入其作用域。 */
  const attach = (agent: ProjectAgent): void => {
    const cwd = agent.session.header.cwd
    if (disposed || (cwd === undefined && !withoutProject) || mounts.has(agent)) return
    /** 首次 Agent 创建后替换为真实刷新函数，避免事件早于注册表初始化。 */
    let refresh = async (): Promise<void> => {}
    const fiber = agent.ctx.inject(typeof service === 'string' ? [service] : service, scope => {
      const registry = create(scope, agent)
      let active = true
      let queue = Promise.resolve()
      refresh = (): Promise<void> => {
        queue = queue.catch(warn).then(async () => {
          if (!active) return
          const snapshot = cwd === undefined ? { enabledSuites: [] } : await catalog.readProjectCatalog(cwd)
          if (!active) return
          const diagnostics = await registry.reconcile([...snapshot.enabledSuites])
          if (!active) await registry.disposeAll()
          for (const diagnostic of diagnostics) warn(`${diagnostic.suiteId}: ${diagnostic.reason}`)
        })
        return queue
      }
      scope.effect(
        () => async () => {
          active = false
          await registry.disposeAll()
        },
        `dsh-agent-plugins-market: project ${service}`
      )
      void refresh().catch(warn)
    })
    mounts.set(agent, { fiber, refresh: () => refresh() })
  }
  /** 从单个 Agent 作用域释放表面并从活动集合移除。 */
  const detach = async (agent: ProjectAgent): Promise<void> => {
    const mount = mounts.get(agent)
    mounts.delete(agent)
    await mount?.fiber.dispose()
  }
  const unwatchCreated = ctx.on('agent/created', async ({ agent }) => {
    attach(agent)
    await mounts.get(agent)?.refresh()
  })
  const unwatchDisposed = ctx.on('agent/disposed', ({ agent }) => {
    void detach(agent).catch(warn)
  })
  for (const agent of ctx.agents.list()) attach(agent)
  return {
    refresh: async () => {
      await Promise.all([...mounts.values()].map(mount => mount.refresh()))
    },
    dispose: async () => {
      disposed = true
      unwatchCreated()
      unwatchDisposed()
      await Promise.all([...mounts.keys()].map(detach))
    }
  }
}
