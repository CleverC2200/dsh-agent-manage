import { createElement as h, type ReactNode } from 'react'
import type { Translate } from './index.js'
import { UserAgentWorkspace } from './UserAgentWorkspace.js'
import type { SkillEditorSession } from '../contracts/skill-editor.js'

export interface PluginWorkspaceProps {
  t: Translate
  surface?: 'main' | 'settings'
  startAgent?: (preset: string) => Promise<void>
  openEditor?: (session: SkillEditorSession) => Promise<void>

}

export function PluginWorkspace(props: PluginWorkspaceProps): ReactNode {
  return h(UserAgentWorkspace, { t: props.t, startAgent: props.startAgent, openEditor: props.openEditor, surface: props.surface })
}

