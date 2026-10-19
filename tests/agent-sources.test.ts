import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { zipSync } from 'fflate'
import { listenLoopback } from './helpers/http-fixture.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { inspectToolRegistry } from '../src/runtime/tool-registry-observer.js'
import { suiteInstructions } from '../src/runtime/project-runtime.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { AgentSources } from '../src/runtime/agent-sources.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { agentOn, completion, presetHarness, turn } from './core-preset-harness.js'

it('imports a discovered source Agent, publishes a native Session and preserves the source baseline across customization and restart', async () => {
  const { ctx, home, start } = await presetHarness()
  const source = join(home, 'team-config')
  await mkdir(join(source, '.claude-plugin'), { recursive: true })
  await mkdir(join(source, 'agents'))
  await writeFile(join(source, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'team', origin: 'plugin', consumerCode: 'admin' }))
  const original = '---\nname: Team helper\ndescription: Imported agent\norigin: plugin\nconsumerCode: admin\n---\nSOURCE_PERSONA'
  const card = join(source, 'agents/helper.md')
  await writeFile(card, original)
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: join(home, 'data'), onChanged: () => {} })
  await catalog.load()
  const file = join(home, 'user-agents.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  const discovered = await sources.acquire({ url: source, kind: 'local' })
  expect(discovered.candidates).toContainEqual(expect.objectContaining({ resourceKey: 'agent:helper', name: 'Team helper' }))
  const { mountAgentSourceRoutes } = await import('../src/runtime/agent-source-routes.js')
  const { AGENT_SOURCE_ROUTES } = await import('../src/contracts/agent-sources.js')
  mountAgentSourceRoutes(ctx, sources)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const imported = await (
    await handler.fetch(
      new Request(`http://localhost${AGENT_SOURCE_ROUTES.import}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ sourceId: discovered.id, suiteId: 'team', resourceKey: 'agent:helper' })
      })
    )
  ).json()
  expect(imported).toMatchObject({
    origin: 'user',
    prompt: 'SOURCE_PERSONA',
    publication: 'ready',
    source: { sourceId: discovered.id, base: { prompt: 'SOURCE_PERSONA' } },
    customized: false
  })
  expect((await sources.import({ sourceId: discovered.id, suiteId: 'team', resourceKey: 'agent:helper' })).id).toBe(imported.id)
  expect((await sources.acquire({ url: source, kind: 'local' })).id).toBe(discovered.id)
  const requests = await completion(ctx)
  const session = await agentOn(ctx, 'imported-source-agent', (await agents.select(imported.id)).preset)
  await turn(ctx, session, 'Identify your instructions')
  expect(JSON.stringify(requests)).toContain('SOURCE_PERSONA')
  const customized = await agents.save({ ...imported, prompt: 'USER_PERSONA' })
  expect(customized.customized).toBe(true)
  expect(customized.source?.base.prompt).toBe('SOURCE_PERSONA')
  expect(await readFile(card, 'utf8')).toBe(original)
  await agents.dispose()
  await ctx.fiber.dispose()
  const restored = new UserAgents(await start(), file)
  await restored.load()
  expect(await restored.list()).toContainEqual(
    expect.objectContaining({
      id: imported.id,
      prompt: 'USER_PERSONA',
      customized: true,
      source: expect.objectContaining({ base: expect.objectContaining({ prompt: 'SOURCE_PERSONA' }) })
    })
  )
  await restored.dispose()
})

it('routes configuration imports through authenticated Host operations and rejects forged identity, cancellation and missing dependencies', async () => {
  const { mountAgentSourceRoutes } = await import('../src/runtime/agent-source-routes.js')
  const { AGENT_SOURCE_ROUTES } = await import('../src/contracts/agent-sources.js')
  const { ctx, home } = await presetHarness()
  const root = join(home, 'invalid-config')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await mkdir(join(root, 'agents'))
  await writeFile(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'missing', mcpServers: './absent.json' }))
  await writeFile(join(root, 'agents/helper.md'), 'Cannot publish incomplete configuration')
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: join(home, 'data'), onChanged: () => {} })
  await catalog.load()
  const agents = new UserAgents(ctx, join(home, 'agents.json'))
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  mountAgentSourceRoutes(ctx, sources)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const post = (path: string, value: unknown, origin = 'http://localhost') =>
    handler.fetch(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(value) }))
  expect((await post(AGENT_SOURCE_ROUTES.acquire, { url: root, kind: 'local' }, 'https://other.test')).status).toBe(403)
  expect((await post(AGENT_SOURCE_ROUTES.acquire, { url: root, kind: 'local', origin: 'plugin', consumerCode: 'admin' })).status).toBe(400)
  const source = await sources.acquire({ url: root, kind: 'local' })
  expect(source.candidates[0].error).toContain('absent.json')
  await expect(sources.import({ sourceId: source.id, suiteId: 'missing', resourceKey: source.candidates[0].resourceKey })).rejects.toThrow('absent.json')
  const controller = new AbortController()
  controller.abort()
  await expect(sources.acquire({ url: root, kind: 'local' }, controller.signal)).rejects.toThrow()
  expect(await agents.list()).toEqual([])
  expect((await post(AGENT_SOURCE_ROUTES.acquire, { url: join(home, 'not-found'), kind: 'local' })).status).toBe(400)
  expect((await handler.fetch(new Request(`http://localhost${AGENT_SOURCE_ROUTES.list}`))).status).toBe(200)
  await agents.dispose()
})

it('imports Git and archive configurations through the same discovery and retains acquisition locks', async () => {
  const { ctx, home } = await presetHarness()
  const upstream = join(home, 'upstream')
  await mkdir(join(upstream, '.claude-plugin'), { recursive: true })
  const manifest = JSON.stringify({ name: 'locked', systemPrompt: 'LOCKED_PERSONA' })
  await writeFile(join(upstream, '.claude-plugin/plugin.json'), manifest)
  const git = promisify(execFile)
  await git('git', ['init', upstream])
  await git('git', ['-C', upstream, 'add', '.'])
  await git('git', ['-C', upstream, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'config'])
  const payload = zipSync({ 'bundle/.claude-plugin/plugin.json': Buffer.from(manifest) })
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/zip' })
    response.end(payload)
  })
  await listenLoopback(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Missing archive fixture address')
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: join(home, 'data'), git: { allowHttpArchives: true }, onChanged: () => {} })
  await catalog.load()
  const agents = new UserAgents(ctx, join(home, 'agents.json'))
  await agents.load()
  try {
    const sources = new AgentSources(catalog, agents)
    for (const input of [
      { url: upstream, kind: 'git' as const },
      { url: `http://127.0.0.1:${address.port}/config.zip`, kind: 'archive' as const }
    ]) {
      const source = await sources.acquire(input)
      const agent = await sources.import({ sourceId: source.id, suiteId: 'locked', resourceKey: 'suite' })
      expect(agent.publication).toBe('ready')
      expect(agent.source?.kind).toBe(input.kind)
      expect(agent.source?.lockCommit).toBeTruthy()
      expect(agent.prompt).toBe('LOCKED_PERSONA')
    }
  } finally {
    await agents.dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('imports complete source Skills with reference assets and keeps personal Skill changes out of the checkout', async () => {
  const { ctx, home } = await presetHarness()
  const root = join(home, 'skill-source')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  const skillRoot = join(root, 'skills/source-skill')
  await mkdir(join(skillRoot, 'references'), { recursive: true })
  await writeFile(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'source-suite', systemPrompt: 'Use the selected source skill.' }))
  const original = '---\nname: source-skill\ndescription: Source instructions\n---\nRead [source details](references/details.md).'
  await writeFile(join(skillRoot, 'SKILL.md'), original)
  await writeFile(join(skillRoot, 'references/details.md'), 'SOURCE_REFERENCE')
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: join(home, 'data'), onChanged: () => {} })
  await catalog.load()
  ctx.skills.registerProvider(() => new SuiteSkillProvider(catalog))
  const agents = new UserAgents(ctx, join(home, 'agents.json'))
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  const source = await sources.acquire({ url: root, kind: 'local' })
  const imported = await sources.import({ sourceId: source.id, suiteId: 'source-suite', resourceKey: 'suite' })
  expect(imported.publication).toBe('ready')
  expect(imported.skills).toEqual([
    expect.objectContaining({
      kind: 'reference',
      name: 'source-skill',
      provider: 'agent-plugin',
      path: join(skillRoot, 'SKILL.md'),
      enabled: true,
      content: 'Read [source details](references/details.md).'
    })
  ])
  const session = await agentOn(ctx, 'imported-skill', imported.preset, undefined, home)
  const loaded = await ctx.skills.get('source-skill', { scope: session, cwd: home })
  expect(loaded?.resourceBase?.kind).toBe('directory')
  expect(loaded?.resourceBase?.path).not.toBe(skillRoot)
  expect(await readFile(join(loaded!.resourceBase!.path!, 'references/details.md'), 'utf8')).toBe('SOURCE_REFERENCE')
  expect(loaded?.content).toContain('references/details.md')
  const changed = await agents.saveSkills(
    imported.id,
    imported.skills.map(skill => ({ ...skill, content: 'CUSTOM_SKILL_BODY' }))
  )
  expect(changed.customized).toBe(true)
  expect(changed.source?.base.skills).toEqual(imported.skills)
  expect(await readFile(join(skillRoot, 'SKILL.md'), 'utf8')).toBe(original)
  const entry = (await catalog.readUserCatalog()).suites[0]
  expect((await suiteInstructions([entry])).text).toBe('')
  const reloadedCatalog = new Catalog({ userRoot: catalog.userRoot, dataRoot: join(home, 'data'), onChanged: () => {} })
  await reloadedCatalog.load()
  expect((await reloadedCatalog.readUserCatalog()).suites[0].configurationOnly).toBe(true)
  expect(entry.activeSurfaces).toEqual({ skills: true, mcp: false, hooks: false, commands: false, agents: false, lsp: false })
  await agents.dispose()
})

