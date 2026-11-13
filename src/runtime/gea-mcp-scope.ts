export interface GeaScopeAgent {
  id?: string
  ctx: { tools: { restrict(filter: { deny: string[] }): () => void } }
}

export interface GeaScopeHost {
  agents: { list(): GeaScopeAgent[] }
  agentPresets: { composedPreset(ctx: GeaScopeAgent['ctx']): string | undefined }
  tools: {
    schemas(): { name: string }[]
    guard(check: (exec: { name: string; agent?: GeaScopeAgent }) => string | undefined): () => void
  }

  on(event: string, listener: () => void): () => void
}

function isGatewayTool(name: string): boolean {
  return name.startsWith('mcp__gea_gateway__') || name.startsWith('mcp__gea-gateway__')
}

export function restrictGeaMcp(host: GeaScopeHost, permits: (agent: GeaScopeAgent) => boolean, watch?: (listener: () => void) => () => void): () => void {
  const masks = new Map<GeaScopeAgent, { key: string; dispose: () => void }>()
  let updating = false
  let closed = false

  const allowed = (agent: GeaScopeAgent | undefined): boolean => agent !== undefined && permits(agent)
  const unguard = host.tools.guard(exec =>
    isGatewayTool(exec.name) && !allowed(exec.agent)
      ? 'GEA MCP requires an enabled business Agent and current GEA identity / GEA MCP 需要当前 GEA 身份、已启用的 Cube 引用与可用插件来源'
      : undefined
  )

  const sync = (): void => {
    if (closed || updating) return
    updating = true
    try {
      const names = host.tools
        .schemas()
        .map(tool => tool.name)
        .filter(isGatewayTool)
        .sort()
      const agents = new Set(host.agents.list())
      for (const [agent, mask] of masks) {
        if (!agents.has(agent)) {
          masks.delete(agent)
          mask.dispose()
        }
      }
      for (const agent of agents) {
        const deny = allowed(agent) ? [] : names
        const key = JSON.stringify(deny)
        const old = masks.get(agent)
        if (old?.key === key) continue

        const dispose = deny.length > 0 ? agent.ctx.tools.restrict({ deny }) : () => {}
        masks.set(agent, { key, dispose })
        old?.dispose()
      }
    } finally {
      updating = false
    }
  }
  const listeners = ['tools/change', 'agent/created', 'agent/disposed', 'agent-preset/selected'].map(event => host.on(event, sync))
  if (watch) listeners.push(watch(sync))
  try {
    sync()
  } catch (error) {
    closed = true
    listeners.forEach(dispose => dispose())
    masks.forEach(mask => mask.dispose())
    unguard()
    throw error
  }
  return () => {
    closed = true
    listeners.forEach(dispose => dispose())
    masks.forEach(mask => mask.dispose())
    masks.clear()
    unguard()
  }
}
