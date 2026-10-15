import { AGENT_SOURCE_ROUTES, type AcquireAgentSource, type AgentSourceView, type ImportSourceAgent, type AgentSourcePreview, type CommitAgentSource } from '../contracts/agent-sources.js'
import type { UserAgentView } from '../contracts/user-agents.js'

async function request<T>(path: string, value?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
  })
  const body = await response.json()
  if (!response.ok) throw Error(body.error ?? `HTTP ${response.status}`)
  return body as T
}
export const agentSourceApi = {
  list: () => request<AgentSourceView[]>(AGENT_SOURCE_ROUTES.list),
  acquire: (value: AcquireAgentSource, signal?: AbortSignal) => request<AgentSourceView>(AGENT_SOURCE_ROUTES.acquire, value, signal),
  import: (value: ImportSourceAgent, signal?: AbortSignal) => request<UserAgentView>(AGENT_SOURCE_ROUTES.import, value, signal),
  preview: (id: string, signal?: AbortSignal) => request<AgentSourcePreview>(AGENT_SOURCE_ROUTES.preview, { id }, signal),
  commit: (value: CommitAgentSource, signal?: AbortSignal) => request<UserAgentView>(AGENT_SOURCE_ROUTES.commit, value, signal),
  cancel: (token: string) => request<{ cancelled: true }>(AGENT_SOURCE_ROUTES.cancel, { token })
}
