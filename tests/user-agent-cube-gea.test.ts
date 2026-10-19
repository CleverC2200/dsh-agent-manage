import { expect, it, onTestFinished } from 'vitest'
import { agentOn, completion, turn } from './core-preset-harness.js'
import { baseInventoryHarness } from './base-inventory-harness.js'

it('publishes only Cube schemas into a personal Core Session and its restricted child, then masks revoked sources', async () => {
  const { sessionConsumer } = await import('preset-integration-gea/host/business-identity')
  const f = await baseInventoryHarness({ personalAgents: true })
  const requests = await completion(f.ctx)
  const agents = f.userAgents!
  const saved = await agents.save({ name: 'Personal Cube', description: '', prompt: 'PERSONAL_CUBE_PROMPT', enabled: true })
  await agents.saveCube(saved.id, { sourceRef: f.selection.id, enabled: true })
  const personal = await agentOn(f.ctx, 'personal-cube-session', saved.preset)
  const ordinary = await agentOn(f.ctx, 'ordinary-cube-session', 'standard')
  expect(sessionConsumer(f.ctx, f.business, personal.id)).toBe('workbench')
  expect(sessionConsumer(f.ctx, f.business, f.agent.id)).toBe('base-safety-stock')
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
  expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual(['base-safety-stock', 'workbench'])
  expect(f.network.filter(row => row.body.method === 'tools/call').map(row => row.body)).toEqual(
    expect.arrayContaining([expect.objectContaining({ params: expect.objectContaining({ _meta: expect.objectContaining({ agentCode: 'workbench' }) }) })])
  )
  expect(JSON.stringify(assembled)).not.toMatch(/fixture-identity-secret|fixture-delegation-secret/)
})

it('keeps two configured strategies independent while sharing the Workbench tools without another preset', async () => {
  const { WORKBENCH_SOURCE_REF, WORKBENCH_AGENT_CODE } = await import('preset-integration-gea/host/shared-agent')
  const f = await baseInventoryHarness({ personalAgents: true, businessConfig: { analysisAgentCode: WORKBENCH_AGENT_CODE } })
  const agents = f.userAgents!
  const before = await agents.pluginAgents()
  const release = await f.resources.register([
    { id: WORKBENCH_SOURCE_REF, label: 'GEA Workbench', cube: true, root: f.home, profile: { label: 'GEA Workbench', consumerCode: WORKBENCH_AGENT_CODE, skills: [] } }
  ])
  onTestFinished(release)
  expect(await agents.pluginAgents()).toEqual(before)
  expect(agents.cubeSources()).toContainEqual({ sourceRef: WORKBENCH_SOURCE_REF, name: 'GEA Workbench', enabled: true, available: true })
  const a = await agents.save({ name: 'Strategy A', description: '', prompt: 'STRATEGY_A_PROMPT', enabled: true })
  const b = await agents.save({ name: 'Strategy B', description: '', prompt: 'STRATEGY_B_PROMPT', enabled: true })
  await agents.saveSkills(a.id, [{ kind: 'personal', name: 'strategy-a', description: 'A rules', content: 'STRATEGY_A_RULES', enabled: true }])
  await agents.saveCube(a.id, { sourceRef: WORKBENCH_SOURCE_REF, enabled: true })
  await agents.saveCube(b.id, { sourceRef: WORKBENCH_SOURCE_REF, enabled: true })
  const first = await agentOn(f.ctx, 'shared-strategy-a', a.preset)
  const second = await agentOn(f.ctx, 'shared-strategy-b', b.preset)
  await f.login(false)
  const assemble = (agent: typeof first) => f.ctx.systemPrompt.assemble({ scope: agent, agent } as never)
  const firstPrompt = await assemble(first)
  const secondPrompt = await assemble(second)
  expect(JSON.stringify(firstPrompt.sections)).toContain('STRATEGY_A_PROMPT')
  expect(JSON.stringify(firstPrompt.sections)).not.toContain('STRATEGY_B_PROMPT')
  expect(JSON.stringify(secondPrompt.sections)).toContain('STRATEGY_B_PROMPT')
  expect(JSON.stringify(secondPrompt.sections)).not.toContain('STRATEGY_A_PROMPT')
  expect((await f.ctx.skills.get('strategy-a', { scope: first, cwd: f.home }))?.content).toBe('STRATEGY_A_RULES')
  expect(await f.ctx.skills.get('strategy-a', { scope: second, cwd: f.home })).toBeUndefined()
  expect(JSON.stringify(await f.query(undefined, first))).toContain('42')
  expect(JSON.stringify(await f.query(undefined, second))).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual(['base-safety-stock', WORKBENCH_AGENT_CODE])
  expect(() => f.business.assertExecutionAllowed(WORKBENCH_AGENT_CODE, 'submit')).toThrow('GEA_CAPABILITY_EFFECT_NOT_ALLOWED')
  expect(JSON.stringify(await f.execute('gea_workbench_apply', {}, first))).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  await agents.saveCube(a.id, { sourceRef: WORKBENCH_SOURCE_REF, enabled: false })
  expect(f.ctx.tools.schemas(first).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  await assemble(second)
  expect(JSON.stringify(await f.query(undefined, second))).toContain('42')
  await release()
  expect(f.ctx.tools.schemas(second).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(await f.query(undefined, second))).toContain('GEA MCP requires')
  expect(await agents.list()).toEqual(expect.arrayContaining([expect.objectContaining({ id: a.id, preset: a.preset }), expect.objectContaining({ id: b.id, preset: b.preset })]))
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
  await f.ctx.systemPrompt.assemble({ scope: old, agent: old } as never)
  expect(JSON.stringify(await f.query(undefined, old))).toContain('42')
  await writeSource('SOURCE_AFTER_SYNC')
  const preview = await sources.preview({ id: imported.id })
  const updated = await sources.commit({ token: preview.token })
  expect(updated.cube).toEqual({ sourceRef: f.selection.id, enabled: true })
  const fresh = await agentOn(f.ctx, 'cube-after-source-sync', imported.preset)
  expect(agents.cubeFor(old)?.generation).toBe(originalGrant?.generation)
  expect(agents.cubeFor(fresh)?.sourceRef).toBe(f.selection.id)
  await f.ctx.systemPrompt.assemble({ scope: fresh, agent: fresh } as never)
  expect(JSON.stringify(await f.query(undefined, fresh))).toContain('42')
  await agents.saveCube(imported.id, null)
  expect(originalGrant?.signal.aborted).toBe(true)
  expect(agents.cubeFor(old)).toBeUndefined()
  expect(agents.cubeFor(fresh)).toBeUndefined()
})
