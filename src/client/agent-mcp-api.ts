import { AGENT_MCP_ROUTES, type AgentMcpView, type SaveAgentMcp } from '../contracts/agent-mcp.js'
import { request } from './user-agent-api.js'
export const agentMcpApi = {
  available: (agentId: string) => request<Array<Pick<AgentMcpView, 'connectionId' | 'serverId' | 'name'>>>(AGENT_MCP_ROUTES.mcpAvailable, { agentId }),
  associate: (agentId: string, connectionId: string) => request<AgentMcpView[]>(AGENT_MCP_ROUTES.mcpAssociate, { agentId, connectionId, enabled: true }),
  list: (agentId: string) => request<AgentMcpView[]>(AGENT_MCP_ROUTES.mcpList, { agentId }),
  save: (input: SaveAgentMcp) => request<AgentMcpView>(AGENT_MCP_ROUTES.mcpSave, input),
  setEnabled: (agentId: string, connectionId: string, enabled: boolean) => request<AgentMcpView[]>(AGENT_MCP_ROUTES.mcpEnabled, { agentId, connectionId, enabled }),
  remove: (agentId: string, connectionId: string) => request<AgentMcpView[]>(AGENT_MCP_ROUTES.mcpRemove, { agentId, connectionId })
}
