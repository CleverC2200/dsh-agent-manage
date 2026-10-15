/** Read-only host support for Agent configuration; mutations use the Agent-owned routes. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { MARKET_ROUTES } from './contracts/market.js'
import type { McpBackendPayload } from './contracts/market.js'
import { readModelCatalog } from './runtime/model-catalog.js'

export interface WebServerService {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void> }): () => void
}
interface RouteHost {
  webServer: WebServerService
  get?(name: string): unknown
}

/** No generic resource or global service write route is registered here. */
export function mountSuiteRoutes(hostCtx: unknown, manager: { runtime: { mcpBackendInfo(): Promise<McpBackendPayload> } }): () => void {
  const host = hostCtx as RouteHost
  const disposers = [
    host.webServer.register({
      kind: 'exact',
      path: MARKET_ROUTES.modelCatalog,
      handler: async (request, response) => {
        try {
          const query = new URL(request.url ?? '/', 'http://localhost').searchParams
          sendJson(response, 200, await readModelCatalog(host, query.get('provider') || undefined, query.get('model') || undefined))
        } catch (error) {
          sendJson(response, 503, { error: error instanceof Error ? error.message : String(error) })
        }
      }
    }),
    host.webServer.register({
      kind: 'exact',
      path: MARKET_ROUTES.mcpBackend,
      handler: async (_request, response) => {
        sendJson(response, 200, await manager.runtime.mcpBackendInfo())
      }
    })
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}
