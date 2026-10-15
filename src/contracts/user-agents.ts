/** A provider reference keeps source ownership; a content override is personal to this Agent. */
export type UserAgentSkill =
  | { kind: 'reference'; name: string; provider: string; path?: string; enabled: boolean; content?: string }
  | { kind: 'personal'; name: string; description: string; content: string; enabled: boolean }
export interface TrustedCubeSource { sourceRef: string; name: string; enabled: boolean; available: boolean }
export interface UserAgentSkillOption { name: string; description: string; provider: string; path?: string }

/** Complete personal Agent configuration; distinct from a reusable subagent role. */
export interface UserAgentConfig {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
  revision: number
  skills: UserAgentSkill[]
  cube?: { sourceRef: string; enabled: boolean }
}

export interface UserAgentView extends UserAgentConfig {
  origin: 'user'
  preset: string
  publication: 'ready' | 'disabled' | 'failed'
  error?: string
}
export type SaveUserAgent = Pick<UserAgentConfig, 'name' | 'description' | 'prompt' | 'enabled'> & { id?: string }
export const USER_AGENT_ROUTES = {
  list: '/api/agent-manage/agents',
  save: '/api/agent-manage/agents/save',
  enabled: '/api/agent-manage/agents/enabled',
  select: '/api/agent-manage/agents/select',
  skillCatalog: '/api/agent-manage/agents/skills/catalog',
  skillRead: '/api/agent-manage/agents/skills/read',
  skills: '/api/agent-manage/agents/skills/save',
  cubeSources: '/api/agent-manage/agents/cube/sources',
  cubeSave: '/api/agent-manage/agents/cube/save',
  cubeEnabled: '/api/agent-manage/agents/cube/enabled',
  pluginCopy: '/api/agent-manage/agents/plugin/copy'
} as const
