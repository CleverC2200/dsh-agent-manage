import { expect, it, vi } from 'vitest'
import { followGeaLogin, mountGeaMcp, type GeaMcpService } from '../src/runtime/gea-mcp.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '../src/runtime/mcp-client/tools.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createTransport } from '../src/runtime/mcp-client/transport.js'

function fixture() {
  let authenticated = false
  let listener = () => {}
  const service: GeaMcpService = {
    version: 2,
    authenticated: () => authenticated,
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
  const stop = followGeaLogin(service, mount, warn)
  return {
    service,
    mount,
    dispose,
    warn,
    stop,
    login: (next: boolean) => {
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
  refresh()
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
  expect(f.service.listTools).toHaveBeenCalledOnce()
  await f.stop()
  expect(f.dispose).toHaveBeenCalledTimes(2)
})
