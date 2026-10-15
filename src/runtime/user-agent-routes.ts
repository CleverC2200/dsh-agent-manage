import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { AGENT_MCP_ROUTES } from '../contracts/agent-mcp.js'
import { USER_AGENT_ROUTES } from '../contracts/user-agents.js'
import { readJsonRequest, RequestBodyTooLarge } from './request-body.js'
import type { UserAgents } from './user-agents.js'

/** Authenticated Host Fetch routes share the same complete configuration module as publication. */
export function mountUserAgentRoutes(host: Pick<Context, 'connection' | 'effect'>, agents: UserAgents): void {
  const action = z.object({ id: z.uuid(), enabled: z.boolean() })
  const selection = z.object({ id: z.uuid() }).strict()
  for (const [path, method] of Object.entries({ ...USER_AGENT_ROUTES, ...AGENT_MCP_ROUTES })) {
    const mutation = path !== 'list'
    host.effect(() =>
      host.connection.fetch.register({
        path: method,
        methods: [mutation ? 'POST' : 'GET'],
        requestBody: mutation ? 'streaming' : 'buffered',
        fetch: async request => {
          try {
            const origin = request.headers.get('origin')
            if (mutation && origin && origin !== new URL(request.url).origin) return Response.json({ error: 'CROSS_ORIGIN_REQUEST' }, { status: 403 })
            let result: unknown
            if (path === 'list') result = await agents.list()
            else {
              const input = await readJsonRequest(request)
              if (path.startsWith('mcp') && !agents.mcp) throw Error('AGENT_MCP_RUNTIME_UNAVAILABLE')
              if (path === 'mcpAvailable') result = agents.mcp!.available(z.object({ agentId: z.uuid() }).strict().parse(input).agentId)
              else if (path === 'mcpList') result = await agents.mcp!.list(z.object({ agentId: z.uuid() }).strict().parse(input).agentId)
              else if (path === 'mcpSave') result = await agents.mcp!.save(input)
              else if (path === 'mcpAssociate') result = await agents.mcp!.associate(input)
              else if (path === 'mcpEnabled') result = await agents.mcp!.setEnabled(input)
              else if (path === 'mcpRemove') result = await agents.mcp!.remove(input)
              else if (path === 'save') result = await agents.save(input)
              else if (path === 'enabled') {
                const { id, enabled } = action.parse(input)
                result = await agents.setEnabled(id, enabled)
              } else result = await agents.select(selection.parse(input).id)
            }
            return Response.json(result, { headers: { 'cache-control': 'no-store' } })
          } catch (error) {
            return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 })
          }
        }
      })
    )
  }
}
