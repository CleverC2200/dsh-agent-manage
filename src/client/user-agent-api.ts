import { USER_AGENT_ROUTES, type SaveUserAgent, type UserAgentView } from '../contracts/user-agents.js'
export type { UserAgentView, SaveUserAgent }

async function request<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  })
  const body = await response.json()
  if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`)
  return body as T
}
export const userAgentApi = {
  list: () => request<UserAgentView[]>(USER_AGENT_ROUTES.list),
  save: (value: SaveUserAgent) => request<UserAgentView>(USER_AGENT_ROUTES.save, value),
  setEnabled: (id: string, enabled: boolean) => request<UserAgentView>(USER_AGENT_ROUTES.enabled, { id, enabled }),
  select: (id: string) => request<{ preset: string }>(USER_AGENT_ROUTES.select, { id })
}
