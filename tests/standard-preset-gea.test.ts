// @vitest-environment node
/** Actual GEA hooks on the production Session; business identity is an offline adapter. */
import { expect, it, onTestFinished } from 'vitest'
import { agentOn, completion, history, presetHarness, record, turn } from './core-preset-harness.js'

it('keeps general Session tools across the GEA hooks and rejects unprofiled business execution', async () => {
  const { mountBusinessPrompts } = await import('preset-integration-gea/host/prompt-runtime')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx, 262_144, true)
  const agent = await agentOn(ctx, 'gea-general', 'auto-negotiation')
  const standardTools = ctx.tools.schemas(agent).map(row => row.name)
  const identity = { config: { runtimeDir: home }, watchIdentity: () => () => {} }
  const release = mountBusinessPrompts(ctx, identity as never, createCapabilityRegistry([]), new Map())
  onTestFinished(release)
  await turn(ctx, agent, 'Organize the general task with the official todo tool.')
  const finalTools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(finalTools).toEqual(expect.arrayContaining(standardTools))
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('todo/write')
  const denied = await ctx.tools.execute({
    callId: 'unprofiled-gea-call' as never,
    name: 'gea_evidence_read',
    arguments: { artifact: 'no-business-grant' },
    agent,
    signal: new AbortController().signal
  })
  expect(JSON.stringify(denied)).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  await record('gea-hook', {
    inputs: { gea: process.env.DSH_GEA_CHECKOUT, workbench: process.env.DSH_WORKBENCH_CHECKOUT },
    finalTools,
    toolEvents: agent.session.snapshotEvents().filter(row => row.type === 'todo/write'),
    denied
  })
})

it('selects the base inventory resource into a complete standard Session without losing its persona or Skill', async () => {
  const { BusinessResources } = await import('../src/runtime/business-resources.js')
  const { resolve } = await import('node:path')
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx)
  const resources = new BusinessResources(ctx, resolve(home, 'selected-resources.json'))
  onTestFinished(() => resources.dispose())
  await resources.register([
    {
      id: 'gea-html-inventory-aqkc',
      label: '基地库存',
      root: resolve(import.meta.dirname, '../business-resources/inventory-aqkc'),
      prompt: 'prompt.json',
      profile: { label: '基地库存', consumerCode: 'base-safety-stock', skills: ['inventory-aqkc'] },
      skillFiles: { 'inventory-aqkc': 'skills/aqkc/SKILL.md' }
    }
  ])
  const selection = await resources.select('gea-html-inventory-aqkc', new AbortController().signal)
  const standard = await agentOn(ctx, 'base-reference', 'standard')
  const agent = await agentOn(ctx, 'base-inventory', selection.preset, await history(100))
  expect(
    ctx.tools
      .schemas(agent)
      .map(row => row.name)
      .sort()
  ).toEqual(
    ctx.tools
      .schemas(standard)
      .map(row => row.name)
      .sort()
  )
  expect(ctx.commands.list(agent).map(row => row.name)).toEqual(['compact', 'goal', 'plan'])
  expect(ctx.agentPresets.serviceFor(agent, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  expect(await ctx.skills.get('inventory-aqkc', { scope: agent, cwd: home })).toMatchObject({ name: 'inventory-aqkc' })
  await turn(ctx, agent, 'Continue the inventory task using its standard tools.')
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain('你负责基地库存只读查询与解释')
  const compact = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal)
  expect(compact?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  await record('base-inventory-capabilities', { selection, tools: ctx.tools.schemas(agent).map(row => row.name), commands: ctx.commands.list(agent), compact: compact?.result })
})

it('retains official tools and executes general work after the GEA business call allowance is spent', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  const requests = await completion(f.ctx)
  const summary = (await f.resources.list()).find(row => row.id === 'gea-html-inventory-aqkc')
  const catalog = (await f.ctx.agentPresets.list()).find(row => row.id === summary?.id)
  expect(catalog).toMatchObject({ name: '基地库存Agent', description: summary?.description })
  expect(summary?.label).toBe('基地库存Agent')
  f.login()
  await turn(f.ctx, f.agent, 'Prepare the inventory analysis.')
  expect(requests.at(-1)?.tools?.map(row => row.name)).toContain('todo_write')
  const first = await f.query()
  expect(JSON.stringify(first)).toContain('42')
  for (let i = 1; i < 20; i++) await f.execute('gea_module_mcp', { tool: 'query_business_data', schema: true })
  expect(JSON.stringify(await f.query())).toContain('GEA_CALL_BUDGET')
  const assembled = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  expect(assembled.tools.map(row => row.name)).toContain('todo_write')
  expect(assembled.tools.map(row => row.name)).not.toContain('gea_cube_query')
  const todo = await f.execute('todo_write', { todos: [{ content: 'Deliver verified inventory', status: 'in_progress' }] })
  expect(todo.isError).toBe(false)
  const file = `${f.home}/inventory.txt`
  expect((await f.execute('write', { file_path: file, content: 'Verified inventory: 42' })).isError).toBe(false)
  expect(JSON.stringify(await f.execute('read', { file_path: file }))).toContain('Verified inventory: 42')
  expect((await f.ctx.commands.execute(f.agent, '/plan', [], new AbortController().signal))?.result.kind).toBe('success')
  await f.ctx.commands.execute(f.agent, '/plan off', [], new AbortController().signal)
  const child = await f.execute('subagent', {
    description: 'Check inventory summary',
    prompt: 'Explain the parent inventory task without extending business scope.',
    run_in_background: false
  })
  await record('base-child-result', child)
  expect(child.isError).toBe(false)
  await record('base-budget-general', {
    first,
    todo,
    child,
    assembledTools: assembled.tools.map(row => row.name),
    finalTools: requests.at(-1)?.tools?.map(row => row.name),
    network: f.network
  })
})

