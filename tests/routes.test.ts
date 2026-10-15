import { describe, expect, it } from 'vitest'
import { MARKET_ROUTES } from '../src/contracts/market.js'
import { mountSuiteRoutes, type WebServerService } from '../src/routes.js'

function response() {
  let body = ''
  return {
    value: () => JSON.parse(body),
    writeHead: () => {},
    end: (value: string) => {
      body = value
    }
  }
}
function strictWebServer(routes: Map<string, (request: unknown, response: unknown) => void | Promise<void>>): WebServerService {
  return {
    register: route => {
      if (routes.has(route.path)) throw Error('duplicate route')
      routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
      return () => routes.delete(route.path)
    }
  }
}
function service() {
  return {
    runtime: {
      mcpBackendInfo: async () => ({ backend: 'builtin' as const, hostClient: { available: true }, downloadRegion: { setting: 'auto' as const, effective: 'global' as const } })
    }
  }
}

describe('Agent configuration support routes', () => {
  it('forwards exact model queries and returns reasoning options without provider configuration', async () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const calls: string[][] = []
    const llm = {
      listProviders: () => [{ id: 'p', apiKey: 'private' }],
      resolveModelInfo: async (provider: string, model: string) => {
        calls.push([provider, model])
        return { id: model, reasoning: { efforts: [{ id: 'high', name: 'High' }] } }
      }
    }
    const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes), get: () => llm }, service())
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.modelCatalog)!({ method: 'GET', url: `${MARKET_ROUTES.modelCatalog}?provider=p&model=vendor%2Fmodel` }, output)
      expect(calls).toEqual([['p', 'vendor/model']])
      expect(output.value()).toEqual({
        providers: [{ id: 'p', name: 'p' }],
        models: [{ id: 'vendor/model', name: 'vendor/model' }],
        reasoning: { efforts: [{ id: 'high', name: 'High' }] }
      })
    } finally {
      dispose()
    }
  })

  it('does not expose the retired global configuration and managed-source mutation routes', () => {
    const routes = new Map<string, (request: unknown, response: unknown) => void | Promise<void>>()
    const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes) }, service())
    for (const path of [
      'mcp-servers/add',
      'server-config/save',
      'set-mcp-override',
      'install',
      'set-surface',
      'lsp-servers/save',
      'user-panel/skills/update',
      'user-panel/agents/delete',
      'user-panel/commands/create'
    ]) {
      expect(routes.has(`/api/agent-plugins/${path}`)).toBe(false)
    }
    dispose()
    expect(routes.size).toBe(0)
  })
})
