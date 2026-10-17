import { expect, it, vi } from 'vitest'
import { followGeaLogin, mountGeaMcp, type GeaMcpService } from '../src/runtime/gea-mcp.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '../src/runtime/mcp-client/tools.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createTransport } from '../src/runtime/mcp-client/transport.js'

function fixture() {
  let authenticated = false
  let identity = new AbortController()
  let listener = () => {}
  const service: GeaMcpService = {
    version: 2,
    authenticated: () => authenticated,
    identitySignal: () => identity.signal,
    watch: callback => {
      listener = callback
      return () => {
        listener = () => {}
      }
    },
    allows: () => true,
    call: vi.fn(async () => '{}'),
    listTools: vi.fn(async () => [])
  }
  const dispose = vi.fn()
  const mount = vi.fn(() => ({ await: async () => {}, dispose }))
  const warn = vi.fn()
  const runtime = followGeaLogin(service, mount, warn)
  const stop = () => runtime.dispose()
  return {
    service,
    runtime,
    mount,
    dispose,
    warn,
    stop,
    switchIdentity: () => {
      identity.abort()
      identity = new AbortController()
      authenticated = true
      listener()
    },
    login: (next: boolean) => {
      if (authenticated !== next) {
        identity.abort()
        identity = new AbortController()
      }
      authenticated = next
      listener()
    }
  }
}

