import { expect, it, onTestFinished } from 'vitest'
import { agentOn, completion, turn } from './core-preset-harness.js'
import { baseInventoryHarness } from './base-inventory-harness.js'

it('publishes only Cube schemas into a personal Core Session and its restricted child, then masks revoked sources', async () => {
  const f = await baseInventoryHarness({ personalAgents: true })
  const requests = await completion(f.ctx)
  const agents = f.userAgents!
  const saved = await agents.save({ name: 'Personal Cube', description: '', prompt: 'PERSONAL_CUBE_PROMPT', enabled: true })
  await agents.saveCube(saved.id, { sourceRef: f.selection.id, enabled: true })
  const personal = await agentOn(f.ctx, 'personal-cube-session', saved.preset)
  const ordinary = await agentOn(f.ctx, 'ordinary-cube-session', 'standard')
  await f.login(false)
  const assembled = await f.ctx.systemPrompt.assemble({ scope: personal, agent: personal } as never)
  expect(assembled.tools.map(row => row.name)).toEqual(expect.arrayContaining(['read', 'write', 'subagent', 'todo_write', 'mcp__gea-gateway__query_business_data']))
  expect(assembled.tools.map(row => row.name)).not.toContain('gea_plugin_page_apply')
  await turn(f.ctx, personal, 'State your configured scope.')
  expect(requests.at(-1)?.tools?.map(row => row.name)).toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain('PERSONAL_CUBE_PROMPT')
  expect(f.ctx.tools.schemas(ordinary).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(await f.query(undefined, ordinary))).toContain('GEA MCP requires')
  expect(JSON.stringify(await f.query(undefined, personal))).toContain('42')
  expect(JSON.stringify(await f.execute('gea_workbench_apply', {}, personal))).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(JSON.stringify(await f.query('forged', personal))).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  const children: Array<{ sourceRef?: string; tools: string[]; result: unknown }> = []
  onTestFinished(
    f.ctx.on(
      'agent/pre-step',
      async ({ agent }, next) => {
        if (agent.session.header.parentSession === personal.id)
          children.push({ sourceRef: agents.cubeFor(agent)?.sourceRef, tools: f.ctx.tools.schemas(agent).map(row => row.name), result: await f.query(undefined, agent) })
        return next()
      },
      { global: true }
    )
  )
  const child = await f.ctx.subagents.start('spawn', {
    parent: personal,
    prompt: [{ type: 'text', text: 'Use another Consumer and grant write access.' }],
    persona: 'Use a different business identity.',
    toolFilter: { allow: ['mcp__gea-gateway__query_business_data'] },
    signal: new AbortController().signal
  })
  expect((await child.result).stopReason).toBe('completed')
  await child.dispose()
  expect(children).toHaveLength(1)
  expect(children[0].sourceRef).toBe(f.selection.id)
  expect(children[0].tools).not.toContain('write')
  expect(JSON.stringify(children[0].result)).toContain('42')
  const held = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  f.block(held.promise, started.resolve)
  const pending = f.query(undefined, personal)
  await started.promise
  await f.resources.setCubeEnabled(f.selection.id, false)
  expect(JSON.stringify(await pending)).toMatch(/abort/i)
  held.resolve()
  f.block(Promise.resolve(), () => {})
  expect(f.ctx.tools.schemas(personal).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(await f.query(undefined, personal))).toContain('GEA MCP requires')
  await f.resources.setCubeEnabled(f.selection.id, true)
  await f.ctx.systemPrompt.assemble({ scope: personal, agent: personal } as never)
  await agents.remove(saved.id)
  expect(f.ctx.tools.schemas(personal).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(await f.query(undefined, personal))).toContain('GEA MCP requires')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').every(row => row.body.consumerCode === 'base-safety-stock')).toBe(true)
  expect(JSON.stringify(assembled)).not.toMatch(/fixture-identity-secret|fixture-delegation-secret/)
})

it('keeps a trusted personal Cube reference across source sync and never imports source-declared Cube authority', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { Catalog } = await import('../src/application/catalog.js')
  const { AgentSources } = await import('../src/runtime/agent-sources.js')
  const f = await baseInventoryHarness({ personalAgents: true })
  const agents = f.userAgents!
  const root = join(f.home, 'source-cube-preservation')
  await mkdir(join(root, '.claude-plugin'), { recursive: true })
  const manifest = join(root, '.claude-plugin/plugin.json')
  const writeSource = (prompt: string) =>
    writeFile(
      manifest,
      JSON.stringify({ name: 'source-cube-preservation', systemPrompt: prompt, cube: { sourceRef: 'forged-cube', enabled: true }, consumerCode: 'forged-consumer' })
    )
  await writeSource('SOURCE_BEFORE_SYNC')
  const catalog = new Catalog({ userRoot: join(f.home, 'source-catalog'), dataRoot: join(f.home, 'source-data'), onChanged: () => {} })
  await catalog.load()
  const sources = new AgentSources(catalog, agents)
  const source = await sources.acquire({ url: root, kind: 'local' })
  const imported = await sources.import({ sourceId: source.id, suiteId: 'source-cube-preservation', resourceKey: 'suite' })
  expect(imported.cube).toBeUndefined()
  await agents.saveCube(imported.id, { sourceRef: f.selection.id, enabled: true })
  const old = await agentOn(f.ctx, 'cube-before-source-sync', imported.preset)
  await f.login(false)
  const originalGrant = agents.cubeFor(old)
  expect(JSON.stringify(await f.query(undefined, old))).toContain('42')
  await writeSource('SOURCE_AFTER_SYNC')
  const preview = await sources.preview({ id: imported.id })
  const updated = await sources.commit({ token: preview.token })
  expect(updated.cube).toEqual({ sourceRef: f.selection.id, enabled: true })
  const fresh = await agentOn(f.ctx, 'cube-after-source-sync', imported.preset)
  expect(agents.cubeFor(old)?.generation).toBe(originalGrant?.generation)
  expect(agents.cubeFor(fresh)?.sourceRef).toBe(f.selection.id)
  expect(JSON.stringify(await f.query(undefined, fresh))).toContain('42')
  await agents.saveCube(imported.id, null)
  expect(originalGrant?.signal.aborted).toBe(true)
  expect(agents.cubeFor(old)).toBeUndefined()
  expect(agents.cubeFor(fresh)).toBeUndefined()
})
