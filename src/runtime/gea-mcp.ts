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
  identitySignal(): AbortSignal
  watch(listener: () => void): () => void
  allows(sessionId: string): boolean
  listTools(signal: AbortSignal): Promise<GeaMcpTool[]>
  call(sessionId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>
}
interface Mount {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Runtime publication state shared by login events and first-request admission. */
export interface GeaLoginRuntime {
  readonly revision: number
  ready(signal?: AbortSignal): Promise<void>
  dispose(): Promise<void>
}

/** Prepare same-identity refreshes before replacing tools; revoke changed identities first. */
export function followGeaLogin(service: GeaMcpService, mount: (tools: GeaMcpTool[], signal: AbortSignal) => Mount, warn: () => void): GeaLoginRuntime {
  let closed = false
  let generation = new AbortController()
  let current: { mount: Mount; identity: AbortSignal } | undefined
  let revision = 0
  let failure: Error | undefined
  let queue = Promise.resolve()
  const retire = async (): Promise<void> => {
    if (current === undefined) return
    await current.mount.dispose()
    current = undefined
    revision++
  }
  const changed = (): Promise<void> => {
    generation.abort()
    generation = new AbortController()
    const identity = service.identitySignal()
    const signal = AbortSignal.any([generation.signal, identity])
    queue = queue
      .then(async () => {
        if (closed || signal.aborted) return
        if (current !== undefined && (current.identity !== identity || !service.authenticated())) await retire()
        if (!service.authenticated()) {
          failure = undefined
          return
        }
        const tools = await service.listTools(signal)
        if (closed || signal.aborted || !service.authenticated()) return
        await retire()
        current = { mount: mount(tools, identity), identity }
        try {
          await current.mount.await()
          revision++
          failure = undefined
        } catch {
          await retire()
          throw Error('GEA_MCP_MOUNT_FAILED')
        }
      })
      .catch(error => {
        if (!closed && !signal.aborted) {
          failure = error instanceof Error ? error : Error(String(error))
          warn()
        }
      })
    return queue
  }
  const unwatch = service.watch(changed)
  void changed()
  return {
    get revision() {
      return revision
    },
    async ready(signal) {
      let observed: Promise<void>
      do {
        signal?.throwIfAborted()
        observed = queue
        if (signal === undefined) await observed
        else {
          const aborted = Promise.withResolvers<never>()
          const abort = () => aborted.reject(signal.reason)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          try {
            await Promise.race([observed, aborted.promise])
          } finally {
            signal.removeEventListener('abort', abort)
          }
        }
      } while (observed !== queue && !closed)
      signal?.throwIfAborted()
      if (closed) throw Error('GEA_MCP_DISPOSED')
      if (failure !== undefined) throw failure
    },
    async dispose() {
      closed = true
      generation.abort()
      unwatch()
      await queue
      await retire()
    }
  }
}

/** Publish server-qualified native MCP methods without another model-facing query wrapper. */
export function mountGeaMcp(ctx: Context): void {
  ctx.inject(['geaMcp', 'tools', 'agents', 'agentPresets', 'systemPrompt'], host => {
    const service = (host as unknown as { geaMcp: GeaMcpService }).geaMcp
    if (service.version !== 2) throw Error('Unsupported GEA MCP service version')
    host.effect(() => {
      const stopScope = restrictGeaMcp(
        host as unknown as GeaScopeHost,
        agent => typeof agent.id === 'string' && service.allows(agent.id),
        listener => service.watch(listener)
      )
      const registry = (host as unknown as ToolHost).tools
      const login = followGeaLogin(
        service,
        (tools, identity) => {
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
                  identity.throwIfAborted()
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
      // Core collects tool providers before its assembly waterfall. Capture that
      // publication revision, await discovery, and ask Core to assemble again only
      // when it collected an older generation. Core still owns scope, PTC and order.
      const observed = new WeakMap<object, number>()
      const stopCapture = host.systemPrompt.tools(context => {
        observed.set(context, login.revision)
        return { schemas: [] }
      })
      const stopAssembly = host.on(
        'system-prompt/assemble',
        async (_assembly, context, next) => {
          const agent = context.agent
          if (agent === undefined || !service.allows(agent.id)) return next()
          await login.ready(context.signal)
          if (observed.get(context) !== login.revision) return host.systemPrompt.assemble(context)
          return next()
        },
        true
      )
      return async () => {
        stopAssembly()
        stopCapture()
        await login.dispose()
        stopScope()
      }
    }, 'dsh-agent-manage: Cube-New login lifecycle')
  })
}
