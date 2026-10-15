import type { UserAgentConfig } from './user-agents.js'

/** Host-generated source provenance, never trusted from a save request or package metadata. */
export interface AgentSourceBaseline {
  sourceId: string
  suiteId: string
  resourceKey: string
  url: string
  kind: 'git' | 'local' | 'archive'
  importPending?: boolean
  mcpReferences?: Array<{ serverKey: string; serverId: string; connectionId: string }>
  lockCommit?: string
  version?: string
  base: Pick<UserAgentConfig, 'name' | 'description' | 'prompt' | 'skills'>
}
export interface AgentSourceCandidate {
  suiteId: string
  resourceKey: string
  name: string
  description: string
  error?: string
}
export interface AgentSourceView {
  id: string
  url: string
  kind: 'git' | 'local' | 'archive'
  lockCommit?: string
  candidates: AgentSourceCandidate[]
  errors: string[]
}
export interface AcquireAgentSource {
  url: string
  kind: AgentSourceView['kind']
  branch?: string
  sha256?: string
}
export interface ImportSourceAgent {
  sourceId: string
  suiteId: string
  resourceKey: string
}
export const AGENT_SOURCE_ROUTES = {
  list: '/api/agent-manage/agent-sources',
  acquire: '/api/agent-manage/agent-sources/acquire',
  import: '/api/agent-manage/agent-sources/import',
  preview: '/api/agent-manage/agent-sources/preview',
  commit: '/api/agent-manage/agent-sources/commit',
  cancel: '/api/agent-manage/agent-sources/cancel'
} as const

/** A preview contains editable data only. MCP secrets remain in the Host. */
export interface AgentSourceConflict {
  key: string
  base: unknown
  local: unknown
  upstream: unknown
}
export interface AgentSourcePreview {
  token: string
  agentId: string
  conflicts: AgentSourceConflict[]
  changed?: boolean
  version?: string
  lockCommit?: string
}
export type AgentSourceResolution = { choice: 'local' | 'upstream' } | { choice: 'manual'; value: unknown }
export interface CommitAgentSource {
  token: string
  resolutions: Record<string, AgentSourceResolution>
}
