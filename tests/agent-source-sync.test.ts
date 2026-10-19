import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { listenLoopback } from './helpers/http-fixture.js'
import { inspectToolRegistry } from '../src/runtime/tool-registry-observer.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { AgentSources } from '../src/runtime/agent-sources.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountAgentSourceRoutes } from '../src/runtime/agent-source-routes.js'
import { AGENT_SOURCE_ROUTES } from '../src/contracts/agent-sources.js'
import { agentOn, completion, presetHarness, turn } from './core-preset-harness.js'

it('previews source conflicts without changing live configuration, then publishes a merged revision for new Core Sessions only', async () => {
  const { ctx, home, start } = await presetHarness()
  const root = join(home, 'sync-source')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  const manifest = join(root, '.claude-plugin/plugin.json')
  await writeFile(manifest, JSON.stringify({ name: 'sync-source', systemPrompt: 'ORIGINAL_SOURCE' }))
  const git = promisify(execFile)
  const commit = async () => {
    await git('git', ['-C', root, 'add', '.'])
    await git('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'source'])
  }
  await git('git', ['init', root])
  await commit()
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: home, onChanged: () => {} })
  await catalog.load()
  const file = join(home, 'agents.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  const source = await sources.acquire({ url: root, kind: 'git' })
  const imported = await sources.import({ sourceId: source.id, suiteId: 'sync-source', resourceKey: 'suite' })
  const custom = await agents.save({ ...imported, prompt: 'LOCAL_CUSTOMIZATION' })
  const old = await agentOn(ctx, 'before-source-sync', custom.preset)
  const requests = await completion(ctx)
  mountAgentSourceRoutes(ctx, sources)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const post = async (path: string, body: unknown) =>
    (
      await handler.fetch(
        new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(body) })
      )
    ).json()
  await writeFile(manifest, JSON.stringify({ name: 'sync-source', systemPrompt: 'UPSTREAM_CHANGED' }))
  await commit()
  const preview = await post(AGENT_SOURCE_ROUTES.preview, { id: imported.id })
  expect(preview.conflicts).toContainEqual(expect.objectContaining({ key: 'prompt', base: 'ORIGINAL_SOURCE', local: 'LOCAL_CUSTOMIZATION', upstream: 'UPSTREAM_CHANGED' }))
  expect((await agents.list())[0].prompt).toBe('LOCAL_CUSTOMIZATION')
  await post(AGENT_SOURCE_ROUTES.cancel, { token: preview.token })
  expect((await agents.list())[0].revision).toBe(custom.revision)
  const retry = await post(AGENT_SOURCE_ROUTES.preview, { id: imported.id })
  const updated = await post(AGENT_SOURCE_ROUTES.commit, { token: retry.token, resolutions: { prompt: { choice: 'manual', value: 'MERGED_PERSONA' } } })
  expect(updated).toMatchObject({ id: imported.id, prompt: 'MERGED_PERSONA', publication: 'ready', source: { base: { prompt: 'UPSTREAM_CHANGED' } } })
  const fresh = await agentOn(ctx, 'after-source-sync', updated.preset)
  await turn(ctx, old, 'old')
  expect(JSON.stringify(requests)).toContain('LOCAL_CUSTOMIZATION')
  expect(JSON.stringify(requests)).not.toContain('MERGED_PERSONA')
  requests.length = 0
  await turn(ctx, fresh, 'new')
  expect(JSON.stringify(requests)).toContain('MERGED_PERSONA')
  expect(ctx.agentPresets.defaultId).toBe('minimal')
  expect(await readFile(manifest, 'utf8')).toContain('UPSTREAM_CHANGED')
  await agents.dispose()
  await ctx.fiber.dispose()
  const restored = new UserAgents(await start(), file)
  await restored.load()
  expect((await restored.list())[0]).toMatchObject({ prompt: 'MERGED_PERSONA', publication: 'ready', source: { base: { prompt: 'UPSTREAM_CHANGED' } } })
  await restored.dispose()
})

