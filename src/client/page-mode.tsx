/**
 * Legacy Web page-mode adapter.
 *
 * Current DSH compositions expose `settings.section`; older compositions that
 * predate that slot can still host a top-level market panel through the DOM
 * shell used by the original page-mode integration. The adapter is deliberately
 * guarded by the live settings-slot state so one composition never renders two
 * market surfaces.
 *
 * 文件作用：为没有 `settings.section` 能力的旧版宿主提供市场页面回退挂载。
 * 业务职责：监听宿主 DOM 和设置能力变化，维护侧边栏入口、会话区面板及其清理生命周期，避免与新版设置面板重复渲染。
 */
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PluginWorkspace } from './PluginWorkspace.js'
import { shouldUseLegacyPageMode } from './page-mode-selection.js'
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import css from './market.module.css'

/** Browser-side inputs required by the legacy page-mode adapter. */
/** 旧版适配器所需的浏览器端能力和依赖，均由宿主入口传入。 */
export interface LegacyPageModeOptions {
  /** Current namespace-bound translator. */
  /** 中文：当前设置命名空间绑定的翻译器，供旧版入口和面板使用。 */
  t: Translate
  /** Host credentials wire used for write-only MCP env configuration. */
  /** 中文：宿主凭据线仅用于 MCP 引用的写入，不读取 secret。 */
  credentials?: CredentialApi
  /** Whether the host has mounted a live `settings.section` declaration. */
  /** 中文：宿主是否已有正式 settings.section；存在时旧版回退必须关闭。 */
  isSettingsSurfaceAvailable: () => boolean
  /** Optional locale revision subscription supplied by newer hosts. */
  /** 中文：新宿主可提供语言版本订阅，触发入口和面板文案刷新。 */
  subscribeLocale?: (listener: () => void) => () => void
}

const ACTIVE_ATTRIBUTE = 'data-dsh-agent-plugins-market-page'
const VIEW_ATTRIBUTE = 'data-dsh-agent-plugins-market-page-view'
const ENTRY_ATTRIBUTE = 'data-dsh-agent-plugins-market-entry'
const SURFACE_EVENT = 'dsh-agent-plugins-market-settings-surface'
const PANEL_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'agent-plugins-market'

/** Notify the page adapter that the settings-slot capability changed. */
/** 中文：能力变化事件通知旧版适配器重新计算是否需要回退挂载。 */
export const LEGACY_PAGE_MODE_SURFACE_EVENT = SURFACE_EVENT
const SIDEBAR_COLUMN_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const SIDEBAR_CONTEXT_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'

/**
 * Mount the page-mode fallback and its sidebar entry.
 *
 * The fallback remains dormant when the settings surface is present. It also
 * remains a no-op in non-browser runtimes or shells that expose neither the
 * sidebar nor the conversation column.
 *
 * @param options - page-mode dependencies and host capability probe.
 * @returns disposer that removes the injected entry, panel, listeners, and
 * active document marker.
 */
