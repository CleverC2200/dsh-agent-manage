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
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { BusinessResources } from './runtime/business-resources.js'
import { readJsonRequest, RequestBodyTooLarge } from './runtime/request-body.js'
import type {} from '@deepseek-ai/dsh-client-connection'
import { Catalog } from './application/catalog.js'
import { RuntimeReconciler } from './runtime/reconciler.js'
import { inspectToolRegistry } from './runtime/tool-registry-observer.js'
import { mountAgentRoleTool } from './runtime/agent-role-router.js'
import { projectAgentRoles } from './application/project-agent-roles.js'
import { mountProjectCommands, mountProjectMcp, mountProjectHooks, mountSuiteInstructions } from './runtime/project-runtime.js'
import { createPanelResources } from './application/panel-resources.js'
import { resolveDataRoot, resolveUserRoot } from './catalog/paths.js'
import { assertCanonicalStorageDirectories } from './runtime/storage.js'
import { mountSuiteRoutes } from './routes.js'
import { MCP_SETTINGS_NAMESPACE, MarketSettingsSchema } from './runtime/mcp-backend.js'
import { narrowDownloadRegion } from './runtime/regions.js'
import { SuiteSkillProvider } from './runtime/skills-provider.js'
import { loadLspServers } from './runtime/lsp-direct-config.js'
import { loadDisabledLspServers } from './runtime/lsp-server-state.js'
import { bindHostLocale, loadHostLocale, type HostLocaleKey, type HostTranslate } from './runtime/host-locale.js'
import { mountFeedbackTool } from './runtime/feedback-tool.js'
import { createUserPanelStores } from './runtime/user-panels.js'
import { UserPanelSkillProvider } from './runtime/user-panels.js'
import { UserCommandMountRegistry } from './runtime/user-commands.js'
import { mountGeaMcp, type GeaMcpConsumer } from './runtime/gea-mcp.js'
import type { SourceRef } from './model/types.js'

export const name = 'dsh-agent-manage'
export const inject = ['skills', 'commands']

/** Host configuration. */
/** 中文：插件启动时可传入 GEA MCP、初始来源和 Git 获取策略；存储根目录由宿主 DSH_HOME 决定。 */
export interface Config {
  /** Registered GEA Consumer for automatic MCP discovery after GEA plugin login. */
  /** 中文：GEA 登录后用于自动发现 MCP 的消费者；显式 false 时不挂载。 */
  geaMcp?: GeaMcpConsumer | false
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

/** 启动插件：恢复目录状态，注册运行时资源、设置监听、路由和最终销毁器。 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  if ('userRoot' in config || 'dataRoot' in config) throw new Error('MANAGE_STORAGE_UPGRADE_REQUIRED: legacy storage overrides require a separately authorized upgrade')
  await assertCanonicalStorageDirectories()
  if (config.geaMcp !== false) mountGeaMcp(ctx, config.geaMcp)
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
  /** Settings watchers to release at teardown (backend watch + feedback switch). */
  /** 中文：保存后端、反馈工具和项目布局设置监听器，销毁时统一解除。 */
  const settingsWatchers: Array<() => void> = []
  const runtime = new RuntimeReconciler(ctx, dataRoot, key => hostLocale.t(key))

  // User panel stores (skills / commands / agent personas) and their runtime
  // contributions: one extra skill provider plus one command mount registry.
  // 中文：创建用户面板存储，并分别接入技能提供器和命令挂载注册表。
  const panels = createUserPanelStores(userRoot)
  const userCommands = new UserCommandMountRegistry(ctx, panels.commands, key => hostLocale.t(key))

