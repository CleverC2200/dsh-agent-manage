import { EventEmitter } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { inspectToolRegistry } from '../src/runtime/tool-registry-observer.js'
import { LoopbackOAuthClientProvider, mcpAuthRecordKey } from '../src/runtime/mcp-client/oauth.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { agentOn, presetHarness } from './core-preset-harness.js'

const opened = vi.hoisted(() => [] as URL[])
// The native browser launch is the external effect. MCP, OAuth and the loopback callback remain real.
vi.mock('node:child_process', async importOriginal => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    spawn: (...args: Parameters<typeof original.spawn>) => {
      if (args[0] !== 'open' && args[0] !== 'xdg-open' && args[0] !== 'cmd') return original.spawn(...args)
      const values = args[1] as string[]
      opened.push(new URL(values.at(-1)!))
      const child = Object.assign(new EventEmitter(), { unref() {} })
      queueMicrotask(() => child.emit('spawn'))
      return child
    }
  }
})

async function configuration() {
  const { ctx, home } = await presetHarness()
  const catalog = new Catalog({
    userRoot: join(home, 'catalog'),
    dataRoot: home,
    onChanged: async () => {},
    runtime: {
      ctx,
      translate: key => key,
      backend: async () => 'builtin',
      writeBackend: async () => {},
      tools: () => inspectToolRegistry(ctx.tools),
      deleteGrantRecord: async name => {
        await ctx.credentials.deleteRecord(mcpAuthRecordKey(name) as never)
      }
    }
  })
  await catalog.load()
  const agents = new UserAgents(ctx, join(home, 'user-agents.json'), catalog.runtime)
  await agents.load()
  onTestFinished(async () => {
    await agents.dispose()
    await catalog.runtime.dispose()
  })
  const first = await agents.save({ name: 'Configured', prompt: 'Configured', enabled: true })
  const second = await agents.save({ name: 'Other', prompt: 'Other', enabled: true })
  return { ctx, home, agents, first, second }
}

it('shows pending OAuth separately from a saved connection and permits cancellation and reauthorization', async () => {
  opened.length = 0
  let base = ''
  let exchangeFails = false
  const methods: string[] = []
  const server = createServer(async (request, response) => {
    const json = (value: unknown, status = 200) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    if (request.url?.includes('/.well-known/'))
      return json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      })
    if (request.url === '/resource') return json({ resource: `${base}/mcp`, authorization_servers: [base] })
    if (request.url === '/register') return json({ client_id: 'controlled-client', redirect_uris: ['http://127.0.0.1:0/callback'] })
    if (request.url === '/token') {
      let body = ''
      for await (const chunk of request) body += chunk
      if (new URLSearchParams(body).get('redirect_uri') !== opened.at(-1)?.searchParams.get('redirect_uri')) return json({ error: 'invalid_request' }, 400)
      return exchangeFails ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'controlled-access', token_type: 'Bearer' })
    }
    if (request.url !== '/mcp' || request.method !== 'POST') return response.writeHead(405).end()
    if (request.headers.authorization !== 'Bearer controlled-access') return response.writeHead(401, { 'www-authenticate': `Bearer resource_metadata="${base}/resource"` }).end()
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    methods.push(body.method)
    if (body.id === undefined) return response.writeHead(202).end()
    return json({
      jsonrpc: '2.0',
      id: body.id,
      result:
        body.method === 'initialize'
          ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'oauth', version: '1' } }
          : { tools: [{ name: 'authorized', inputSchema: { type: 'object' } }] }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('LOCAL_ADDRESS')
  base = `http://127.0.0.1:${address.port}`
  const { ctx, agents, first, second } = await configuration()
  const unrelated = new LoopbackOAuthClientProvider(
    'unrelated',
    {},
    undefined,
    () => {},
    ctx.credentials,
    async () => {}
  )
  const unrelatedTokens = { access_token: 'preserved-other-access', token_type: 'Bearer', issuer: base }
  await unrelated.saveTokens(unrelatedTokens)
  expect(await unrelated.tokens()).toEqual(unrelatedTokens)
  const pending = agents.mcp!.save({ agentId: first.id, serverId: 'oauth', name: 'OAuth', config: { type: 'streamable-http', url: `${base}/mcp`, auth: { enabled: true } } })
  let saved: Awaited<typeof pending>
  try {
    await vi.waitFor(() => expect(opened.length).toBe(1))
    expect((await agents.mcp!.list(first.id))[0]?.state).toBe('awaiting-authorization')
    saved = await pending
  } finally {
    if (opened[0]) await fetch(`${opened[0].searchParams.get('redirect_uri')}?error=access_denied`).catch(() => {})
    await pending
  }
  expect(saved!.state).toBe('awaiting-authorization')
  await vi.waitFor(async () => expect((await agents.mcp!.list(first.id))[0]?.state).toBe('authorization-cancelled'))
  await agents.mcp!.reauthorize({ agentId: first.id, connectionId: saved!.connectionId })
  await vi.waitFor(() => expect(opened.length).toBe(2))
  await agents.mcp!.cancelAuthorization({ agentId: first.id, connectionId: saved!.connectionId })
  await vi.waitFor(async () => expect((await agents.mcp!.list(first.id))[0]?.state).toBe('authorization-cancelled'))
  await expect(fetch(`${opened[1].searchParams.get('redirect_uri')}?code=abandoned`)).rejects.toThrow()
  exchangeFails = true
  await agents.mcp!.reauthorize({ agentId: first.id, connectionId: saved!.connectionId })
  await vi.waitFor(() => expect(opened.length).toBe(3))
  await fetch(`${opened[2].searchParams.get('redirect_uri')}?code=rejected`)
  await vi.waitFor(async () => expect((await agents.mcp!.list(first.id))[0]?.state).toBe('authorization-failed'))
  exchangeFails = false
  await agents.mcp!.reauthorize({ agentId: first.id, connectionId: saved!.connectionId })
  await vi.waitFor(() => expect(opened.length).toBe(4))
  await fetch(`${opened[3].searchParams.get('redirect_uri')}?code=approved`)
  await vi.waitFor(async () => expect((await agents.mcp!.list(first.id))[0]?.state).toBe('connected'))
  expect(methods).toEqual(expect.arrayContaining(['initialize', 'tools/list']))
  const selected = await agentOn(ctx, 'selected-oauth', first.preset)
  const other = await agentOn(ctx, 'other-oauth', second.preset)
  expect(ctx.tools.schemas(selected).some(tool => tool.name.endsWith('__authorized'))).toBe(true)
  expect(ctx.tools.schemas(other).some(tool => tool.name.endsWith('__authorized'))).toBe(false)
  const authorized = new LoopbackOAuthClientProvider(
    'user-mcp__oauth',
    {},
    undefined,
    () => {},
    ctx.credentials,
    async () => {}
  )
  expect(await authorized.tokens()).toMatchObject({ access_token: 'controlled-access' })
  await agents.mcp!.reauthorize({ agentId: first.id, connectionId: saved!.connectionId })
  await vi.waitFor(() => expect(opened.length).toBe(5))
  expect(await authorized.tokens()).toBeUndefined()
  expect(await unrelated.tokens()).toEqual(unrelatedTokens)
  await agents.mcp!.cancelAuthorization({ agentId: first.id, connectionId: saved!.connectionId })
})

