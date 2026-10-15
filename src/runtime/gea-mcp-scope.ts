/** 文件作用：按 Agent 预设限制 GEA MCP 工具的可见性和调用范围。 */
/** Agent-preset boundary for the login-owned gateway; never trusts prompt text. */
export interface GeaScopeAgent {
  id?: string
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
  /** 中文：监听宿主 Agent 事件，返回解除监听的函数。 */
  on(event: string, listener: () => void): () => void
}

/** Match the bridge namespace including normalized/truncated public names. */
/** 判断工具名是否属于 GEA 网关命名空间，兼容两种历史前缀。 */
function isGatewayTool(name: string): boolean {
  return name.startsWith('mcp__gea_gateway__') || name.startsWith('mcp__gea-gateway__')
}

/** Keep live and newly created agents masked, including preset switches and login refreshes. */
/** 安装工具守卫并同步现有 Agent 的 schema 屏蔽；返回一次性释放函数。 */
export function restrictGeaMcp(host: GeaScopeHost, permits: (agent: GeaScopeAgent) => boolean, watch?: (listener: () => void) => () => void): () => void {
  const masks = new Map<GeaScopeAgent, { key: string; dispose: () => void }>()
  let updating = false
  let closed = false
  /** 判断 Agent 是否使用被授权的 GEA preset，决定是否允许网关工具可见。 */
  const allowed = (agent: GeaScopeAgent | undefined): boolean => agent !== undefined && permits(agent)
  const unguard = host.tools.guard(exec =>
    isGatewayTool(exec.name) && !allowed(exec.agent)
      ? 'GEA MCP requires an enabled business Agent and current GEA identity / GEA MCP 需要已启用的业务 Agent 与当前 GEA 身份'
      : undefined
  )
  /** 根据当前 Agent 和工具 schema 快照刷新每个 Agent 的 GEA 工具屏蔽。 */
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