it('registers only the two original schemas and executes with the calling Core Session', async () => {
  const definitions = new Map<string, ToolDefinition>()
  const signal = new AbortController().signal
  const inputSchema = { type: 'object', properties: { queries: { type: 'array' } }, required: ['queries'] }
  let dispose!: () => Promise<void>
  const call = vi.fn<GeaMcpService['call']>(async () => '{"status":"completed"}')
  let refresh = () => {}
  const service: GeaMcpService = {
    version: 2,
    authenticated: () => true,
    identitySignal: () => signal,
    watch: listener => {
      refresh = listener
      return () => {}
    },
    allows: id => ['sales-session', 'dealer-session'].includes(id),
    listTools: async () => [
      { name: 'inspect_cube_model', description: 'inspect', inputSchema: { type: 'object' } },
      { name: 'query_business_data', description: 'query', inputSchema }
    ],
    call
  }
  const host = {
    geaMcp: service,
    systemPrompt: { tools: () => () => {} },
    agents: { list: () => [] },
    agentPresets: {},
    tools: {
      schemas: () => [...definitions.values()],
      guard: () => () => {},
      register: (definition: ToolDefinition) => {
        definitions.set(definition.name, definition)
        return () => {
          definitions.delete(definition.name)
        }
      }
    },
    on: () => () => {},
    effect: (start: () => () => Promise<void>) => {
      dispose = start()
    },
    inject: (_keys: string[], callback: (value: unknown) => void) => callback(host)
  }
  mountGeaMcp(host as unknown as Context)
  await vi.waitFor(() => expect(definitions.size).toBe(2))
  expect([...definitions.keys()]).toEqual(['mcp__gea-gateway__inspect_cube_model', 'mcp__gea-gateway__query_business_data'])
  const query = definitions.get('mcp__gea-gateway__query_business_data')!
  expect(query.parameters).toBe(inputSchema)
  const args = { queries: [{ name: 'test', query: { limit: 1 } }] }
  for (const id of ['sales-session', 'dealer-session']) {
    await query.execute(args, { signal, agent: { id } } as Parameters<ToolDefinition['execute']>[1])
    expect(call.mock.calls.at(-1)?.slice(0, 3)).toEqual([id, 'query_business_data', args])
  }
  await expect(query.execute(args, { signal })).rejects.toThrow('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(call).toHaveBeenCalledTimes(2)
  let finish!: (result: string) => void
  call.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  const inFlight = query.execute(args, { signal, agent: { id: 'sales-session' } } as Parameters<ToolDefinition['execute']>[1])
  const requestSignal = call.mock.calls.at(-1)?.[3]
  expect(requestSignal).toBe(signal)
  let discoveryStarted!: () => void
  const started = new Promise<void>(resolve => {
    discoveryStarted = resolve
  })
  let finishDiscovery!: () => void
  const discovery = new Promise<void>(resolve => {
    finishDiscovery = resolve
  })
  const priorTools = service.listTools
  service.listTools = async signal => {
    discoveryStarted()
    await discovery
    return priorTools(signal)
  }
  refresh()
  await started
  try {
    expect(definitions.size).toBe(2)
  } finally {
    finishDiscovery()
  }
  expect(requestSignal?.aborted).toBe(false)
  await vi.waitFor(() => expect(definitions.size).toBe(2))
  finish('retained-session-result')
  expect(await inFlight).toBe('retained-session-result')
  await dispose()
  expect(definitions.size).toBe(0)
})

it('does no discovery before login, mounts after login and disposes on logout', async () => {
  const f = fixture()
  await Promise.resolve()
  expect(f.service.listTools).not.toHaveBeenCalled()
  f.login(true)
  await vi.waitFor(() => expect(f.mount).toHaveBeenCalledTimes(1))
  const signal = vi.mocked(f.service.listTools).mock.calls[0][0]
  f.login(false)
  expect(signal.aborted).toBe(true)
  await vi.waitFor(() => expect(f.dispose).toHaveBeenCalledTimes(1))
  f.login(true)
  await vi.waitFor(() => expect(f.mount).toHaveBeenCalledTimes(2))
  await f.stop()
  expect(f.dispose).toHaveBeenCalledTimes(2)
  f.login(true)
  expect(f.mount).toHaveBeenCalledTimes(2)
})

it('discards a late session after logout even when the provider ignores abort', async () => {
  const f = fixture()
  let resolve!: (value: []) => void
  vi.mocked(f.service.listTools).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  f.login(true)
  await vi.waitFor(() => expect(f.service.listTools).toHaveBeenCalledTimes(1))
  f.login(false)
  resolve([])
  await f.stop()
  expect(f.mount).not.toHaveBeenCalled()
})

it('contains denied discovery without blind session recreation', async () => {
  const f = fixture()
  vi.mocked(f.service.listTools).mockRejectedValue(new Error('denied'))
  f.login(true)
  await vi.waitFor(() => expect(f.warn).toHaveBeenCalledOnce())
  expect(f.mount).not.toHaveBeenCalled()
  expect(f.service.listTools).toHaveBeenCalledOnce()
  await expect(f.runtime.ready()).resolves.toBeUndefined()
  await f.stop()
})

it('passes the in-process fetch to real MCP SDK handshake and discovery', async () => {
  const requests: string[] = []
  const injectedFetch: typeof fetch = async (_input, init) => {
    if (init?.method === 'GET') return new Response(null, { status: 405 })
    const message = JSON.parse(String(init?.body))
    requests.push(message.method)
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result = message.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'gea', version: '1' } } : { tools: [] }
    return Response.json({ jsonrpc: '2.0', id: message.id, result }, { headers: { 'MCP-Session-Id': 'transport' } })
  }
  const { transport } = createTransport({
    transport: 'streamable-http',
    serverName: 'gea-gateway',
    url: 'https://gea.test/mcp',
    headers: {},
    fetch: injectedFetch,
    auth: { enabled: false },
    toolCallTimeoutMs: 1000,
    failOnStartupError: true
  })
  const client = new Client({ name: 'test', version: '1' })
  try {
    await client.connect(transport)
    await client.listTools()
    expect(requests).toEqual(['initialize', 'notifications/initialized', 'tools/list'])
  } finally {
    await client.close()
  }
})