it('merges source Skill and MCP conflicts without exposing secrets and retains old source connections for live Sessions', async () => {
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST') return void response.writeHead(405).end()
    let body = ''
    for await (const chunk of request) body += chunk
    const message = JSON.parse(body)
    if (!('id' in message)) return void response.writeHead(202).end()
    const suffix = request.url!.slice(1)
    const result =
      message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: suffix, version: '1' } }
        : { tools: [{ name: `echo_${suffix}`, description: 'Fixture', inputSchema: { type: 'object' } }] }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await listenLoopback(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('Missing fixture')
  const { ctx, home } = await presetHarness()
  const root = join(home, 'sync-capabilities')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await mkdir(join(root, 'skills/source-skill'), { recursive: true })
  const manifest = join(root, '.claude-plugin/plugin.json')
  const skillFile = join(root, 'skills/source-skill/SKILL.md')
  const config = (name: string, secret: string) => ({
    type: 'streamable-http',
    url: `http://127.0.0.1:${address.port}/${name}`,
    headers: { Authorization: secret },
    auth: { enabled: false }
  })
  const saveSource = async (name: string) => {
    await writeFile(manifest, JSON.stringify({ name: 'capability-source', systemPrompt: 'Use skills and MCP.', mcpServers: { service: config(name, `UPSTREAM_SECRET_${name}`) } }))
    await writeFile(skillFile, `---\nname: source-skill\ndescription: Source skill\n---\nSOURCE_SKILL_${name}`)
  }
  await saveSource('old')
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
  const stop = ctx.skills.registerProvider(() => new SuiteSkillProvider(catalog))
  const agents = new UserAgents(ctx, join(home, 'agents.json'), catalog.runtime)
  await agents.load()
  try {
    const sources = new AgentSources(catalog, agents)
    const source = await sources.acquire({ url: root, kind: 'local' })
    let agent = await sources.import({ sourceId: source.id, suiteId: 'capability-source', resourceKey: 'suite' })
    const connection = (await agents.mcp!.list(agent.id))[0]
    await agents.mcp!.save({
      agentId: agent.id,
      connectionId: connection.connectionId,
      serverId: connection.serverId,
      name: connection.name,
      config: config('local', 'LOCAL_SECRET')
    })
    expect((await agents.list())[0].customized).toBe(true)
    agent = await agents.saveSkills(agent.id, [{ ...agent.skills[0], content: 'LOCAL_SKILL' }])
    const old = await agentOn(ctx, 'old-source-connections', agent.preset)
    expect((await ctx.skills.get('source-skill', { scope: old }))?.content).toBe('LOCAL_SKILL')
    expect(ctx.tools.schemas(old).some(row => row.name.endsWith('__echo_local'))).toBe(true)
    await saveSource('new')
    const preview = await sources.preview({ id: agent.id })
    expect(preview.conflicts.map(row => row.key)).toEqual(expect.arrayContaining(['skill:source-skill', 'mcp:service']))
    expect(JSON.stringify(preview)).not.toContain('LOCAL_SECRET')
    expect(JSON.stringify(preview)).not.toContain('UPSTREAM_SECRET')
    const updated = await sources.commit({ token: preview.token, resolutions: { 'skill:source-skill': { choice: 'local' }, 'mcp:service': { choice: 'upstream' } } })
    const fresh = await agentOn(ctx, 'fresh-source-connections', updated.preset)
    expect((await ctx.skills.get('source-skill', { scope: fresh }))?.content).toBe('LOCAL_SKILL')
    expect(ctx.tools.schemas(fresh).some(row => row.name.endsWith('__echo_new'))).toBe(true)
    expect(ctx.tools.schemas(fresh).some(row => row.name.endsWith('__echo_local'))).toBe(false)
    expect(ctx.tools.schemas(old).some(row => row.name.endsWith('__echo_local'))).toBe(true)
    expect(ctx.tools.schemas(old).some(row => row.name.endsWith('__echo_new'))).toBe(false)
    expect(await agents.mcp!.list(agent.id)).toHaveLength(1)
    const currentConnection = (await agents.mcp!.list(agent.id))[0]
    await agents.mcp!.remove({ agentId: agent.id, connectionId: currentConnection.connectionId })
    await saveSource('later')
    const deletedMember = await sources.preview({ id: agent.id })
    expect(deletedMember.conflicts.map(row => row.key)).toContain('mcp:service')
    await sources.commit({ token: deletedMember.token, resolutions: { 'mcp:service': { choice: 'local' }, 'skill:source-skill': { choice: 'local' } } })
    expect(await agents.mcp!.list(agent.id)).toHaveLength(0)
    const checkedAgain = await sources.preview({ id: agent.id })
    expect(checkedAgain).toMatchObject({ changed: false, conflicts: [] })
    expect(await agents.mcp!.list(agent.id)).toHaveLength(0)

    await agents.setEnabled(agent.id, false)
    expect(ctx.tools.schemas(old).some(row => row.name.endsWith('__echo_local'))).toBe(false)
    expect(JSON.stringify(await agents.list())).not.toContain('UPSTREAM_SECRET')
    await agents.setEnabled(agent.id, true)
    await catalog.removeSource(source.id)
    sources.changed()
    expect(ctx.tools.schemas(old).some(row => row.name.endsWith('__echo_local'))).toBe(false)
    expect(ctx.tools.schemas(fresh).some(row => row.name.endsWith('__echo_new'))).toBe(false)
  } finally {
    await agents.dispose()
    await stop()
    await catalog.runtime.dispose()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

it('rejects stale or cancelled syncs and preserves the durable usable revision through publication, persistence and release failures', async () => {
  const { ctx, home } = await presetHarness()
  const register = ctx.agentPresets.register.bind(ctx.agentPresets)
  let failNextRelease = false
  let retainedReleaseAttempts = 0
  const fail = vi.spyOn(ctx.agentPresets, 'register').mockImplementation(async definition => {
    const release = await register(definition)
    let failed = false
    return async () => {
      if (failNextRelease) {
        failNextRelease = false
        failed = true
        retainedReleaseAttempts++
        throw Error('CONTROLLED_RELEASE_FAILURE')
      }
      if (failed) retainedReleaseAttempts++
      await release()
    }
  })
  const root = join(home, 'failure-source')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  const manifest = join(root, '.claude-plugin/plugin.json')
  await writeFile(manifest, JSON.stringify({ name: 'failure-source', systemPrompt: 'GOOD_OLD_REVISION' }))
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: home, onChanged: () => {} })
  await catalog.load()
  const file = join(home, 'failure-agents.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  const source = await sources.acquire({ url: root, kind: 'local' })
  const agent = await sources.import({ sourceId: source.id, suiteId: 'failure-source', resourceKey: 'suite' })
  await writeFile(manifest, JSON.stringify({ name: 'failure-source', systemPrompt: 'NEW_REVISION' }))
  const stale = await sources.preview({ id: agent.id })
  await agents.save({ ...agent, name: 'Local edit after preview' })
  await expect(sources.commit({ token: stale.token })).rejects.toThrow('AGENT_SOURCE_PREVIEW_STALE')
  const plan = await sources.preview({ id: agent.id })
  const previous = (await agents.list())[0]
  const durable = await readFile(file, 'utf8')
  const controller = new AbortController()
  controller.abort()
  await expect(sources.commit({ token: plan.token }, controller.signal)).rejects.toThrow()
  expect(await readFile(file, 'utf8')).toBe(durable)
  fail.mockRejectedValueOnce(Error('CONTROLLED_PUBLICATION_FAILURE'))
  await expect(sources.commit({ token: plan.token })).rejects.toThrow('CONTROLLED_PUBLICATION_FAILURE')
  expect(await readFile(file, 'utf8')).toBe(durable)
  expect((await agents.list())[0]).toMatchObject({ revision: previous.revision, publication: 'ready', prompt: 'GOOD_OLD_REVISION' })
  const { rename, rm } = await import('node:fs/promises')
  await rename(file, `${file}.backup`)
  await mkdir(file)
  await expect(sources.commit({ token: plan.token })).rejects.toThrow()
  expect((await agents.list())[0]).toMatchObject({ revision: previous.revision, publication: 'ready' })
  await rm(file, { recursive: true })
  await rename(`${file}.backup`, file)
  failNextRelease = true
  await expect(sources.commit({ token: plan.token })).rejects.toThrow('CONTROLLED_RELEASE_FAILURE')
  expect((await agents.list())[0]).toMatchObject({ revision: previous.revision, publication: 'ready' })
  const [committed, repeated] = await Promise.allSettled([sources.commit({ token: plan.token }), sources.commit({ token: plan.token })])
  expect(committed.status).toBe('fulfilled')
  if (committed.status !== 'fulfilled') throw committed.reason
  const updated = committed.value
  expect(repeated).toMatchObject({ status: 'rejected', reason: Error('AGENT_SOURCE_PREVIEW_EXPIRED') })
  expect(retainedReleaseAttempts).toBe(2)
  expect((await ctx.agentPresets.list()).filter(row => row.id.startsWith(agent.preset)).map(row => row.id)).toEqual([agent.preset])
  expect(updated).toMatchObject({ prompt: 'NEW_REVISION', publication: 'ready' })
  fail.mockRestore()
  await agents.dispose()
})

it('compares complete Skill files during source updates and preserves chosen local attachments', async () => {
  const { ctx, home } = await presetHarness()
  const root = join(home, 'directory-sync')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  await mkdir(join(root, 'skills/complete/references'), { recursive: true })
  await writeFile(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'directory-sync', systemPrompt: 'Source persona' }))
  await writeFile(join(root, 'skills/complete/SKILL.md'), '---\nname: complete\ndescription: Complete files\n---\nRead references/value.txt')
  await writeFile(join(root, 'skills/complete/references/value.txt'), 'BASE_ATTACHMENT')
  const catalog = new Catalog({ userRoot: join(home, 'catalog'), dataRoot: home, onChanged: () => {} })
  await catalog.load()
  ctx.skills.registerProvider(() => new SuiteSkillProvider(catalog))
  const agents = new UserAgents(ctx, join(home, 'file-sync-agents.json'))
  await agents.load()
  const sources = new AgentSources(catalog, agents)
  const source = await sources.acquire({ url: root, kind: 'local' })
  const imported = await sources.import({ sourceId: source.id, suiteId: 'directory-sync', resourceKey: 'suite' })
  const target = { id: imported.id, name: 'complete' }
  const opened = await agents.directories.open(target)
  const edited = await agents.directories.write({
    ...target,
    revision: opened.revision,
    path: 'skills/complete/references/value.txt',
    fileVersion: (await agents.directories.read({ ...target, path: 'skills/complete/references/value.txt' })).fileVersion,
    data: 'LOCAL_ATTACHMENT',
    encoding: 'utf8'
  })
  await agents.directories.apply({ ...target, revision: edited.revision })
  await writeFile(join(root, 'skills/complete/references/value.txt'), 'UPSTREAM_ATTACHMENT')
  const preview = await sources.preview({ id: imported.id })
  expect(preview.conflicts).toContainEqual(expect.objectContaining({ key: 'skill:complete' }))
  const draft = await agents.directories.open(target)
  await agents.directories.write({
    ...target,
    revision: draft.revision,
    path: 'skills/complete/references/draft.txt',
    data: 'UNAPPLIED_DRAFT',
    encoding: 'utf8',
    fileVersion: null
  })
  await expect(sources.commit({ token: preview.token, resolutions: { 'skill:complete': { choice: 'upstream' } } })).rejects.toThrow('SKILL_EDIT_CONFLICT')
  const synced = await sources.commit({ token: preview.token, resolutions: { 'skill:complete': { choice: 'local' } } })
  expect(synced.publication).toBe('ready')
  expect((await agents.directories.read({ ...target, path: 'skills/complete/references/draft.txt' })).data).toBe('UNAPPLIED_DRAFT')
  const session = await agentOn(ctx, 'file-sync-session', imported.preset, undefined, home)
  const loaded = await ctx.skills.get('complete', { scope: session, cwd: home })
  expect(await readFile(join(loaded!.resourceBase!.path!, 'references/value.txt'), 'utf8')).toBe('LOCAL_ATTACHMENT')
  expect(await readFile(join(root, 'skills/complete/references/value.txt'), 'utf8')).toBe('UPSTREAM_ATTACHMENT')
  await agents.dispose()
})
