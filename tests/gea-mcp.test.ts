import { expect, it, vi } from 'vitest'
import { followGeaLogin, type GeaMcpService } from '../src/runtime/gea-mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createTransport } from '../src/runtime/mcp-client/transport.js'

const consumer = { consumerType: 'AGENT' as const, consumerCode: 'test-agent' }
function fixture() {
  let authenticated = false
  let listener = () => {}
  const service: GeaMcpService = {
    version: 1,
    defaultConsumer: consumer,
    authenticated: () => authenticated,
    watch: callback => {
      listener = callback
      return () => {
        listener = () => {}
      }
    },
    open: vi.fn(async () => ({ url: 'https://gea.test/mcp', fetch }))
  }
  const dispose = vi.fn()
  const mount = vi.fn(() => ({ await: async () => {}, dispose }))
  const warn = vi.fn()
  const stop = followGeaLogin(service, consumer, mount, warn)
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

it('does no discovery before login, mounts after login and disposes on logout', async () => {
  const f = fixture()
  await Promise.resolve()
  expect(f.service.open).not.toHaveBeenCalled()
  f.login(true)
  await vi.waitFor(() => expect(f.mount).toHaveBeenCalledTimes(1))
  const signal = vi.mocked(f.service.open).mock.calls[0][1]
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
  let resolve!: (value: { url: string; fetch: typeof fetch }) => void
  vi.mocked(f.service.open).mockImplementation(
    () =>
      new Promise(done => {
        resolve = done
      })
  )
  f.login(true)
  await vi.waitFor(() => expect(f.service.open).toHaveBeenCalledTimes(1))
  f.login(false)
  resolve({ url: 'https://gea.test/mcp', fetch })
  await f.stop()
  expect(f.mount).not.toHaveBeenCalled()
})

it('contains denied discovery without blind session recreation', async () => {
  const f = fixture()
  vi.mocked(f.service.open).mockRejectedValue(new Error('denied'))
  f.login(true)
  await vi.waitFor(() => expect(f.warn).toHaveBeenCalledOnce())
  expect(f.mount).not.toHaveBeenCalled()
  expect(f.service.open).toHaveBeenCalledOnce()
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
  expect(f.service.open).toHaveBeenCalledOnce()
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
  expect(f.service.open).toHaveBeenCalledOnce()
  await f.stop()
  expect(f.dispose).toHaveBeenCalledTimes(2)
})
