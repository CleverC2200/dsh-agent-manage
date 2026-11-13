import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { BusyOverlay } from './ui/BusyOverlay.js'
import { withBusyOperation } from './ui/busy-operation.js'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchMcpBackend } from './api.js'
import { en, zh, type LocaleKey } from './locales.js'
import { PluginWorkspace } from './PluginWorkspace.js'
import { McpPluginCard } from './McpPluginCard.js'
import type { SkillEditorSession } from '../contracts/skill-editor.js'
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client'

const NS = 'dsh-agent-plugins-market'
const SETTINGS_NAMESPACE = 'dsh-agent-manage'

declare const __dshManageClientCss: string

export type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

interface LocaleService {
  register(namespace: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): unknown
  bind(namespace: string): Translate
  subscribe?: (listener: () => void) => () => void
}

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(meta: Record<string, unknown>, component: (props: SettingsSectionOwnerProps) => unknown): unknown
}

interface SettingsScopeService {
  bind(options: { namespace: string }): {
    getSnapshot(): { value?: { mcpEnhanced?: boolean; downloadRegion?: string; feedbackEnabled?: boolean; scanProjectLayouts?: boolean }; writable: boolean }
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
  }
}

interface SuiteClientContext {
  effect(callback: () => unknown, label?: string): void

  inject(services: string[], callback: (resolved: { settingsScope: SettingsScopeService; slots: SlotsService; effect(callback: () => unknown): void; agentWorkbench: {register(page: {id: string; label: () => string}): () => void; startAgent(preset: string): Promise<void>; openAgentSession(session: SkillEditorSession): Promise<void>} }) => void): void
  locale: LocaleService
  slots: SlotsService
}

export const name = 'dsh-agent-manage'
export const inject = ['slots', 'locale']
export const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Modal', 'Toast', 'Tooltip'] as const

export function missingPrimitives(module: Record<string, unknown>, required: readonly string[] = REQUIRED_PRIMITIVES): string[] {
  return required.filter(name => module[name] === undefined)
}

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

  ctx.inject(['settingsScope'], scoped => {
    const service = scoped.settingsScope
    const slots = scoped.slots
    const tCard = ctx.locale.bind(NS)
    const scope = service.bind({ namespace: SETTINGS_NAMESPACE })

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

  let beginAgent: ((preset: string) => Promise<void>) | undefined
  let beginEditor: ((session: SkillEditorSession) => Promise<void>) | undefined
  const openEditor = async (session: SkillEditorSession) => { if (!beginEditor) throw Error(t('agentHostUnavailable')); await beginEditor(session) }
  const startAgent = async (preset: string) => {
    if (!beginAgent) throw Error(t('agentHostUnavailable'))
    await beginAgent(preset)
  }
  ctx.inject(['agentWorkbench'], scoped => {
    beginAgent = preset => scoped.agentWorkbench.startAgent(preset)
    beginEditor = session => scoped.agentWorkbench.openAgentSession(session)
    scoped.effect(() => () => { beginAgent = undefined; beginEditor = undefined })
    scoped.effect(() => scoped.agentWorkbench.register({id: 'agent-plugin-workspace', label: () => t('nav')}));
  });

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'agent-plugin-workspace',
  }, () => h('section', {className: 'agent-workbench-ui', style: {height: '100%'}}, h(PluginWorkspace, {t, startAgent, openEditor}))));

  ctx.slots.inject('settings.section', () => {

    const workspaceDispose = ctx.slots.register({
      name: 'settings.section',
      id: 'agent-plugin-workspace',
      order: 45,
      label: () => t('nav'),
      locale: NS,
      inject: () => ({ t }),
    }, ({ close }) => h(PluginWorkspace, {
      t,
      startAgent: async preset => { await startAgent(preset); close() },
      openEditor: async session => { await openEditor(session); close() },
      surface: 'settings',
    }))
    return () => {
      if (typeof workspaceDispose === 'function') workspaceDispose()
    }
  })
}
export { pluginPackageVersion } from '../plugin-package-version.js'