it('cleans a failed bridge activation and never retries the business session automatically', async () => {
  const f = fixture()
  f.mount.mockImplementation(() => ({
    await: async () => {
      throw new Error('startup failed')
    },
    dispose: f.dispose
  }))
  f.login(true)
  await vi.waitFor(() => expect(f.warn).toHaveBeenCalledOnce())
  expect(f.dispose).toHaveBeenCalledOnce()
  expect(f.service.listTools).toHaveBeenCalledOnce()
  await expect(f.runtime.ready()).rejects.toThrow('GEA_MCP_MOUNT_FAILED')
  f.runtime.retryDiscovery()
  expect(f.service.listTools).toHaveBeenCalledOnce()
  await f.stop()
})

it('refuses a new namespace while an old mount failed disposal', async () => {
  const f = fixture()
  f.login(true)
  await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
  f.dispose.mockImplementationOnce(() => {
    throw new Error('dispose failed')
  })
  f.login(true)
  await vi.waitFor(() => expect(f.warn).toHaveBeenCalledOnce())
  expect(f.mount).toHaveBeenCalledOnce()
  expect(f.service.listTools).toHaveBeenCalledTimes(2)
  await expect(f.runtime.ready()).rejects.toThrow('dispose failed')
  vi.mocked(f.service.listTools).mockRejectedValueOnce(Error('discovery unavailable'))
  f.login(true)
  await vi.waitFor(() => expect(f.warn).toHaveBeenCalledTimes(2))
  await expect(f.runtime.ready()).rejects.toThrow('dispose failed')
  await f.stop()
  expect(f.dispose).toHaveBeenCalledTimes(2)
})

it('publishes both original schemas in the first real Core assembly while discovery is still pending', async () => {
  const { official } = await import('./core-preset-harness.js')
  const { Context } = await official('@deepseek-ai/cordis')
  const { default: SystemPrompt } = await official('@deepseek-ai/dsh-system-prompt')
  const { default: Tools } = await official('@deepseek-ai/dsh-tools')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  const identity = new AbortController()
  let finish!: (tools: Awaited<ReturnType<GeaMcpService['listTools']>>) => void
  let started!: () => void
  const discoveryStarted = new Promise<void>(resolve => {
    started = resolve
  })
  const service: GeaMcpService = {
    version: 2,
    authenticated: () => true,
    identitySignal: () => identity.signal,
    watch: () => () => {},
    allows: id => id === 'business-session',
    listTools: () => {
      started()
      return new Promise(resolve => {
        finish = resolve
      })
    },
    call: async () => '{}'
  }
  ctx.provide('agents', { list: () => [] })
  ctx.provide('agentPresets', {})
  ctx.provide('geaMcp', service)
  try {
    await ctx.plugin({ apply: mountGeaMcp })
    await discoveryStarted
    const agent = { id: 'business-session' }
    const assembly = ctx.systemPrompt.assemble({ agent, scope: agent, signal: new AbortController().signal })
    finish([
      { name: 'inspect_cube_model', description: 'inspect', inputSchema: { type: 'object' } },
      { name: 'query_business_data', description: 'query', inputSchema: { type: 'object', properties: { queries: { type: 'array' } }, required: ['queries'] } }
    ])
    expect((await assembly).tools.map(tool => tool.name)).toEqual(['mcp__gea-gateway__inspect_cube_model', 'mcp__gea-gateway__query_business_data'])
  } finally {
    await ctx.fiber.dispose()
  }
})

it('retires an old identity before discovering its replacement and rejects cancelled readiness', async () => {
  const f = fixture()
  f.login(true)
  await f.runtime.ready()
  const oldIdentity = f.mount.mock.calls[0][1]
  let started!: () => void
  const discovering = new Promise<void>(resolve => {
    started = resolve
  })
  let finish!: (tools: []) => void
  vi.mocked(f.service.listTools).mockImplementation(() => {
    started()
    return new Promise(resolve => {
      finish = resolve
    })
  })
  f.switchIdentity()
  await discovering
  expect(oldIdentity.aborted).toBe(true)
  expect(f.dispose).toHaveBeenCalledOnce()
  expect(f.mount).toHaveBeenCalledOnce()
  const controller = new AbortController()
  const pending = f.runtime.ready(controller.signal)
  const cancelled = Error('turn cancelled')
  controller.abort(cancelled)
  try {
    await expect(pending).rejects.toBe(cancelled)
  } finally {
    finish([])
  }
  await f.runtime.ready()
  expect(f.mount).toHaveBeenCalledTimes(2)
  await f.stop()
})

