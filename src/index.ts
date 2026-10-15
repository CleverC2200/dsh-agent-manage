import { AgentSources } from './runtime/agent-sources.js'
import { mountAgentSourceRoutes } from './runtime/agent-source-routes.js'
/** 文件作用：插件宿主入口，注册技能提供器、运行时协调器、市场 HTTP 路由和项目级资源挂载。 */
/**
 * dsh-agent-plugins-market host entry: the Agent Plugins Market manager.
 *
 * Function plugin (named exports, no default export). It registers one skill
 * provider feeding enabled suites into `ctx.skills`, reconciles enabled
 * suites' `mcp.json` servers into live self-built bridge mounts (stdio,
 * Streamable HTTP with OAuth, and legacy SSE — no host MCP client needed),
 * and mounts the market page's HTTP routes on the web server. Skills and MCP
 * tools are exposed through the host's native model surfaces; this plugin
 * does not register a redundant suite-inventory model tool.
 *
 * Requires `ctx.skills` (the dsh skill registry). MCP mounting is
 * self-contained: suites' MCP servers mount through the market's own bridge
 * plugin on the host `tools` registry.
 *
 * 业务职责：组装 Catalog 与各运行时桥接，串行化变更后的重协调，并负责宿主服务注入、监听和销毁生命周期。
 */
import { createForecastTool } from './runtime/forecast-compute.js'
import { mountSkillReferenceReader } from './runtime/skill-reference.js'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { BusinessResources } from './runtime/business-resources.js'
import * as StandardPreset from './runtime/standard-preset.js'
import { UserAgents } from './runtime/user-agents.js'
import { mountUserAgentRoutes } from './runtime/user-agent-routes.js'
import { readJsonRequest, RequestBodyTooLarge } from './runtime/request-body.js'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-settings'
import { Catalog } from './application/catalog.js'
import { inspectToolRegistry } from './runtime/tool-registry-observer.js'
import { mcpAuthRecordKey } from './runtime/mcp-client/oauth.js'
import { mountAgentRoleTool } from './runtime/agent-role-router.js'
import { projectAgentRoles } from './application/project-agent-roles.js'
import { mountProjectCommands, mountProjectMcp, mountProjectHooks, mountSuiteInstructions } from './runtime/project-runtime.js'
import { createPanelResources } from './application/panel-resources.js'
import { resolveDataRoot, resolveUserRoot } from './catalog/paths.js'
import { assertCanonicalStorageDirectories } from './runtime/storage.js'
import { mountSuiteRoutes } from './routes.js'
import { ManageConfigSchema } from './runtime/mcp-backend.js'
import { narrowDownloadRegion } from './runtime/regions.js'
import { SuiteSkillProvider } from './runtime/skills-provider.js'
import { bindHostLocale, loadHostLocale, type HostLocaleKey, type HostTranslate } from './runtime/host-locale.js'
import { mountFeedbackTool } from './runtime/feedback-tool.js'
import { createUserPanelStores } from './runtime/user-panels.js'
import { UserPanelSkillProvider } from './runtime/user-panels.js'
import { UserCommandMountRegistry } from './runtime/user-commands.js'
import { mountGeaMcp } from './runtime/gea-mcp.js'
import type { SourceRef } from './model/types.js'
export { pluginPackageVersion } from './plugin-package-version.js'

export const name = 'dsh-agent-manage'
export const inject = ['skills', 'commands']

/** Host configuration. */
/** 中文：插件启动时可传入 GEA MCP、初始来源和 Git 获取策略；存储根目录由宿主 DSH_HOME 决定。 */
export interface Config {
  /** Live fields belong to the official Loader config and SettingsForms. */
  mcpEnhanced: Volatile<boolean>
  downloadRegion: Volatile<'auto' | 'global' | 'china'>
  feedbackEnabled: Volatile<boolean>
  scanProjectLayouts: Volatile<boolean>
  /** Registered GEA Consumer for automatic MCP discovery after GEA plugin login. */
  /** 中文：GEA 登录后用于自动发现 MCP 的消费者；显式 false 时不挂载。 */
  geaMcp?: false
  /** Initial repository sources, merged into the persisted state on first load. */
  /** 中文：首次加载时并入持久化状态的初始仓库源。 */
  sources?: SourceRef[]
  /**
   * Git/archive acquisition tuning: `proxy` (http/https proxy URL),
   * `insteadOf` URL-prefix rewrites (mirror acceleration), `timeoutMs` per
   * git invocation, `cloneRetry` (default true), `fallbackTarball` (retry a
   * failed GitHub clone as a codeload tarball download; default false), and
   * `allowHttpArchives` (permit plain-http archive URLs; default false).
   * 中文：统一控制代理、镜像改写、超时、重试、GitHub 压缩包回退和 HTTP 压缩包许可。
   */
  git?: {
    proxy?: string
    insteadOf?: Record<string, string>
    timeoutMs?: number
    cloneRetry?: boolean
    fallbackTarball?: boolean
    allowHttpArchives?: boolean
  }
}