it('connects SSE then replaces it with stdio using separate command, args, cwd and env', async () => {
  let stream: ServerResponse | undefined
  const methods: string[] = []
  const streamClosed = Promise.withResolvers<void>()
  const server = createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/sse') {
      stream = response
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write('event: endpoint\ndata: /messages\n\n')
      request.on('close', () => streamClosed.resolve())
      return
    }
    if (request.method !== 'POST' || request.url !== '/messages') return response.writeHead(405).end()
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    methods.push(body.method)
    response.writeHead(202).end()
    if (body.id === undefined) return
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'controlled-sse', version: '1' } }
        : { tools: [{ name: 'from_sse', inputSchema: { type: 'object' } }] }
    stream!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => {
    stream?.end()
    return new Promise<void>(resolve => server.close(() => resolve()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('LOCAL_ADDRESS')
  const { ctx, agents, first, second, home } = await configuration()
  const saved = await agents.mcp!.save({
    agentId: first.id,
    serverId: 'transports',
    name: 'Transports',
    config: { type: 'sse', url: `http://127.0.0.1:${address.port}/sse`, auth: { enabled: false }, custom: { preserved: true } }
  })
  expect(saved.state).toBe('connected')
  expect(methods).toEqual(expect.arrayContaining(['initialize', 'tools/list']))
  const selected = await agentOn(ctx, 'selected-transport', first.preset)
  const other = await agentOn(ctx, 'other-transport', second.preset)
  expect(ctx.tools.schemas(selected).some(tool => tool.name.endsWith('__from_sse'))).toBe(true)
  expect(ctx.tools.schemas(other).some(tool => tool.name.endsWith('__from_sse'))).toBe(false)
  const cwd = join(home, 'working directory')
  await mkdir(cwd)
  const script = join(home, 'controlled-mcp.mjs')
  await writeFile(
    script,
    `import { createInterface } from 'node:readline';
const methods = [];
createInterface({ input: process.stdin }).on('line', line => {
  const body = JSON.parse(line); methods.push(body.method);
  if (body.id === undefined) return;
  const result = body.method === 'initialize'
    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'controlled-stdio', version: '1' } }
    : body.method === 'tools/list'
      ? { tools: [{ name: 'process_details', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: JSON.stringify({ methods, argv: process.argv.slice(2), cwd: process.cwd(), value: process.env.TEST_VALUE }) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }) + '\\n');
});
`
  )
  const changed = await agents.mcp!.save({
    agentId: first.id,
    connectionId: saved.connectionId,
    serverId: saved.serverId,
    name: 'Local process',
    config: { type: 'stdio', command: process.execPath, args: [script, 'one argument & two'], cwd, env: { TEST_VALUE: 'value with spaces' }, custom: saved.config.custom }
  })
  expect(changed).toMatchObject({ state: 'connected', config: { command: process.execPath, cwd, custom: { preserved: true } } })
  await streamClosed.promise
  expect(ctx.tools.schemas(selected).some(tool => tool.name.endsWith('__from_sse'))).toBe(false)
  const tool = ctx.tools.schemas(selected).find(tool => tool.name.endsWith('__process_details'))!.name
  const result = await ctx.tools.execute({ callId: 'process-configuration' as never, name: tool, arguments: {}, agent: selected, signal: new AbortController().signal })
  const returned = JSON.stringify(result)
  expect(returned).toContain('initialize')
  expect(returned).toContain('tools/list')
  expect(returned).toContain('one argument & two')
  expect(returned).toContain(cwd)
  expect(returned).toContain('value with spaces')
  expect(ctx.tools.schemas(other).some(row => row.name === tool)).toBe(false)
  await agents.mcp!.remove({ agentId: first.id, connectionId: changed.connectionId })
  expect(ctx.tools.schemas(selected).some(row => row.name === tool)).toBe(false)
  expect(
    JSON.stringify(await ctx.tools.execute({ callId: 'removed-transport' as never, name: tool, arguments: {}, agent: selected, signal: new AbortController().signal }))
  ).toContain('AGENT_MCP_NOT_SELECTED')
})