/** 挂载旧版页面入口并返回完整清理函数；无浏览器壳时保持安全空操作。 */
export function mountLegacyPageMode(options: LegacyPageModeOptions): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}

  let stopped = false
  let open = false
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let entry: HTMLButtonElement | undefined
  let entryLabel: HTMLSpanElement | undefined
  let observer: MutationObserver | undefined

  /** 卸载旧版页面 React 根节点和容器，保持 DOM 回到宿主状态。 */
  const unmountView = (): void => {
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }

  /** 更新回退面板开关，并在宿主已有正式设置面板时强制关闭。 */
  const setActive = (next: boolean): void => {
    open = next
    if (open && !options.isSettingsSurfaceAvailable()) {
      document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, '')
      document.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE)
      unmountView()
    }
  }

  /** 关闭旧版市场视图并清理其 React 容器。 */
  const removeView = (): void => {
    setActive(false)
  }

  /** 用最新翻译和凭据依赖渲染旧版市场工作台。 */
  const renderView = (): void => {
    if (root === undefined) return
    root.render(h(PluginWorkspace, { t: options.t, credentials: options.credentials, mode: 'page' }))
  }

  /** 更新侧边栏入口的标题和无障碍文案。 */
  const updateEntryCopy = (): void => {
    if (entryLabel === undefined || entry === undefined) return
    const label = options.t('nav')
    entryLabel.textContent = label
    entry.title = label
    entry.setAttribute('aria-label', label)
  }

  /** 检查旧版会话列是否存在，并在需要时挂载市场工作台。 */
  const ensureView = (): void => {
    if (stopped || options.isSettingsSurfaceAvailable()) {
      removeView()
      return
    }
    if (!open) return
    const column = conversationColumn()
    if (!shouldUseLegacyPageMode(options.isSettingsSurfaceAvailable(), column !== undefined)) {
      removeView()
      return
    }
    if (column === undefined) return
    if (container !== undefined && container.isConnected) return
    root?.unmount()
    container?.remove()
    container = document.createElement('div')
    container.setAttribute(VIEW_ATTRIBUTE, '')
    container.className = css.pageView
    column.appendChild(container)
    root = createRoot(container)
    renderView()
  }

  /** 确保旧版侧边栏存在唯一市场入口，并放在新建会话按钮之后。 */
  const ensureEntry = (): void => {
    if (stopped || options.isSettingsSurfaceAvailable()) {
      entry?.remove()
      return
    }
    const rootElement = sidebarRoot()
    const anchor = rootElement === undefined ? undefined : newSessionButton(rootElement)
    if (rootElement === undefined || anchor === undefined || anchor.parentElement === null) return
    if (entry === undefined) {
      entry = createEntry(() => { setActive(!open); ensureView() })
      entryLabel = entry.querySelector<HTMLSpanElement>('[data-dsh-agent-plugins-market-label]') ?? undefined
      updateEntryCopy()
    }
  // Other plugins share this anchor; competing for its immediate next sibling
  // creates an endless MutationObserver loop across their adapters.
  // 中文：多个插件共享锚点，只允许稳定插入位置，避免观察器互相触发无限循环。
    if (entry.parentElement !== anchor.parentElement) {
      anchor.insertAdjacentElement('afterend', entry)
    }
  }

  /** 监听宿主 DOM 重建，以便侧边栏/会话列变化后自动恢复挂载。 */
  const observeShell = (): void => {
    if (stopped || observer !== undefined || options.isSettingsSurfaceAvailable()) return
    observer = new MutationObserver(records => {
      if (records.some(record => !container?.contains(record.target) && !entry?.contains(record.target))) ensure()
    })
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
  }

  /** 停止旧版宿主 DOM 观察，避免卸载后继续响应变化。 */
  const stopObservingShell = (): void => {
    observer?.disconnect()
    observer = undefined
  }

  /** 统一协调正式设置面板与旧版回退的互斥挂载状态。 */
  const ensure = (): void => {
    if (stopped) return
    if (options.isSettingsSurfaceAvailable()) {
      stopObservingShell()
      removeView()
      entry?.remove()
      return
    }
    observeShell()
    ensureView()
    ensureEntry()
  }

  /** 语言切换后刷新入口文案和已打开的市场视图。 */
  const onLocale = (): void => {
    updateEntryCopy()
    renderView()
  }
  /** 响应新版设置面板能力变化，重新计算回退是否应存在。 */
  const onSurfaceChange = (): void => { ensure() }
  const unsubscribeLocale = options.subscribeLocale?.(onLocale)
  /** 当其他宿主面板激活时关闭旧版市场，保持页面级面板互斥。 */
  const onPanelActivate = (event: Event): void => {
    const detail = (event as CustomEvent<string>).detail
    if (detail !== PANEL_NAME && open) setActive(false)
  }
  /** 点击侧边栏会话/项目上下文时退出市场回退页，回到宿主原生内容。 */
  const onSidebarContextClick = (event: MouseEvent): void => {
    if (!open) return
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest(SIDEBAR_CONTEXT_SELECTOR) === null) return
    setActive(false)
  }

  document.addEventListener(PANEL_EVENT, onPanelActivate)
  document.addEventListener(SURFACE_EVENT, onSurfaceChange)
  document.addEventListener('click', onSidebarContextClick, true)
  queueMicrotask(ensure)

  return () => {
    stopped = true
    unsubscribeLocale?.()
    document.removeEventListener(PANEL_EVENT, onPanelActivate)
    document.removeEventListener(SURFACE_EVENT, onSurfaceChange)
    document.removeEventListener('click', onSidebarContextClick, true)
    stopObservingShell()
    entry?.remove()
    removeView()
  }
}

/** 从宿主侧边栏 DOM 中定位可插入市场入口的根节点。 */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>(SIDEBAR_COLUMN_SELECTOR)
  if (column === null) return undefined
  return column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
    ?? (column.firstElementChild as HTMLElement | null)
    ?? undefined
}

/** 在侧边栏根节点中定位“新建会话”按钮作为插入锚点。 */
function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child instanceof HTMLButtonElement) return child
  }
  return undefined
}

/** 定位旧版宿主的会话内容列，作为市场面板容器。 */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/** 创建带图标和点击行为的旧版市场侧边栏入口。 */
function createEntry(onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute(ENTRY_ATTRIBUTE, '')
  button.className = css.pageEntry
  button.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>'
  const label = document.createElement('span')
  label.dataset.dshAgentPluginsMarketLabel = ''
  button.append(label)
  button.addEventListener('click', onClick)
  return button
}
