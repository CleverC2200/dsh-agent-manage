/** Complete personal Agent configuration; distinct from a reusable subagent role. */
export interface UserAgentConfig {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
  revision: number
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
  select: '/api/agent-manage/agents/select'
} as const
