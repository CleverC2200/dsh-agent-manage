import { createServer } from 'node:http'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { inspectToolRegistry } from '../src/runtime/tool-registry-observer.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountUserAgentRoutes } from '../src/runtime/user-agent-routes.js'
import { agentOn, presetHarness } from './core-preset-harness.js'

it('connects an HTTP MCP through authenticated Agent configuration and scopes schemas and dispatch to its associations', async () => {
  const methods: string[] = []
  let held!: () => void
  const callHeld = new Promise<void>(resolve => {
    held = resolve
  })
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    methods.push(body.method)
    if (body.method === 'tools/call' && body.params?.arguments?.hold) {
      held()
      return
    }
    if (body.id === undefined) {
      response.writeHead(202).end()
      return
    }
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'local-controlled-mcp', version: '1' } }
        : body.method === 'tools/list'
          ? { tools: [{ name: 'echo', description: 'Controlled local echo', inputSchema: { type: 'object', properties: { hold: { type: 'boolean' } } } }] }
          : { content: [{ type: 'text', text: 'local MCP response' }] }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('LOCAL_SERVER_ADDRESS')
  const { ctx, home, start } = await presetHarness()
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
      deleteGrantRecord: async () => {}
    }
  })
  await catalog.load()
  onTestFinished(() => catalog.runtime.dispose())
  const agents = new UserAgents(ctx, join(home, 'user-agents.json'), catalog.runtime)
  onTestFinished(() => agents.dispose())
  await agents.load()
  mountUserAgentRoutes(ctx, agents)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const post = async (operation: string, input: unknown) => {
    const response = await handler.fetch(
      new Request(`http://localhost/api/agent-manage/agents/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify(input)
      })
    )
    return { status: response.status, body: await response.json() }
  }
  const first = (await post('save', { name: 'First', prompt: 'First agent', enabled: true })).body
  const second = (await post('save', { name: 'Second', prompt: 'Second agent', enabled: true })).body
  const saved = await post('mcp/save', {
    agentId: first.id,
    serverId: 'knowledge',
    name: '企业知识',
    config: { type: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp`, auth: { enabled: false } }
  })
  expect(saved.status).toBe(200)
  expect(saved.body).toMatchObject({ serverId: 'knowledge', name: '企业知识', state: 'connected', owner: 'user', allowedOps: ['edit', 'toggle', 'remove'] })
  expect(methods).toEqual(expect.arrayContaining(['initialize', 'tools/list']))
  const firstSession = await agentOn(ctx, 'first-with-mcp', first.preset)
  const secondSession = await agentOn(ctx, 'second-without-mcp', second.preset)
  const standard = await agentOn(ctx, 'standard-without-mcp', 'standard')
  const tool = ctx.tools.schemas(firstSession).find(row => row.name.endsWith('__echo'))!.name
  expect(ctx.tools.schemas(secondSession).map(row => row.name)).not.toContain(tool)
  expect(ctx.tools.schemas(standard).map(row => row.name)).not.toContain(tool)
  expect(ctx.tools.schemas(firstSession).map(row => row.name)).toContain('read')
  const execute = (agent: typeof firstSession) => ctx.tools.execute({ callId: 'local-mcp-test' as never, name: tool, arguments: {}, agent, signal: new AbortController().signal })
  expect(JSON.stringify(await execute(firstSession))).toContain('local MCP response')
  const cancellation = new AbortController()
  const pending = ctx.tools.execute({ callId: 'cancel-local-mcp' as never, name: tool, arguments: { hold: true }, agent: firstSession, signal: cancellation.signal })
  await callHeld
  cancellation.abort()
  const cancelled = await pending
  expect(cancelled.isError).toBe(true)
  expect(JSON.stringify(await execute(secondSession))).toContain('AGENT_MCP_NOT_SELECTED')
  expect((await post('mcp/associate', { agentId: second.id, connectionId: saved.body.connectionId, enabled: true })).status).toBe(200)
  await post('mcp/enabled', { agentId: first.id, connectionId: saved.body.connectionId, enabled: false })
  expect(ctx.tools.schemas(firstSession).map(row => row.name)).not.toContain(tool)
  expect(JSON.stringify(await execute(firstSession))).toContain('AGENT_MCP_NOT_SELECTED')
  expect(JSON.stringify(await execute(secondSession))).toContain('local MCP response')
  expect(
    (
      await post('mcp/save', {
        agentId: second.id,
        connectionId: saved.body.connectionId,
        serverId: 'knowledge',
        name: 'Bad edit',
        config: { type: 'streamable-http', url: 'bad' }
      })
    ).status
  ).toBe(400)
  expect(JSON.stringify(await execute(secondSession))).toContain('local MCP response')
  expect(
    (
      await post('mcp/save', {
        agentId: second.id,
        origin: 'plugin',
        owner: 'plugin',
        serverId: 'forged',
        name: 'forged',
        config: { type: 'streamable-http', url: 'http://localhost/' }
      })
    ).status
  ).toBe(400)
  await post('mcp/remove', { agentId: second.id, connectionId: saved.body.connectionId })
  expect(JSON.stringify(await execute(secondSession))).toContain('AGENT_MCP_NOT_SELECTED')
  await post('mcp/associate', { agentId: first.id, connectionId: saved.body.connectionId, enabled: true })
  expect(JSON.stringify(await execute(firstSession))).toContain('local MCP response')
  await post('remove', { id: first.id })
  expect(ctx.tools.schemas(firstSession).map(row => row.name)).not.toContain(tool)
  expect(JSON.stringify(await execute(firstSession))).toContain('AGENT_MCP_NOT_SELECTED')
  expect((await post('mcp/enabled', { agentId: first.id, connectionId: saved.body.connectionId, enabled: true })).status).toBe(400)
  await post('restore', { id: first.id })
  expect(JSON.stringify(await execute(firstSession))).toContain('AGENT_MCP_NOT_SELECTED')
  await post('enabled', { id: first.id, enabled: true })
  expect(JSON.stringify(await execute(firstSession))).toContain('local MCP response')
  await agents.dispose()
  await catalog.runtime.dispose()
  await ctx.fiber.dispose()
  const restoredContext = await start()
  const restoredCatalog = new Catalog({
    userRoot: join(home, 'catalog'),
    dataRoot: home,
    onChanged: async () => {},
    runtime: {
      ctx: restoredContext,
      translate: key => key,
      backend: async () => 'builtin',
      writeBackend: async () => {},
      tools: () => inspectToolRegistry(restoredContext.tools),
      deleteGrantRecord: async () => {}
    }
  })
  await restoredCatalog.load()
  const restored = new UserAgents(restoredContext, join(home, 'user-agents.json'), restoredCatalog.runtime)
  onTestFinished(async () => {
    await restored.dispose()
    await restoredCatalog.runtime.dispose()
  })
  await restored.load()
  await restoredCatalog.runtime.reconcile()
  expect(await restored.mcp!.list(first.id)).toContainEqual(expect.objectContaining({ connectionId: saved.body.connectionId, state: 'connected' }))
  const restarted = await agentOn(restoredContext, 'restored-first-mcp', first.preset)
  expect(restoredContext.tools.schemas(restarted).map(row => row.name)).toContain(tool)
  const failed = await restored.mcp!.save({
    agentId: first.id,
    serverId: 'unavailable',
    name: 'Unavailable',
    config: { type: 'streamable-http', url: 'http://127.0.0.1:1/mcp', auth: { enabled: false } }
  })
  expect(failed).toMatchObject({ state: 'failed', enabled: true })
  expect(failed.reason).toContain('mount failed')
})