export const Config = ManageConfigSchema

/** 启动插件：恢复目录状态，注册运行时资源、设置监听、路由和最终销毁器。 */
export async function apply(ctx: Context, config: Config = Config({})): Promise<void> {
  if ('userRoot' in config || 'dataRoot' in config) throw new Error('MANAGE_STORAGE_UPGRADE_REQUIRED: legacy storage overrides require a separately authorized upgrade')
  await assertCanonicalStorageDirectories()
  const standardInitialization = ctx.inject(['agentPresets', 'loader'], async host => {
    await host.plugin(StandardPreset)
  })
  if (config.geaMcp !== false) mountGeaMcp(ctx)
  const userRoot = resolveUserRoot()
  const dataRoot = resolveDataRoot()
  let providerControl: SkillProviderControl | undefined
  let userPanelControl: SkillProviderControl | undefined
  // Host runtime copy resolves from the harness `locale.preference` setting;
  // the async settings read lands before the first session starts in practice.
  // 中文：先用默认语言建立同步翻译器，异步读取宿主语言后刷新两个技能提供器。
  const t = bindHostLocale(undefined)
  void loadHostLocale().then(locale => {
    hostLocale.t = locale.t
    providerControl?.invalidate()
    userPanelControl?.invalidate()
  })
  const hostLocale: { t: HostTranslate } = { t }

  // User panel stores (skills / commands / agent personas) and their runtime
  // contributions: one extra skill provider plus one command mount registry.
  // 中文：创建用户面板存储，并分别接入技能提供器和命令挂载注册表。
  const panels = createUserPanelStores(userRoot)
  const userCommands = new UserCommandMountRegistry(ctx, panels.commands, (key, params) => hostLocale.t(key, params))

  let agentSources: AgentSources | undefined
  let disposed = false
  let projectCommands: ReturnType<typeof mountProjectCommands> | undefined
  let projectMcp: ReturnType<typeof mountProjectMcp> | undefined
  let projectHooks: ReturnType<typeof mountProjectHooks> | undefined
  let suitePrompts: ReturnType<typeof mountSuiteInstructions> | undefined
  /** 响应 Catalog 变更，刷新各资源挂载并触发运行时重协调。 */
  const onChanged = async (): Promise<void> => {
    if (disposed) return
    agentSources?.changed()
    providerControl?.invalidate()
    userPanelControl?.invalidate()
    await projectCommands?.refresh()
    await suitePrompts?.refresh()
    await Promise.all([projectMcp?.refresh(), projectHooks?.refresh()])
    const userCommandDiagnostics = await userCommands.reconcile().catch(() => [] as string[])
    for (const reason of userCommandDiagnostics) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
    }
  }

  let writeBackend: (backend: import('./runtime/mcp-backend.js').McpBackend) => Promise<void> = async () => {
    throw new Error('the settings service is not mounted')
  }
  const catalog = new Catalog({
    userRoot,
    dataRoot,
    onChanged,
    ...(config.git === undefined ? {} : { git: config.git }),
    runtime: {
      ctx,
      translate: (key, params) => hostLocale.t(key, params),
      backend: async () => (config.mcpEnhanced.get() ? 'builtin' : 'host'),
      writeBackend: backend => writeBackend(backend),
      tools: () => inspectToolRegistry((ctx as unknown as { get?(name: string): unknown }).get?.('tools')),
      deleteGrantRecord: async serverName => {
        const store = (ctx as unknown as { get?: (name: string) => unknown }).get?.('credentials') as { deleteRecord?: (key: string) => Promise<void> } | undefined
        if (store?.deleteRecord === undefined) throw new Error('credentials service is not mounted')
        await store.deleteRecord(mcpAuthRecordKey(serverName))
      }
    }
  })
  await catalog.load()
  ctx.inject(['agentPresets', 'connection', 'tools', 'agents'], async host => {
    // Selected identities compose the same standard declaration as orchestration.
    // Wait on that initialization fiber, never the parent Host tree.
    await standardInitialization
    const userAgents = new UserAgents(host, resolve(dataRoot, 'user-agents.json'), catalog.runtime)
    host.provide('userAgents', userAgents)
    await userAgents.load()
    host.effect(() => () => userAgents.dispose())
    mountUserAgentRoutes(host, userAgents)
    agentSources = new AgentSources(catalog, userAgents)
    mountAgentSourceRoutes(host, agentSources)
    const businessResources = new BusinessResources(host, resolve(dataRoot, 'selected-resources.json'))
    await businessResources.load()
    const releaseBusinessSkills = await businessResources.register([
      {
        id: 'aps-analysis-skills',
        label: '产销分析',
        root: fileURLToPath(new URL('../business-resources/aps-analysis/', import.meta.url)),
        profile: { label: '产销分析', consumerCode: 'aps', skills: ['sales-forecast-result-analysis', 'sales-ops-problem-analysis'] },
        skillFiles: { 'sales-forecast-result-analysis': 'sales-forecast-result-analysis.skill.md', 'sales-ops-problem-analysis': 'sales-ops-problem-analysis.skill.md' }
      },
      {
        id: 'sales-forecast-skills',
        label: '销售预测',
        root: fileURLToPath(new URL('../business-resources/sinian-demand-forecast/', import.meta.url)),
        profile: {
          label: '销售预测',
          consumerCode: 'sales_forecast',
          skills: ['sinian-demand-dialogue', 'sinian-forecast-scope', 'sinian-demand-baseline', 'sinian-forecast-review']
        },
        skillFiles: {
          'sinian-demand-dialogue': 'skills/sinian-demand-dialogue/SKILL.md',
          'sinian-forecast-scope': 'skills/sinian-forecast-scope/SKILL.md',
          'sinian-demand-baseline': 'skills/sinian-demand-baseline/SKILL.md',
          'sinian-forecast-review': 'skills/sinian-forecast-review/SKILL.md'
        }
      }
    ])
    host.effect(() => releaseBusinessSkills)
    host.effect(() => () => businessResources.dispose())
    host.provide('agentResources', businessResources)
    host.inject(['tools', 'fs'], toolHost => {
      mountSkillReferenceReader(toolHost)
      toolHost.effect(() => toolHost.tools.register(createForecastTool(toolHost.skills)))
    })
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
    host.effect(() =>
      host.connection.fetch.register({
        path: '/api/agent-manage/resources',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async request => {
          try {
            const cwd = new URL(request.url).searchParams.get('cwd')
            if (!cwd || !cwd.trim() || !isAbsolute(cwd)) throw Error('INVALID_AGENT_RESOURCE_WORKSPACE')
            return json(await businessResources.list({ cwd, signal: request.signal }))
          } catch (error) {
            return json({ error: String(error) }, 400)
          }
        }
      })
    )
    host.effect(() =>
      host.connection.fetch.register({
        path: '/api/agent-manage/resources/select',
        methods: ['POST'],
        requestBody: 'streaming',
        fetch: async request => {
          try {
            const input = (await readJsonRequest(request)) as { id?: unknown; cwd?: unknown }
            if (!input || typeof input.id !== 'string' || Object.keys(input).some(key => key !== 'id' && key !== 'cwd')) throw Error('INVALID_AGENT_RESOURCE_SELECTION')
            if (typeof input.cwd !== 'string' || !input.cwd.trim() || !isAbsolute(input.cwd)) throw Error('INVALID_AGENT_RESOURCE_WORKSPACE')
            const selection = await businessResources.select(input.id, request.signal, input.cwd)
            return json({
              id: selection.id,
              preset: selection.preset,
              ...(selection.skill ? { skill: selection.skill } : {}),
              ...(selection.interpreters ? { interpreters: selection.interpreters } : {})
            })
          } catch (error) {
            return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof RequestBodyTooLarge ? 413 : 400)
          }
        }
      })
    )
  })

  await catalog.mergeSources([
    ...(config.sources ?? []),
    { id: 'bundled-sales-plan', url: fileURLToPath(new URL('../business-resources/sales-plan/', import.meta.url)), local: true }
  ])
  const resources = createPanelResources(catalog, panels)
  catalog.setDownloadRegionProvider(async () => narrowDownloadRegion(config.downloadRegion.get()))
  await catalog.setScanProjectLayouts(config.scanProjectLayouts.get())
  ctx.inject(['settings'], settingsCtx => {
    const entry = ctx.fiber.entry
    if (!entry) throw Error('MANAGE_SETTINGS_ENTRY_REQUIRED')
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    writeBackend = async backend => {
      await settingsCtx.settings.update(entry.options.id!, { mcpEnhanced: backend !== 'host' })
    }
  })
  ctx.inject(['tools'], toolHost => {
    let feedbackDisposer: (() => void) | undefined
    const syncFeedbackTool = (): void => {
      if (config.feedbackEnabled.get() && !feedbackDisposer) {
        feedbackDisposer = mountFeedbackTool(toolHost, dataRoot, (key, params) => hostLocale.t(key as HostLocaleKey, params)) ?? undefined
      } else if (!config.feedbackEnabled.get() && feedbackDisposer) {
        feedbackDisposer()
        feedbackDisposer = undefined
      }
    }
    const stop = ctx.on('loader/volatile-update', paths => {
      if (paths.some(([field]) => field === 'feedbackEnabled')) syncFeedbackTool()
    })
    toolHost.effect(() => () => {
      stop()
      feedbackDisposer?.()
    })
    syncFeedbackTool()
  })
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(([field]) => field === 'scanProjectLayouts')) {
      void catalog.setScanProjectLayouts(config.scanProjectLayouts.get()).catch(error => {
        ctx.logger.error(`[dsh-agent-manage] project layout reconciliation failed: ${String(error)}`)
      })
    }
    if (paths.some(([field]) => field === 'mcpEnhanced')) {
      void Promise.all([catalog.runtime.reconcile(), projectMcp?.refresh()]).catch(error => {
        ctx.logger.error(`[dsh-agent-manage] MCP backend reconciliation failed: ${String(error)}`)
      })
    }
  })
  void Promise.resolve()
    .then(async () => {
      const userCommandDiagnostics = await userCommands.reconcile().catch(() => [] as string[])
      for (const reason of userCommandDiagnostics) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
      }
      await catalog.runtime.reconcile()
    })
    .catch(() => {})

  ctx.skills.registerProvider(control => {
    // 中文：注册套件技能提供器；保存 control 供目录或语言变化时失效缓存。
    providerControl = control
    return new SuiteSkillProvider(catalog)
  })

  // User panel skills ride a second provider so a panel
  // edit invalidates only its own catalog contribution.
  // 中文：用户面板单独使用第二个提供器，面板编辑只失效自身目录贡献。
  ctx.skills.registerProvider(control => {
    userPanelControl = control
    return new UserPanelSkillProvider(panels.skills, (key, params) => hostLocale.t(key, params))
  })

  ctx.inject(['tools', 'llm', 'subagents', 'agents'], hostCtx => {
    // 中文：把用户面板角色和项目角色合并后交给宿主角色工具路由。
    hostCtx.effect(
      () =>
        mountAgentRoleTool(
          hostCtx,
          async parent => [
            ...(await resources.agents.list(true)).map(entry => ({ ...entry, title: entry.name, name: entry.id ?? entry.name })),
            ...(await projectAgentRoles(catalog, parent))
          ],
          (key, params) => hostLocale.t(key, params)
        ),
      'dsh-agent-plugins-market: agent role routing'
    )
  })

  ctx.inject(['agents'], hostCtx => {
    // 中文：挂载项目命令、MCP、Hook 和套件提示，并以同一 effect 管理销毁。
    hostCtx.effect(() => {
      const mounted = mountProjectCommands(hostCtx, catalog, (key, params) => hostLocale.t(key, params))
      const mcp = mountProjectMcp(hostCtx, catalog, dataRoot)
      const hooks = mountProjectHooks(hostCtx, catalog)
      const prompts = mountSuiteInstructions(hostCtx, catalog)
      projectCommands = mounted
      projectMcp = mcp
      projectHooks = hooks
      suitePrompts = prompts
      return async () => {
        if (projectCommands === mounted) projectCommands = undefined
        if (projectMcp === mcp) projectMcp = undefined
        if (projectHooks === hooks) projectHooks = undefined
        if (suitePrompts === prompts) suitePrompts = undefined
        await Promise.all([mounted.dispose(), mcp.dispose(), hooks.dispose(), prompts.dispose()])
      }
    }, 'dsh-agent-plugins-market: project command lifecycle')
  })

  ctx.inject(['webServer', 'loader'], hostCtx => {
    // 中文：把 Catalog 和资源仓库接入市场 HTTP 路由，效果销毁时卸载路由。
    hostCtx.effect(() => mountSuiteRoutes(hostCtx, catalog, resources), 'dsh-agent-plugins-market: http routes')
  })

  ctx.effect(
    // 中文：插件销毁时停止监听、清空待处理事件、卸载用户命令并释放运行时桥接。
    () => async () => {
      disposed = true
      userCommands.disposeAll()
      await catalog.runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
