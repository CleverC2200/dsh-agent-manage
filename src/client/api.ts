import { MARKET_ROUTES } from '../contracts/market.js'

export async function fetchModelCatalog(provider?: string, signal?: AbortSignal, model?: string): Promise<import('../contracts/market.js').ModelCatalogPayload> {
  const params = new URLSearchParams()
  if (provider !== undefined) params.set('provider', provider)
  if (model !== undefined) params.set('model', model)
  const query = params.size === 0 ? '' : `?${params}`
  const response = await fetch(`${MARKET_ROUTES.modelCatalog}${query}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`DSH model directory failed: ${response.status}`)
  return response.json() as Promise<import('../contracts/market.js').ModelCatalogPayload>
}

export interface McpBackendInfo {
  backend: 'builtin' | 'host'
  hostClient: { available: boolean; version?: string }
  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

/** 查询当前使用的 MCP 后端、宿主客户端可用性和下载区域。 */
export async function fetchMcpBackend(): Promise<McpBackendInfo> {
  const response = await fetch(MARKET_ROUTES.mcpBackend, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`mcp backend failed: ${response.status}`)
  return response.json() as Promise<McpBackendInfo>
}