it('imports source MCP as personal external associations and resumes the same incomplete Agent after cancellation', async () => {
  const cancellation = new AbortController()
  const methods: string[] = []
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }
    let text = ''
    for await (const chunk of request) text += chunk
    const body = JSON.parse(text)
    methods.push(body.method)
    if (body.id === undefined) {
      response.writeHead(202).end()
      return
    }
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'source-fixture', version: '1' } }
        : body.method === 'tools/list'
          ? { tools: [{ name: 'source_echo', description: 'Controlled fixture', inputSchema: { type: 'object' } }] }
          : { content: [{ type: 'text', text: 'SOURCE_MCP_RESULT' }] }
    if (body.method === 'tools/list') cancellation.abort()
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
  })
  await listenLoopback(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Missing local MCP address')
  const { ctx, home } = await presetHarness()
  const root = join(home, 'mcp-source')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(root, '.claude-plugin/plugin.json'),
    JSON.stringify({
      name: 'source-mcp',
      systemPrompt: 'Use the source MCP.',
      origin: 'plugin',
      consumerCode: 'admin',
      mcpServers: { source: { type: 'streamable-http', url: `http://127.0.0.1:${address.port}/mcp`, auth: { enabled: false } } }
    })
  )
  const catalog = new Catalog({
    userRoot: join(home, 'catalog'),
    dataRoot: home,
    onChanged: () => {},
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
  const agents = new UserAgents(ctx, join(home, 'agents.json'), catalog.runtime)
  await agents.load()
  try {
    const sources = new AgentSources(catalog, agents)
    const source = await sources.acquire({ url: root, kind: 'local' })
    const target = { sourceId: source.id, suiteId: 'source-mcp', resourceKey: 'suite' }
    await expect(sources.import(target, cancellation.signal)).rejects.toThrow()
    const partial = (await agents.list())[0]
    expect(partial).toMatchObject({ enabled: false, source: { importPending: true } })
    await expect(agents.setEnabled(partial.id, true)).rejects.toThrow('AGENT_SOURCE_IMPORT_INCOMPLETE')
    const imported = await sources.import(target)
    expect(imported).toMatchObject({ id: partial.id, origin: 'user', enabled: true, publication: 'ready', source: { importPending: false } })
    expect(imported.source?.mcpReferences).toHaveLength(1)
    const connections = await agents.mcp!.list(imported.id)
    expect(connections).toHaveLength(1)
    expect(connections[0]).toMatchObject({ owner: 'user', state: 'connected', allowedOps: ['edit', 'toggle', 'remove'] })
    const session = await agentOn(ctx, 'source-with-mcp', (await agents.select(imported.id)).preset)
    const standard = await agentOn(ctx, 'source-mcp-not-selected', 'standard')
    const tool = ctx.tools.schemas(session).find(row => row.name.endsWith('__source_echo'))?.name
    expect(tool).toBeTruthy()
    expect(ctx.tools.schemas(standard).map(row => row.name)).not.toContain(tool)
    expect(methods).toContain('initialize')
    expect(methods).toContain('tools/list')
    expect(await agents.list()).toHaveLength(1)
  } finally {
    await agents.dispose()
    await catalog.runtime.dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
