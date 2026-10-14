/**
 * dsh-agent-plugins-market client: registers the Agent Plugins Market section inside the Web
 * GUI's settings page (the same settings.section seat dshmarket uses), with a
 * current settings.section contract as its only surface. The bundle's
 * browser externals are React, ReactDOM, and the injected `dsh.client.inject`
 * module table, so it cannot reach packages the host does not serve.
 *
 * 文件作用：插件客户端入口，向宿主注册翻译、忙碌遮罩和正式设置区工作台。
 * 业务职责：检查宿主 UI 能力、绑定设置命名空间，并把配置读写委托给宿主服务；入口本身不承载市场业务数据。
 */
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { BusyOverlay } from './ui/BusyOverlay.js'
import { withBusyOperation } from './ui/busy-operation.js'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchMcpBackend } from './api.js'
import { en, zh, type LocaleKey } from './locales.js'
import { PluginWorkspace } from './PluginWorkspace.js'
import { McpPluginCard } from './McpPluginCard.js'
import { credentialApi, type CredentialRemote } from './credentials.js'

const NS = 'dsh-agent-plugins-market'
const SETTINGS_NAMESPACE = 'dsh-agent-manage'
/** The module-loader banner supplies the emitted CSS without installing a global side effect. */
declare const __dshManageClientCss: string

export type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

/** The subset of the locale service this plugin touches. */
/** 中文：插件只依赖翻译注册/绑定能力，避免耦合宿主完整 locale 实现。 */
interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
  subscribe?: (listener: () => void) => () => void
}

/** The subset of the slots service this plugin touches. */
/** 中文：插件只依赖 slot 注册能力，具体页面容器由宿主提供。 */
interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: () => unknown): unknown
}

/** The subset of the host settings-scope service this plugin touches. */
/** 中文：只读取/写入市场设置命名空间，不直接操作宿主配置文件。 */
interface SettingsScopeService {
  bind(options: { namespace: string }): {
    getSnapshot(): { value?: { mcpEnhanced?: boolean; downloadRegion?: string; feedbackEnabled?: boolean; scanProjectLayouts?: boolean }; writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
  }
}

/** The client cordis context this plugin relies on (structural subset). */
/** 中文：声明客户端入口实际需要的最小 Cordis 能力集合。 */
interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void
  /** Resolve the current host's declared services within their lifetime. */
  /** 中文：在当前宿主声明的服务生命周期内接线。 */
  inject(services: string[], callback: (resolved: { settingsScope: SettingsScopeService; slots: SlotsService; effect(callback: () => unknown): void; agentWorkbench: {register(page: {id: string; label: () => string}): () => void} }) => void): void
  locale: LocaleService
  slots: SlotsService
  remote: { credentials: CredentialRemote }
}

export const name = 'dsh-agent-manage'
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

/**
 * Register the MCP enhancement card into the host's shared 插件配置 tab
 * (`settings.plugin.item`), the same seat dshmarket uses. Called through
 * `ctx.inject(['settingsScope'])` at apply time; a host without the
 * settingsScope service simply skips the card.
 */

/** Detect host primitives that predate the exports this UI relies on. */
/** 检查宿主是否提供市场 UI 依赖的基础组件，缺失时返回能力缺口。 */
export function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