it('rejects missing identity and undeclared Consumer routes before transport, without granting business writes', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  const requests = await completion(f.ctx)
  const missingIdentity = await f.query()
  expect(JSON.stringify(missingIdentity)).toContain('LOGIN_REQUIRED')
  expect(f.network).toEqual([])
  f.login()
  await record('base-agent-lookup', { id: f.agent.id, found: !!f.ctx.agents.get(f.agent.id), preset: f.ctx.sessionProjections.stateOf(f.agent.session, 'agentPreset') })
  const wrongConsumer = await f.execute('gea_module_mcp', { consumerCode: 'branch-safety-stock' })
  expect(JSON.stringify(wrongConsumer)).toContain('GEA_CONSUMER_ROUTE_NOT_REGISTERED')
  expect(f.network).toEqual([])
  expect(() => f.business.assertExecutionAllowed('base-safety-stock', 'submit')).toThrow('GEA_CAPABILITY_EFFECT_NOT_ALLOWED')
  expect(JSON.stringify(await f.query())).toContain('42')
  expect(f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode).toBe('base-safety-stock')
  await turn(f.ctx, f.agent, 'Report the confirmed inventory scope.')
  expect(JSON.stringify(requests)).not.toMatch(/fixture-identity-secret|fixture-delegation-secret/)
  await record('base-authorization', {
    missingIdentity,
    wrongConsumer,
    consumer: f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode,
    credentialFreePrompt: true
  })
})

