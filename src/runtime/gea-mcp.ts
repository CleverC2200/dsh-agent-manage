/** Optional login-owned GEA MCP contribution; independent of persisted suites. */
import { restrictGeaMcp, type GeaScopeHost } from './gea-mcp-scope.js'
import type { Context } from '@deepseek-ai/cordis'
import * as bridge from './mcp-client/bridge.js'
import type { StreamableHttpConfig } from './mcp-client/config.js'

/** Registered GEA Consumer whose granted tools are discovered after login. */
export interface GeaMcpConsumer {
  consumerType: 'AGENT' | 'CLIENT_APP'
  consumerCode: string
  /** Local DSH preset allowed to use these tools; defaults to gea-readonly. */
  agentPreset?: string
}

/** Versioned in-process capability exposed by dsh-gea-plugin, never a browser API. */
export interface GeaMcpService {
  version: 1
  defaultConsumer: GeaMcpConsumer
  authenticated(): boolean
  watch(listener: () => void): () => void
  open(consumer: GeaMcpConsumer, signal: AbortSignal): Promise<{ url: string; fetch: typeof fetch }>
}

interface Mount {
  await(): Promise<unknown>
  dispose(): void | Promise<void>
}

/** Follow login generations; abort first, dispose old mount, then publish the next. */
export function followGeaLogin(service: GeaMcpService, consumer: GeaMcpConsumer, mount: (config: StreamableHttpConfig) => Mount, warn: () => void): () => Promise<void> {
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
        const previous = current
        // Retain failed disposal ownership; never mount over a potentially live namespace.
        if (previous) {
          await previous.dispose()
          current = undefined
        }
        if (closed || signal.aborted || !service.authenticated()) return
        const connection = await service.open(consumer, signal)
        if (closed || signal.aborted || !service.authenticated()) return
        current = mount({
          transport: 'streamable-http',
          serverName: 'gea-gateway',
          url: connection.url,
          fetch: connection.fetch,
          headers: {},
          auth: { enabled: false },
          toolCallTimeoutMs: 60_000,
          startupTimeoutMs: 30_000,
          failOnStartupError: true,
          reconnect: { enabled: false }
        })
        try {
          await current.await()
        } catch {
          await current.dispose()
          current = undefined
          throw new Error('GEA_MCP_MOUNT_FAILED')
        }
      })
      .catch(() => {
        if (!signal.aborted && !closed) warn()
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

/** Bind only when the GEA provider and tools exist; other market surfaces remain available. */
export function mountGeaMcp(ctx: Context, consumer?: GeaMcpConsumer): void {
  ctx.inject(['geaMcp', 'tools', 'agents', 'agentPresets'], host => {
    const service = (host as unknown as { geaMcp: GeaMcpService }).geaMcp
    if (service.version !== 1) throw new Error('Unsupported GEA MCP service version')
    host.effect(() => {
      const stopScope = restrictGeaMcp(host as unknown as GeaScopeHost, consumer?.agentPreset ?? 'gea-readonly')
      const stopLogin = followGeaLogin(
        service,
        consumer ?? service.defaultConsumer,
        config => (host as unknown as { plugin(plugin: unknown, config: unknown): Mount }).plugin(bridge, config),
        () => host.logger?.warn('GEA MCP connection failed / GEA MCP 连接失败，请检查 Consumer 授权后重新登录。')
      )
      return async () => {
        await stopLogin()
        stopScope()
      }
    }, 'dsh-agent-manage: GEA login MCP lifecycle')
  })
}
