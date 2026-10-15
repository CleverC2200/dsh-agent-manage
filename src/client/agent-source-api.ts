import { AGENT_SOURCE_ROUTES, type AcquireAgentSource, type AgentSourceView, type ImportSourceAgent } from '../contracts/agent-sources.js'
import type { UserAgentView } from '../contracts/user-agents.js'

async function request<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  })
  const body = await response.json()
  if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`)
  return body as T
}
export const agentSourceApi = {
  list: () => request<AgentSourceView[]>(AGENT_SOURCE_ROUTES.list),
  acquire: (value: AcquireAgentSource) => request<AgentSourceView>(AGENT_SOURCE_ROUTES.acquire, value),
  import: (value: ImportSourceAgent) => request<UserAgentView>(AGENT_SOURCE_ROUTES.import, value)
}