it('inherits the actual business preset in a standard child and refuses undeclared cross Consumer execution there', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  f.login()
  const children: unknown[] = []
  const off = f.ctx.on(
    'agent/pre-step',
    async ({ agent }, next) => {
      if (agent !== f.agent) {
        const preset = f.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')
        const denied = await f.execute('gea_module_mcp', { consumerCode: 'branch-safety-stock' }, agent)
        const allowed = await f.query(undefined, agent)
        children.push({ preset, denied, allowed })
      }
      return next()
    },
    { global: true }
  )
  onTestFinished(off)
  const result = await f.execute('subagent', {
    description: 'Read base inventory',
    prompt: 'Read the original base inventory scope and keep its business authorization.',
    run_in_background: false
  })
  expect(result.isError).toBe(false)
  await record('base-children-inspect', { children, result })
  expect(children).toHaveLength(1)
  expect(JSON.stringify(children)).toContain('gea-html-inventory-aqkc')
  expect(JSON.stringify(children)).toContain('GEA_CONSUMER_ROUTE_NOT_REGISTERED')
  expect(JSON.stringify(children)).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').every(row => row.body.consumerCode === 'base-safety-stock')).toBe(true)
  await record('base-subagent-inheritance', { children, result })
})

it('revokes business execution when its resource owner is withdrawn or its capability is disabled', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  f.login()
  f.business.setCapabilities(createCapabilityRegistry([{ ...f.contract, enabled: false }]))
  expect(JSON.stringify(await f.query())).toContain('GEA_CAPABILITY_DISABLED')
  expect(f.network).toEqual([])
  f.business.setCapabilities(f.capabilities)
  await f.releaseResource()
  const missing = await f.query()
  expect(JSON.stringify(missing)).toContain('GEA_AGENT_RESOURCE_MISSING')
  const general = await f.execute('todo_write', { todos: [] })
  expect(JSON.stringify(general)).toContain('GEA_AGENT_RESOURCE_MISSING')
  expect(f.network).toEqual([])
  await record('base-resource-revocation', { missing, general })
})

it('cancels a pending authorized query when GEA changes identity and cannot reuse the old gateway', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  f.login()
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>(resolve => {
    started = resolve
  })
  f.block(
    new Promise<void>(resolve => {
      release = resolve
    }),
    started
  )
  const pending = f.query()
  await ready
  f.business.logout({})
  release()
  const cancelled = await pending
  expect(cancelled.isError).toBe(true)
  const afterLogout = await f.query()
  expect(JSON.stringify(afterLogout)).toContain('LOGIN_REQUIRED')
  expect(f.network.filter(row => row.path === '/ai/gateway/session')).toHaveLength(1)
  await record('base-identity-cancellation', { cancelled, afterLogout })
})

it('automatically and manually compacts a real base inventory Session through its actual GEA hooks', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness({ seed: await history(20_000) })
  const requests = await completion(f.ctx, 262_144, true)
  f.login()
  await turn(f.ctx, f.agent, 'Continue the original base inventory task with the current read-only scope.')
  expect(f.agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  const manual = await f.ctx.commands.execute(f.agent, '/compact', [], new AbortController().signal)
  expect(manual?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  expect(f.network).toEqual([])
  await record('base-gea-compaction', {
    events: f.agent.session.snapshotEvents().filter(row => row.type.startsWith('compaction/') || row.type === 'turn/end'),
    manual: manual?.result,
    finalTools: requests.at(-1)?.tools?.map(row => row.name)
  })
})

it('keeps standard tools after the independent evidence read allowance is exhausted', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  f.login()
  for (let i = 0; i < 12; i++) await f.execute('gea_evidence_read', { evidenceId: 'missing-evidence' })
  expect(JSON.stringify(await f.execute('gea_evidence_read', { evidenceId: 'missing-evidence' }))).toContain('GEA_EVIDENCE_BUDGET')
  expect((await f.execute('todo_write', { todos: [] })).isError).toBe(false)
  const assembled = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  expect(assembled.tools.map(row => row.name)).toEqual(expect.arrayContaining(['read', 'write', 'subagent', 'workflow', 'todo_write']))
  expect(assembled.tools.map(row => row.name)).not.toContain('gea_evidence_read')
  expect(assembled.sections.find(row => row.name === 'gea:budget')?.text).toContain('通用文件、规划、任务和协作能力仍按官方规则可用')
  await record('base-evidence-budget-general', { tools: assembled.tools.map(row => row.name), budget: assembled.sections.find(row => row.name === 'gea:budget') })
})
