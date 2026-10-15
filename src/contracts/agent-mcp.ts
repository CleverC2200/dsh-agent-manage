/** Connection definitions are shared. Each Agent owns only its enabled association. */
export interface AgentMcpView {
  connectionId: string
  serverId: string
  name: string
  owner: 'user' | 'plugin'
  allowedOps: Array<'edit' | 'toggle' | 'remove'>
  enabled: boolean
  config: Record<string, unknown>
  state: 'saved' | 'connecting' | 'connected' | 'failed' | 'disabled' | 'needs-credentials'
  reason?: string
}
export interface SaveAgentMcp {
  agentId: string
  connectionId?: string
  serverId: string
  name: string
  config: Record<string, unknown>
}
export const AGENT_MCP_ROUTES = {
  mcpAvailable: '/api/agent-manage/agents/mcp/available',
  mcpList: '/api/agent-manage/agents/mcp/list',
  mcpSave: '/api/agent-manage/agents/mcp/save',
  mcpAssociate: '/api/agent-manage/agents/mcp/associate',
  mcpEnabled: '/api/agent-manage/agents/mcp/enabled',
  mcpRemove: '/api/agent-manage/agents/mcp/remove'
} as const
