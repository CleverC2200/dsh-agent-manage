/** Register the two Cube-New server schemas; GEA owns execution identity and transport. */
import type { Context } from '@deepseek-ai/cordis'
import { publicToolName, type ToolHost, type ToolDefinition } from './mcp-client/tools.js'
import { restrictGeaMcp, type GeaScopeHost } from './gea-mcp-scope.js'

export interface GeaMcpTool {
  name: 'inspect_cube_model' | 'query_business_data'
  description: string
  inputSchema: Record<string, unknown>
}

/** Host-only capability: credentials and Consumer selection remain in GEA. */
export interface GeaMcpService {
  version: 2
  authenticated(): boolean
  watch(listener: () => void): () => void
  allows(sessionId: string): boolean
  listTools(signal: AbortSignal): Promise<GeaMcpTool[]>
  call(sessionId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>
}
interface Mount {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Retire the old tool generation before publishing the next login's tools. */
export function followGeaLogin(service: GeaMcpService, mount: (tools: GeaMcpTool[], signal: AbortSignal) => Mount, warn: () => void): () => Promise<void> {
  let closed = false
  let generation = new AbortController()
  let current: Mount | undefined
  let queue = Promise.resolve()
  const changed = (): void => {
    generation.abort()
    generation = new AbortController()
    const signal = generation.signal
    queue = queue
      .then(async () => {
        if (current) {
          await current.dispose()
          current = undefined
        }
        if (closed || signal.aborted || !service.authenticated()) return
        const tools = await service.listTools(signal)
        if (closed || signal.aborted || !service.authenticated()) return
        current = mount(tools, signal)
        try {
          await current.await()
        } catch {
          await current.dispose()
          current = undefined
          throw Error('GEA_MCP_MOUNT_FAILED')
        }
      })
      .catch(() => {
        if (!closed && !signal.aborted) warn()
      })
  }
  const unwatch = service.watch(changed)
  changed()
  return async () => {
    closed = true
    generation.abort()
    unwatch()
    await queue
    await current?.dispose()
    current = undefined
  }
}

/** Publish server-qualified native MCP methods without another model-facing query wrapper. */
export function mountGeaMcp(ctx: Context): void {
  ctx.inject(['geaMcp', 'tools', 'agents', 'agentPresets'], host => {
    const service = (host as unknown as { geaMcp: GeaMcpService }).geaMcp
    if (service.version !== 2) throw Error('Unsupported GEA MCP service version')
    host.effect(() => {
      const stopScope = restrictGeaMcp(host as unknown as GeaScopeHost, agent => typeof agent.id === 'string' && service.allows(agent.id))
      const registry = (host as unknown as ToolHost).tools
      const stopLogin = followGeaLogin(
        service,
        tools => {
          const offs: Array<() => void> = []
          try {
            for (const tool of tools) {
              const definition: ToolDefinition = {
                name: publicToolName('gea-gateway', tool.name),
                description: tool.description,
                parameters: tool.inputSchema,
                output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
                async execute(args, exec) {
                  const agent = exec.agent
                  const id = agent && 'id' in agent && typeof agent.id === 'string' ? agent.id : undefined
                  if (!id || !service.allows(id)) throw Error('GEA_BUSINESS_PROFILE_REQUIRED')
                  if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('GEA_MCP_ARGUMENTS_INVALID')
                  // Discovery can refresh for another Session; GEA owns this call's identity and resource lifetime.
                  return service.call(id, tool.name, args as Record<string, unknown>, exec.signal)
                }
              }
              offs.push(registry.register(definition))
            }
          } catch (error) {
            offs.reverse().forEach(off => off())
            throw error
          }
          return {
            await: async () => {},
            dispose: () => {
              offs.reverse().forEach(off => off())
              offs.length = 0
            }
          }
        },
        () => host.logger?.warn('Cube-New MCP discovery failed; check the current login and published tool grants.')
      )
      return async () => {
        await stopLogin()
        stopScope()
      }
    }, 'dsh-agent-manage: Cube-New login lifecycle')
  })
}