  let disposed = false
  let projectCommands: ReturnType<typeof mountProjectCommands> | undefined
  let projectMcp: ReturnType<typeof mountProjectMcp> | undefined
  let projectHooks: ReturnType<typeof mountProjectHooks> | undefined
  let suitePrompts: ReturnType<typeof mountSuiteInstructions> | undefined
  let reconcileRequested = false
  let reconciliation: Promise<void> | undefined
  /** 执行一次完整运行时重协调，并把各能力面的诊断写回 Catalog。 */
  const reconcileOnce = async (): Promise<void> => {
    try {
      const suites = await catalog.enabledUserSuites()
      if (disposed) return
      const diagnostics = await runtime.reconcile(suites)
      catalog.mcpDiagnostics = diagnostics.mcp
      for (const diagnostic of diagnostics.mcp) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" mcp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.lsp) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" lsp server "${diagnostic.serverKey}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.commands) {
        if (diagnostic.reason !== '') ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" command "${diagnostic.command}": ${diagnostic.reason}`)
      }
      for (const diagnostic of diagnostics.hooks) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] suite "${diagnostic.suiteId}" hooks: ${diagnostic.reason}`)
      }
      for (const error of diagnostics.errors) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] ${error.surface} reconcile failed: ${error.reason}`)
      }
    } catch (error) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] runtime reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
  }

  // Settings, credential and catalog events can arrive during a slow MCP
  // connection. Keep one current pass and one fresh follow-up, not a queue
  // of stale snapshots that all reconnect the same servers.
  // 中文：慢连接期间只保留当前执行和一个后续请求，避免过期快照重复重连。
  /** 合并并串行执行重协调请求，确保新变更不会被慢的旧请求吞掉。 */
  const reconcileMounts = (): Promise<void> => {
    if (disposed) return Promise.resolve()
    reconcileRequested = true
    reconciliation ??= (async () => {
      try {
        do {
          reconcileRequested = false
          await reconcileOnce()
        } while (reconcileRequested && !disposed)
      } finally {
        reconciliation = undefined
      }
    })()
    return reconciliation
  }

  /**
   * Coalesce credential updates.
   *
   * `runtime.usesCredential(ref)` reflects the last completed pass, so an event
   * arriving while the first reconcile is still running would be filtered out
   * and the remount lost. Pending refs are therefore kept until the next pass
   * observes them, and bursts are collapsed into one reconcile.
   * 中文：凭据事件先暂存引用并合并突发通知，等下一轮重协调统一处理。
   */
  const pendingCredentialRefs = new Set<string>()
  let credentialFlush: ReturnType<typeof setTimeout> | undefined
  /** 清空待处理凭据引用并触发一次重协调，同时记录本轮引用。 */
  const flushCredentialUpdates = (): void => {
    credentialFlush = undefined
    const refs = [...pendingCredentialRefs]
    pendingCredentialRefs.clear()
    // Re-read the catalog first: an unknown ref means the snapshot predates
    // this change, so reconcile anyway to refresh the known reference set.
    // 中文：先重新读取目录；未知引用可能来自旧快照，因此仍需完整重协调。
    void reconcileMounts().catch(() => {})
    if (refs.length > 0) {
      ctx.logger?.info?.(`[dsh-agent-plugins-market] reconciling after credential update: ${refs.join(', ')}`)
    }
  }

  /** 响应 Catalog 变更，刷新各资源挂载并触发运行时重协调。 */
  const onChanged = async (): Promise<void> => {
    if (disposed) return
    providerControl?.invalidate()
    userPanelControl?.invalidate()
    await projectCommands?.refresh()
    await suitePrompts?.refresh()
    await Promise.all([projectMcp?.refresh(), projectHooks?.refresh()])
    const userCommandDiagnostics = await userCommands.reconcile().catch(() => [] as string[])
    for (const reason of userCommandDiagnostics) {
      ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
    }
    await reconcileMounts()
  }

  // The credential store powers the MCP re-authorize action (dropping a grant
  // record forces the next mount through a fresh browser authorization).
  // Resolved lazily at call time: this plugin's apply may run before the
  // credentials plugin provisions, and a snapshot taken here would be
  // permanently undefined even after the service is live.
  // 中文：凭据服务按调用时惰性解析，避免插件先启动导致永久保存 undefined。
  const catalog = new Catalog({ userRoot, dataRoot, onChanged, ...(config.git === undefined ? {} : { git: config.git }) })
  await catalog.load()
  ctx.inject(['agentPresets', 'connection'], async host => {
    const businessResources = new BusinessResources(host, resolve(dataRoot, 'selected-resources.json'))
    await businessResources.load()
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

  await catalog.mergeSources(config.sources ?? [])
  const resources = createPanelResources(catalog, panels)
  // Mirror oauth.ts's `credentialIdFor`: the record is stored under the folded
  // serverName, so the delete must fold the same way or it misses the record.
  // 中文：凭据记录使用折叠后的 serverName 作为键，删除时必须复用完全相同的折叠规则。
  /** 将 MCP serverName 归一化为凭据存储使用的稳定 ID。 */
  const credentialIdFor = (serverName: string): string =>
    serverName
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'server'
  catalog.setCredentialsStore({
    deleteGrantRecord: async serverName => {
      const store = (ctx as unknown as { get?: (name: string) => unknown }).get?.('credentials') as { deleteRecord?: (key: string) => Promise<void> } | undefined
      if (store?.deleteRecord === undefined) throw new Error('credentials service is not mounted')
      await store.deleteRecord(`mcp-auth/${credentialIdFor(serverName)}` as never)
    }
  })
  runtime.setMcpOverridesProvider(async () => catalog.allMcpOverrides(await catalog.enabledUserSuites()))
  // Re-authorize must rebuild the live bridge, not just drop the grant: the
  // registry flags the mount and the following reconcile tears it down and
  // remounts, so the server's 401 restarts the browser authorization.
  // 中文：重新授权不仅删除记录，还必须标记活连接重建，才能让 401 重新触发浏览器授权。
  catalog.setMcpRemountHook(
    (suiteId, serverKey) => runtime.forceMcpRemount(suiteId, serverKey),
    serverName => runtime.mcpServerOwner(serverName)
  )
  catalog.setLspStatusSource(runtime.lsp)
  runtime.lsp.setDirectProvider(async () => (await loadLspServers(dataRoot)).servers)
  runtime.lsp.setDisabledProvider(() => loadDisabledLspServers(dataRoot))
  // The MCP backend choice is a host settings namespace (the registration is
  // also what makes the plugin-config tab serve our card). The node half owns
  // it: the provider derives the mount backend from the scope, the writer
  // flips the switch, and the watcher remounts servers when it flips. The
  // same single registration also gates the experience-feedback tool —
  // `settings.register` throws on a duplicate namespace, so there is exactly
  // one inject block and one `register` call.
  //
  // The whole callback is failure-contained on purpose: a throw here is
  // INVISIBLE in the UI (the inject resolves asynchronously and cordis only
  // logs), and it silently removes the namespace from settings.describe —
  // which is exactly what hides the plugin-config card. Every failure mode
  // lands in the logger with a loud prefix instead.
  // 中文：设置命名空间注册和同步器均失败封装在 logger 中，不能让配置卡静默消失。
  let feedbackDisposer: (() => void) | undefined
  /** 解析宿主 settings 服务，注册 MCP 后端/区域/反馈设置及其监听。 */
  ctx.inject(['settings'], settingsCtx => {
    try {
      ctx.logger?.info?.('[dsh-agent-plugins-market] settings inject resolved — registering namespace')
      const settings = (
        settingsCtx as unknown as {
          settings: {
            register<T>(
              ns: string,
              schema: unknown,
              options?: { base?: T }
            ): {
              /** 中文：读取当前命名空间设置快照，供运行时决定后端和扫描策略。 */
              get(): T
              /** 中文：监听设置变化，返回解除监听函数。 */
              watch(callback: () => void): () => void
              /** 中文：写入设置补丁并触发相关运行时重协调。 */
              update(patch: Partial<T>): Promise<void>
            }
          }
        }
      ).settings
      const scope = settings.register(MCP_SETTINGS_NAMESPACE, MarketSettingsSchema, {
        base: { mcpEnhanced: true, downloadRegion: 'auto', feedbackEnabled: true, scanProjectLayouts: true }
      })
      ctx.logger?.info?.('[dsh-agent-plugins-market] settings namespace registered — plugin-config card will serve')
      catalog.setMcpBackendProvider(async () => (scope.get().mcpEnhanced === false ? 'host' : 'builtin'))
      catalog.setMcpBackendWriter(async backend => {
        await scope.update({ mcpEnhanced: backend !== 'host' })
      })
      catalog.setDownloadRegionProvider(async () => narrowDownloadRegion(scope.get().downloadRegion))
      /** 根据设置快照同步项目布局扫描开关。 */
      const syncProjectLayouts = (): void => {
        void catalog.setScanProjectLayouts(scope.get().scanProjectLayouts !== false).catch(error => {
          ctx.logger?.error?.(`[dsh-agent-plugins-market] project layout reconciliation failed: ${String(error)}`)
        })
      }
      syncProjectLayouts()
      settingsWatchers.push(scope.watch(syncProjectLayouts))
      let previousBackend = scope.get().mcpEnhanced !== false
      settingsWatchers.push(
        scope.watch(() => {
          const backend = scope.get().mcpEnhanced !== false
          if (backend === previousBackend) return
          previousBackend = backend
          void Promise.all([reconcileMounts(), projectMcp?.refresh()]).catch(() => {})
        })
      )
      // The experience-feedback model tool: gated by the namespace's
      // `feedbackEnabled` field (default on); the switch unregisters it. The
      // tool mount is doubly contained — its failure must never take the
      // settings namespace (and with it the config card) down with it.
      // 中文：反馈工具受命名空间开关控制；挂载失败只记录日志，不影响设置命名空间。
      /** 根据 feedbackEnabled 开关挂载或卸载体验反馈工具。 */
      const syncFeedbackTool = (): void => {
        try {
          const state = scope.get() as { feedbackEnabled?: boolean }
          const wanted = state.feedbackEnabled !== false
          if (wanted && feedbackDisposer === undefined) {
            feedbackDisposer = mountFeedbackTool(ctx, dataRoot, (key, params) => hostLocale.t(key as HostLocaleKey, params)) ?? undefined
          } else if (!wanted && feedbackDisposer !== undefined) {
            feedbackDisposer()
            feedbackDisposer = undefined
          }
        } catch (error) {
          ctx.logger?.error?.(`[dsh-agent-plugins-market] feedback tool mount failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
        }
      }
      syncFeedbackTool()
      settingsWatchers.push(scope.watch(() => syncFeedbackTool()))
    } catch (error) {
      ctx.logger?.error?.(
        `[dsh-agent-plugins-market] settings namespace registration failed — the plugin-config card will be hidden this boot: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      )
    }
  })
  runtime.setMcpBackendProvider(() => catalog.mcpBackend())
  const eventHost = ctx as unknown as { on?: (event: string, listener: (ref: string) => void) => () => void }
  /** 监听凭据引用变更，合并短时间内的多次事件并安排延迟刷新。 */
  const disposeCredentialUpdates =
    eventHost.on?.('credentials/reference-updated', ref => {
      pendingCredentialRefs.add(ref)
      if (credentialFlush !== undefined) clearTimeout(credentialFlush)
      credentialFlush = setTimeout(flushCredentialUpdates, 150)
      credentialFlush.unref?.()
    }) ?? (() => {})
  /** 接入宿主工具注册表，提供 MCP 工具快照和同名工具冲突探测。 */
  ctx.inject(['tools'], toolsCtx => {
    const registry = (toolsCtx as unknown as { tools: unknown }).tools
    catalog.setMcpToolSnapshotProvider(() => inspectToolRegistry(registry))
    // Foreign-namespace guard: a native host MCP client (or another plugin)
    // owning `mcp__<serverName>__` names makes the mount registry skip its
    // own server with a clear diagnostic instead of failing mid-registration.
    // 中文：若宿主或其他插件已占用同名工具，跳过重复挂载并保留明确诊断。
    runtime.setMcpToolNamesProvider(() => inspectToolRegistry(registry).map(tool => tool.name))
  })
  void Promise.resolve()
    .then(async () => {
      const userCommandDiagnostics = await userCommands.reconcile().catch(() => [] as string[])
      for (const reason of userCommandDiagnostics) {
        ctx.logger?.warn(`[dsh-agent-plugins-market] user commands: ${reason}`)
      }
      await reconcileMounts()
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
    return new UserPanelSkillProvider(panels.skills, key => hostLocale.t(key))
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
      const mounted = mountProjectCommands(hostCtx, catalog, key => hostLocale.t(key))
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
    () => () => {
      disposed = true
      disposeCredentialUpdates()
      if (credentialFlush !== undefined) clearTimeout(credentialFlush)
      credentialFlush = undefined
      pendingCredentialRefs.clear()
      for (const dispose of settingsWatchers.splice(0)) dispose()
      feedbackDisposer?.()
      feedbackDisposer = undefined
      userCommands.disposeAll()
      void runtime.dispose()
    },
    'dsh-agent-plugins-market: lifecycle'
  )
}
