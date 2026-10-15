/** Shared Agent configuration entry for main and settings. */
import { createElement as h, type ReactNode } from 'react'
import type { Translate } from './index.js'
import { UserAgentWorkspace } from './UserAgentWorkspace.js'


export interface PluginWorkspaceProps {
  t: Translate
  surface?: 'main' | 'settings'
  startAgent?: (preset: string) => Promise<void>
  /** The host surface controls only outer spacing; data and actions stay shared. */
  /** 中文：宿主挂载面只负责外层布局，具体面板数据仍由各组件管理。 */
}

/** The complete Agent editor has one implementation across public seats. */
export function PluginWorkspace(props: PluginWorkspaceProps): ReactNode {
  return h(UserAgentWorkspace, { t: props.t, startAgent: props.startAgent, surface: props.surface })
}

