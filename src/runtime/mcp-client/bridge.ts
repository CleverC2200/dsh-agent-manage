import type { Context } from '@deepseek-ai/cordis'
import { resolveReconnectPolicy, startConnection, type ConnectionHandle } from './connection.js'
import { validateConfig } from './config.js'
import type { Config } from './config.js'
import type { ToolHost } from './tools.js'

export const name = 'market-mcp-client'

export const inject = ['tools']

const connections = new WeakMap<Context, Map<string, ConnectionHandle>>()

export function connectionState(root: Context, serverName: string) {
  return connections.get(root)?.get(serverName)?.state()
}

export function cancelAuthorization(root: Context, serverName: string): void {
  connections.get(root)?.get(serverName)?.cancelAuthorization()
}

const activeServerNames = new WeakMap<Context, Set<string>>()

function optionalService(ctx: Context, serviceName: 'credentials' | 'attachments' | 'llm'): unknown {
  try {
    const reader = ctx as unknown as { get?: (name: string) => unknown }
    const service = reader.get?.(serviceName)

    return service === null ? undefined : service
  } catch {
    return undefined
  }
}

function toToolHost(ctx: Context): ToolHost {
  const logger = {
    error: (message: string): void => {
      ctx.logger?.error?.(message)
    },
    warn: (message: string): void => {
      ctx.logger?.warn?.(message)
    },
    info: (message: string): void => {
      ctx.logger?.info?.(message)
    }
  }
  const registry = ctx as unknown as { tools?: { register?: (definition: unknown) => () => void } }
  return {
    logger,
    executionScope: (agent, serverName) => ctx.get('agentMcpScopes')?.executionScope(agent, serverName),
    tools: {
      register(definition) {
        const register = registry.tools?.register
        if (typeof register !== 'function') {
          throw new Error('the host context does not expose a tool registry — the "tools" service is required')
        }
        return register.call(registry.tools, definition)
      }
    },
    getService: serviceName => optionalService(ctx, serviceName)
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  validateConfig(config)
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)

  ctx.effect(() => {
    let names = activeServerNames.get(ctx.root)
    if (!names) {
      names = new Set()
      activeServerNames.set(ctx.root, names)
    }
    if (names.has(config.serverName)) {
      throw new Error(`market-mcp-client: serverName "${config.serverName}" is already in use by another bridge instance — pick a unique serverName`)
    }
    names.add(config.serverName)
    return () => void names.delete(config.serverName)
  }, 'market-mcp-client.serverName')

  const host = toToolHost(ctx)
  const credentials = optionalService(ctx, 'credentials')
  const connection = startConnection(host, config, reconnect, credentials)

  let active = connections.get(ctx.root)
  if (!active) {
    active = new Map()
    connections.set(ctx.root, active)
  }
  active.set(config.serverName, connection)
  ctx.effect(() => {
    return async () => {
      await connection.dispose()
      active.delete(config.serverName)
    }
  }, 'market-mcp-client.connection')

  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}
