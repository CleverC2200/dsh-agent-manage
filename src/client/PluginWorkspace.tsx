/**
 * The plugin workspace: one page, six top tabs.
 *
 * The market, skills, commands, agent personas, MCP services, and LSP
 * servers panels all render inside this shell, so the settings sidebar keeps
 * a single "Agent Plugins" entry and users switch surfaces with the tab row.
 * Each tab's content scrolls inside its own region (never the settings
 * column), which removes the scrollbar show/hide jitter when tabs with
 * different content heights swap.
 *
 * 文件作用：承载 Agent Plugins 市场的统一工作台和顶层标签页。
 * 业务职责：维护当前标签、深链接同步和各业务面板的路由，不复制各面板的数据或请求逻辑。
 * @module client/PluginWorkspace
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import { MarketSection } from './MarketSection.js'
import { McpStatusPanel } from './McpStatusPanel.js'
import { LspStatusPanel } from './LspStatusPanel.js'
import { UserPanelSurface } from './ui/UserPanelSurface.js'
import css from './workspace.module.css'

/** The six workspace tabs in display order. */
/** 中文：六个业务表面的固定展示顺序，深链接和标签栏共用。 */
export type WorkspaceTab = 'market' | 'skills' | 'commands' | 'personas' | 'mcp' | 'lsp'

const TAB_ORDER: ReadonlyArray<WorkspaceTab> = ['market', 'skills', 'commands', 'personas', 'mcp', 'lsp']

export interface PluginWorkspaceProps {
  t: Translate
  credentials?: CredentialApi
  /** The host surface controls only outer spacing; data and actions stay shared. */
  /** 中文：宿主挂载面只负责外层布局，具体面板数据仍由各组件管理。 */
  mode?: 'settings' | 'page'
}

/** One page with six top tabs; state is local so switching is instant. */
/** 渲染六个顶层业务标签，并同步 hash 深链接和当前宿主能力。 */
export function PluginWorkspace({ t, credentials, mode = 'settings' }: PluginWorkspaceProps): ReactNode {
  const [active, setActive] = useState<WorkspaceTab>('market')

  // Deep links: a `#/agent-plugins/<tab>` hash selects the tab directly, and
  // a tab click writes the hash back (guarded — replaceState keeps the
  // session history clean) so a copied URL reopens on the same tab.
  // 中文：hash 深链接支持直接打开标签；replaceState 不污染浏览器历史。
  // 中文：使用 replaceState 保持浏览器历史干净，复制的链接仍能恢复相同标签。
  // 中文：初始化和监听地址栏 hash，使外部深链接能打开指定标签；点击标签只更新当前工作台的 hash。
  useEffect(() => {
    /** 读取地址栏深链接并同步工作台标签，供初始化和 hashchange 事件共同调用。 */
    const applyHash = (): void => {
      const match = /^#\/agent-plugins\/(\w+)$/.exec(typeof window === 'undefined' ? '' : window.location.hash)
      if (match === null) return
      const tab = match[1] as WorkspaceTab
      if (TAB_ORDER.includes(tab)) setActive(tab)
    }
    applyHash()
    if (typeof window === 'undefined') return
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  /** 切换工作台标签并把当前标签写入无历史记录的深链接。 */
  const select = (tab: WorkspaceTab): void => {
    setActive(tab)
    if (typeof window === 'undefined' || typeof window.history === 'undefined') return
    try {
      window.history.replaceState(null, '', `#/agent-plugins/${tab}`)
    } catch {
      // Sandboxed contexts may refuse history writes; the tab still switches.
      // 中文：沙盒环境可能禁止写 history，但本地标签切换仍必须成功。
    }
  }

  const labelKeys: Record<WorkspaceTab, string> = {
    market: t('workspaceTabMarket'),
    skills: t('workspaceTabSkills'),
    commands: t('workspaceTabCommands'),
    personas: t('workspaceTabPersonas'),
    mcp: t('workspaceTabMcp'),
    lsp: t('workspaceTabLsp')
  }

  return h(
    'div',
    { className: mode === 'page' ? `${css.workspace} ${css.pageMode}` : css.workspace, 'data-agent-plugins-workspace': true },
    h(
      'nav',
      { className: css.tabRow, role: 'tablist' },
      TAB_ORDER.map(tab =>
        h(
          'button',
          {
            key: tab,
            type: 'button',
            role: 'tab',
            'aria-selected': active === tab,
            className: active === tab ? css.tabOn : css.tab,
            onClick: () => select(tab)
          },
          labelKeys[tab]
        )
      )
    ),
    h('div', { className: css.tabPanel, role: 'tabpanel' }, renderTab(active, t, credentials, mode))
  )
}

/** 把标签标识映射为对应业务面板，统一传递翻译器、凭据和宿主模式。 */
function renderTab(tab: WorkspaceTab, t: Translate, credentials: CredentialApi | undefined, mode: 'settings' | 'page'): ReactNode {
  switch (tab) {
    case 'market':
      return h(MarketSection, { t, credentials, mode })
    case 'skills':
      return h(UserPanelSurface, { t, kind: 'skills' })
    case 'commands':
      return h(UserPanelSurface, { t, kind: 'commands', hint: t('commandsPanelHint') })
    case 'personas':
      return h(UserPanelSurface, { t, kind: 'agents' })
    case 'mcp':
      return h(McpStatusPanel, { t, credentials })
    case 'lsp':
      return h(LspStatusPanel, { t })
  }
}
