import { USER_AGENT_ROUTES, type SaveUserAgent, type UserAgentView, type UserAgentSkill, type UserAgentSkillOption } from '../contracts/user-agents.js'
export type { UserAgentView, SaveUserAgent, UserAgentSkill, UserAgentSkillOption }

async function request<T>(path: string, value?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  })
  const body = await response.json()
  if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`)
  return body as T
}
export const userAgentApi = {
  list: () => request<UserAgentView[]>(USER_AGENT_ROUTES.list),
  skillCatalog: (signal?: AbortSignal) => request<UserAgentSkillOption[]>(USER_AGENT_ROUTES.skillCatalog, undefined, signal),
  readSkill: (skill: UserAgentSkillOption, signal?: AbortSignal) => request<{ content: string }>(`${USER_AGENT_ROUTES.skillRead}?${new URLSearchParams({ name: skill.name, provider: skill.provider, ...(skill.path ? { path: skill.path } : {}) })}`, undefined, signal),
  saveSkills: (id: string, skills: UserAgentSkill[], signal?: AbortSignal) => request<UserAgentView>(USER_AGENT_ROUTES.skills, { id, skills }, signal),
  save: (value: SaveUserAgent) => request<UserAgentView>(USER_AGENT_ROUTES.save, value),
  setEnabled: (id: string, enabled: boolean) => request<UserAgentView>(USER_AGENT_ROUTES.enabled, { id, enabled }),
  select: (id: string) => request<{ preset: string }>(USER_AGENT_ROUTES.select, { id })
}