it.each([
  ['association', 'tool'],
  ['source', 'tool'],
  ['association', 'resource'],
  ['source', 'resource']
])('cancels a revoked %s %s in flight without disconnecting its shared MCP', async (mode, kind) => {
  const waiting = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const requests: string[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    if (body.id === undefined) {
      response.writeHead(202).end()
      return
    }
    if (body.method === 'tools/call' || body.method === 'resources/read') requests.push(body.method)
    if ((body.method === 'tools/call' && body.params.arguments.slow) || (body.method === 'resources/read' && body.params.uri.endsWith('/slow'))) {
      waiting.resolve()
      await release.promise
    }
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'revocation', version: '1' } }
        : body.method === 'tools/list'
          ? { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
          : body.method === 'resources/read'
            ? { contents: [{ uri: body.params.uri, mimeType: 'text/plain', text: 'LATE_SHARED_RESPONSE' }] }
            : { content: [{ type: 'text', text: 'LATE_SHARED_RESPONSE' }] }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
  })
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready))
  onTestFinished(() => {
    release.resolve()
    server.closeAllConnections()
    return new Promise<void>(done => server.close(() => done()))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('ADDRESS')
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
      deleteGrantRecord: async () => {}
    }
  })
  await catalog.load()
  onTestFinished(() => catalog.runtime.dispose())
  const agents = new UserAgents(ctx, join(home, 'agents.json'), catalog.runtime)
  await agents.load()
  onTestFinished(() => agents.dispose())
  const a =
    mode === 'source'
      ? await agents.importSource(
          { name: 'A', prompt: 'A', enabled: true },
          { sourceId: 'scope-source', suiteId: 'scope-suite', resourceKey: 'agent:a', url: home, kind: 'local', base: { name: 'A', prompt: 'A', description: '', skills: [] } }
        )
      : await agents.save({ name: 'A', prompt: 'A', enabled: true })
  let available = true
  agents.mcp!.setSourceAvailability(() => available)
  const b = await agents.save({ name: 'B', prompt: 'B', enabled: true })
  const saved = await agents.mcp!.save({
    agentId: a.id,
    serverId: 'shared',
    name: 'Shared',
    config: { type: 'streamable-http', url: `http://127.0.0.1:${address.port}`, auth: { enabled: false } }
  })
  await agents.mcp!.associate({ agentId: b.id, connectionId: saved.connectionId, enabled: true })
  const first = await agentOn(ctx, 'revoke-a', a.preset)
  const other = await agentOn(ctx, 'keep-b', b.preset)
  const name = ctx.tools.schemas(first).find(tool => tool.name.endsWith(kind === 'resource' ? '__dsh_read_resource' : '__echo'))!.name
  let settled = false
  const pending = ctx.tools
    .execute({
      callId: 'slow-before-revocation' as never,
      name,
      arguments: kind === 'resource' ? { uri: 'controlled://resource/slow' } : { slow: true },
      agent: first,
      signal: new AbortController().signal
    })
    .then(result => {
      settled = true
      return result
    })
  try {
    await waiting.promise
    if (mode === 'source') {
      available = false
      agents.mcp!.sourceAvailabilityChanged()
    } else await agents.mcp!.setEnabled({ agentId: a.id, connectionId: saved.connectionId, enabled: false })
    await expect.poll(() => settled, { timeout: 1000 }).toBe(true)
    release.resolve()
    expect(JSON.stringify(await pending)).not.toContain('LATE_SHARED_RESPONSE')
    const kept = await ctx.tools.execute({
      callId: 'other-agent-kept' as never,
      name,
      arguments: kind === 'resource' ? { uri: 'controlled://resource/fast' } : {},
      agent: other,
      signal: new AbortController().signal
    })
    expect(JSON.stringify(kept)).toContain('LATE_SHARED_RESPONSE')
    const denied = await ctx.tools.execute({
      callId: 'known-revoked-tool' as never,
      name,
      arguments: kind === 'resource' ? { uri: 'controlled://resource/fast' } : {},
      agent: first,
      signal: new AbortController().signal
    })
    expect(JSON.stringify(denied)).toContain('AGENT_MCP_NOT_SELECTED')
    expect(requests).toHaveLength(2)
  } finally {
    release.resolve()
    await pending
  }
})