it('joins a pending discovery retry and cancels only the requesting waiter', async () => {
  const f = fixture()
  vi.mocked(f.service.listTools).mockRejectedValueOnce(Error('discovery unavailable'))
  f.login(true)
  await f.runtime.ready()
  let finish!: (tools: []) => void
  vi.mocked(f.service.listTools).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  f.runtime.retryDiscovery()
  await vi.waitFor(() => expect(f.service.listTools).toHaveBeenCalledTimes(2))
  const signal = vi.mocked(f.service.listTools).mock.calls[1][0]
  f.runtime.retryDiscovery()
  const controller = new AbortController()
  const cancelled = f.runtime.ready(controller.signal)
  const retained = f.runtime.ready()
  const reason = Error('caller cancelled')
  controller.abort(reason)
  await expect(cancelled).rejects.toBe(reason)
  expect(signal.aborted).toBe(false)
  expect(f.service.listTools).toHaveBeenCalledTimes(2)
  finish([])
  await retained
  expect(f.mount).toHaveBeenCalledOnce()
  await f.stop()
})

it('keeps a real Core Session running after discovery failure and recovers its tools on fresh input', async () => {
  const { presetHarness, completion, agentOn, turn } = await import('./core-preset-harness.js')
  const f = await presetHarness()
  const identity = new AbortController()
  const listeners = new Set<() => void>()
  let healthy = false
  const listTools = vi.fn<GeaMcpService['listTools']>(async () => {
    if (!healthy) throw Error('discovery unavailable')
    return [{ name: 'query_business_data', description: 'query', inputSchema: { type: 'object' } }]
  })
  const call = vi.fn<GeaMcpService['call']>(async () => '{"status":"completed"}')
  const service: GeaMcpService = {
    version: 2,
    authenticated: () => true,
    identitySignal: () => identity.signal,
    watch: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    allows: id => id === 'discovery-recovery',
    listTools,
    call
  }
  f.ctx.provide('geaMcp', service)
  await f.ctx.plugin({ apply: mountGeaMcp })
  const requests = await completion(f.ctx, 262_144, true)
  const agent = await agentOn(f.ctx, 'discovery-recovery', 'standard')
  await turn(f.ctx, agent, 'Continue the independent todo task while discovery is unavailable.')
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(requests.length).toBeGreaterThanOrEqual(2)
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).toContain('todo_write')
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(agent.session.snapshotEvents().find(event => event.type === 'tool/result')).toMatchObject({ data: { message: { isError: false } } })
  expect(call).not.toHaveBeenCalled()
  const failedAttempts = listTools.mock.calls.length
  await f.ctx.systemPrompt.assemble({ agent, scope: agent })
  expect(listTools).toHaveBeenCalledTimes(failedAttempts)

  healthy = true
  await turn(f.ctx, agent, 'Discover the tools again for this same Session.')
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).toContain('mcp__gea-gateway__query_business_data')
  expect(listTools).toHaveBeenCalledTimes(failedAttempts + 1)
  const executed = await f.ctx.tools.execute({
    callId: 'recovered-query' as never,
    name: 'mcp__gea-gateway__query_business_data',
    arguments: {},
    agent,
    signal: new AbortController().signal
  })
  expect(executed.isError).toBe(false)
  expect(executed.value).toBe('{"status":"completed"}')

  healthy = false
  for (const listener of [...listeners]) listener()
  await turn(f.ctx, agent, 'Keep using the current authorized tools while refresh is unavailable.')
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).toContain('mcp__gea-gateway__query_business_data')
})
