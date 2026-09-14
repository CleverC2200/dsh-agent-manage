/** Agent-preset boundary for the login-owned gateway; never trusts prompt text. */
export interface GeaScopeAgent {
  ctx: { tools: { restrict(filter: { deny: string[] }): () => void } }
}

/** Minimal host capability needed to mask schemas and deny stale tool calls. */
export interface GeaScopeHost {
  agents: { list(): GeaScopeAgent[] }
  agentPresets: { composedPreset(ctx: GeaScopeAgent['ctx']): string | undefined }
  tools: {
    schemas(): { name: string }[]
    guard(check: (exec: { name: string; agent?: GeaScopeAgent }) => string | undefined): () => void
  }
  on(event: string, listener: () => void): () => void
}

/** Match the bridge namespace including normalized/truncated public names. */
function isGatewayTool(name: string): boolean {
  return name === 'gea_sales_plan_read' || name.startsWith('mcp__gea_gateway__') || name.startsWith('mcp__gea-gateway__')
}

/** Keep live and newly created agents masked, including preset switches and login refreshes. */
export function restrictGeaMcp(host: GeaScopeHost, preset: string): () => void {
  if (preset.trim() === '') throw new Error('GEA MCP requires a non-empty agent preset')
  const masks = new Map<GeaScopeAgent, { key: string; dispose: () => void }>()
  let updating = false
  let closed = false
  const allowed = (agent: GeaScopeAgent | undefined): boolean => agent !== undefined && host.agentPresets.composedPreset(agent.ctx) === preset
  const unguard = host.tools.guard(exec =>
    isGatewayTool(exec.name) && !allowed(exec.agent) ? 'GEA MCP is restricted to the demand forecast agent / GEA MCP 仅限需求预测 Agent 使用' : undefined
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
        // Install replacement first, so a tool generation never opens a visibility gap.
        const dispose = deny.length > 0 ? agent.ctx.tools.restrict({ deny }) : () => {}
        masks.set(agent, { key, dispose })
        old?.dispose()
      }
    } finally {
      updating = false
    }
  }
  const listeners = ['tools/change', 'agent/created', 'agent/disposed', 'agent-preset/selected'].map(event => host.on(event, sync))
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