/** 注册客户端插件的所有宿主效果，仅挂载当前宿主的设置槽位。 */
export function apply(ctx: SuiteClientContext): void {
  ctx.effect(() => {
    if (typeof document === 'undefined' || typeof __dshManageClientCss !== 'string') return
    const style = document.createElement('style')
    style.dataset.dshClient = 'dsh-agent-manage'
    style.dataset.plugin = 'dsh-agent-manage'
    style.textContent = __dshManageClientCss
    document.head.append(style)
    return () => style.remove()
  }, 'dsh-agent-manage: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-agent-plugins: dictionaries')
  const t = ctx.locale.bind(NS)
  const credentials = credentialApi(ctx.remote.credentials)

  const gaps = missingPrimitives(primitives as unknown as Record<string, unknown>)
  if (gaps.length > 0) {
    throw new Error(`UNSUPPORTED_HOST_UI_PRIMITIVES: ${gaps.join(', ')}`)
  }

  ctx.effect(() => {
    if (typeof document === 'undefined') return
    const element = document.createElement('div')
    element.dataset.agentPluginsBusyHost = ''
    document.body.append(element)
    const root = createRoot(element)
    root.render(h(BusyOverlay, { t }))
    return () => { root.unmount(); element.remove() }
  }, 'dsh-agent-plugins-market: operation overlay')


    // The host 插件配置 tab card. Registration rides the injected scope's slots
    // (the dshmarket / dsh-rewind pattern), and the card state binds the
    // market's settings namespace — the namespace the node half registers,
    // which is also what makes the tab serve our card at all.
    // 中文：配置卡注册依赖晚到的 settingsScope 和 slots；命名空间由节点侧注册后才真正提供卡片。
  // 中文：等待宿主晚到的 settingsScope；拿到后注册配置卡，并把持久化设置包装成卡片所需的 scope。
  ctx.inject(['settingsScope'], scoped => {
    const service = scoped.settingsScope
    const slots = scoped.slots
    const tCard = ctx.locale.bind(NS)
    const scope = service.bind({ namespace: SETTINGS_NAMESPACE })
    // 中文：下面的 scope 方法把宿主快照投影成卡片需要的读写接口，所有写入仍由 settingsScope 执行。
    slots.inject('settings.plugin.item', () =>
      slots.register({
        name: 'settings.plugin.item',
        key: SETTINGS_NAMESPACE,
        locale: NS,
        inject: () => ({ t: tCard }),
      }, () => h(McpPluginCard, {
        t: key => tCard(key as LocaleKey),
        scope: {
          enhanced: () => scope.getSnapshot().value?.mcpEnhanced !== false,
          writable: () => scope.getSnapshot().writable,
          subscribe: listener => scope.subscribe(listener),
          setEnhanced: next => withBusyOperation(() => scope.set('mcpEnhanced', next)),
          region: () => {
            const value = scope.getSnapshot().value?.downloadRegion
            return value === 'global' || value === 'china' ? value : 'auto'
          },
          setRegion: next => withBusyOperation(() => scope.set('downloadRegion', next)),
          feedbackEnabled: () => scope.getSnapshot().value?.feedbackEnabled !== false,
          setFeedbackEnabled: next => withBusyOperation(() => scope.set('feedbackEnabled', next)),
          scanProjectLayouts: () => scope.getSnapshot().value?.scanProjectLayouts !== false,
          setScanProjectLayouts: next => withBusyOperation(() => scope.set('scanProjectLayouts', next))
        },
        probe: () => fetchMcpBackend(),
      })),
    )
  })

  ctx.inject(['agentWorkbench'], scoped => {
    scoped.effect(() => scoped.agentWorkbench.register({id: 'agent-plugin-workspace', label: () => t('nav')}));
  });

  // Workbench discovers the public main entry; settings retains the same resource workspace.
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'agent-plugin-workspace',
  }, () => h('section', {className: 'agent-workbench-ui', style: {height: '100%'}}, h(PluginWorkspace, {t, credentials}))));

  // 中文：settings.section 是设置区工作台挂载位，由宿主声明生命周期管理。
  ctx.slots.inject('settings.section', () => {
    // One section, six top tabs (market / skills / commands / personas /
    // MCP / LSP) — the PluginWorkspace owns the tab row and per-tab scroll.
    // 中文：设置区只挂一个工作台入口，六个业务表面的标签和滚动由 PluginWorkspace 管理。
    const workspaceDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'agent-plugin-workspace',
      order: 45,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, () => h(PluginWorkspace, {
      t,
      credentials,
    }))
    return () => {
      if (typeof workspaceDispose === 'function') workspaceDispose()
    }
  })
}
export { pluginPackageVersion } from '../plugin-package-version.js'
