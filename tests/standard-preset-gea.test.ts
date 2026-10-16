// @vitest-environment node
/** Actual GEA hooks on the production Session; business identity is an offline adapter. */
import { expect, it, onTestFinished } from 'vitest'
import { agentOn, completion, history, official, presetHarness, record, turn } from './core-preset-harness.js'
import { baseInventoryResource } from './base-inventory-harness.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MINIMAL_SYSTEM_PROMPT } from '../src/runtime/standard-preset.js'

it('keeps general Session tools across the GEA hooks and rejects unprofiled business execution', async () => {
  const { mountBusinessPrompts } = await import('preset-integration-gea/host/prompt-runtime')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx, 262_144, true)
  const agent = await agentOn(ctx, 'gea-general', 'auto-negotiation')
  const standardTools = ctx.tools.schemas(agent).map(row => row.name)
  const identity = { config: { runtimeDir: home }, watchIdentity: () => () => {} }
  const release = mountBusinessPrompts(ctx, identity as never, createCapabilityRegistry([]))
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
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx)
  const resources = new BusinessResources(ctx, resolve(home, 'selected-resources.json'))
  onTestFinished(() => resources.dispose())
  const resource = await baseInventoryResource()
  await resources.register([resource])
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
  for (const name of [
    'inventory-aqkc',
    'aging-stagnation-monitoring',
    'future-aging-projection',
    'inventory-deviation-monitoring',
    'inventory-policy',
    'report-templates',
    'shortage-monitoring'
  ])
    expect(await ctx.skills.get(name, { scope: agent, cwd: home })).toMatchObject({ name })
  await turn(ctx, agent, 'Continue the inventory task using its standard tools.')
  const { persona } = JSON.parse(await readFile(resolve(resource.root, 'prompt.json'), 'utf8'))
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes(persona)))).toBe(true)
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
  await f.login()
  await turn(f.ctx, f.agent, 'Prepare the inventory analysis.')
  expect(requests.at(-1)?.tools?.map(row => row.name)).toContain('todo_write')
  const first = await f.query()
  expect(JSON.stringify(first)).toContain('42')
  for (let i = 1; i < 20; i++) expect((await f.query()).isError).toBe(false)
  expect(JSON.stringify(await f.query())).toContain('GEA_CALL_BUDGET')
  const assembled = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  expect(assembled.tools.map(row => row.name)).toContain('todo_write')
  expect(assembled.tools.map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(assembled.tools.map(row => row.name)).not.toContain('mcp__gea-gateway__inspect_cube_model')
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
  expect(JSON.stringify(missingIdentity)).toContain('GEA MCP requires an enabled business Agent and current GEA identity')
  expect(f.ctx.tools.schemas(f.agent).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(f.network).toEqual([])
  await f.login()
  await record('base-agent-lookup', { id: f.agent.id, found: !!f.ctx.agents.get(f.agent.id), preset: f.ctx.sessionProjections.stateOf(f.agent.session, 'agentPreset') })
  const wrongConsumer = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: 'branch-safety-stock' })
  expect(JSON.stringify(wrongConsumer)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
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
  await f.login()
  const children: unknown[] = []
  const off = f.ctx.on(
    'agent/pre-step',
    async ({ agent }, next) => {
      if (agent !== f.agent) {
        const preset = f.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')
        const denied = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: 'branch-safety-stock' }, agent)
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
  expect(JSON.stringify(children)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(JSON.stringify(children)).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').every(row => row.body.consumerCode === 'base-safety-stock')).toBe(true)
  await record('base-subagent-inheritance', { children, result })
})

it('revokes business execution when its resource owner is withdrawn or its capability is disabled', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  await f.login()
  f.business.setCapabilities(createCapabilityRegistry([{ ...f.contract, enabled: false }]))
  expect(JSON.stringify(await f.query())).toContain('GEA_CAPABILITY_DISABLED')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  f.business.setCapabilities(f.capabilities)
  await f.releaseResource()
  const missing = await f.query()
  expect(JSON.stringify(missing)).toContain('GEA MCP requires')
  const general = await f.execute('todo_write', { todos: [] })
  expect(JSON.stringify(general)).toContain('GEA_AGENT_RESOURCE_MISSING')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  await record('base-resource-revocation', { missing, general })
})

it('cancels a pending authorized query when GEA changes identity and cannot reuse the old gateway', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  await f.login()
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
  expect(JSON.stringify(afterLogout)).toContain('GEA MCP requires an enabled business Agent and current GEA identity')
  expect(f.network.filter(row => row.path === '/ai/gateway/session')).toHaveLength(1)
  await record('base-identity-cancellation', { cancelled, afterLogout })
})

it('automatically and manually compacts a real base inventory Session through its actual GEA hooks', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness({ seed: await history(20_000) })
  const requests = await completion(f.ctx, 262_144, true)
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the original base inventory task with the current read-only scope.')
  expect(f.agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  const manual = await f.ctx.commands.execute(f.agent, '/compact', [], new AbortController().signal)
  expect(manual?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
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
  await f.login()
  for (let i = 0; i < 12; i++) await f.execute('gea_evidence_read', { evidenceId: 'missing-evidence' })
  expect(JSON.stringify(await f.execute('gea_evidence_read', { evidenceId: 'missing-evidence' }))).toContain('GEA_EVIDENCE_BUDGET')
  expect((await f.execute('todo_write', { todos: [] })).isError).toBe(false)
  const assembled = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  expect(assembled.tools.map(row => row.name)).toEqual(expect.arrayContaining(['read', 'write', 'subagent', 'workflow', 'todo_write']))
  expect(assembled.tools.map(row => row.name)).not.toContain('gea_evidence_read')
  expect(assembled.sections.some(row => row.name.startsWith('gea:'))).toBe(false)
  await record('base-evidence-budget-general', { tools: assembled.tools.map(row => row.name), budget: assembled.sections.find(row => row.name === 'gea:budget') })
})

it('keeps the company system minimal when official Web and optional presentation providers are enabled', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const f = await baseInventoryHarness()
  await completion(f.ctx)
  const webServer = await official('@deepseek-ai/dsh-host-webserver')
  await f.ctx.plugin(webServer.default ?? webServer, { host: '127.0.0.1', port: 0 }).await()
  await f.ctx.plugin(await official('@deepseek-ai/dsh-web-app'), { openBrowser: false, printUrl: false, surfaceContext: true, trustedHosts: [] }).await()
  f.ctx.effect(() => f.ctx.systemPrompt.section({ name: 'genui:fence', order: 10_200, text: 'Controlled optional GenUI section provider; original instructions' }))
  const reference = await agentOn(f.ctx, 'host-orientation-reference', 'standard')
  const standard = await f.ctx.systemPrompt.assemble({ scope: reference, agent: reference } as never)
  const business = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  const web = standard.sections.find(row => row.name === 'app:web-surface')
  expect(web?.text).toContain('DeepSeek Harness')
  expect(standard.sections.some(row => row.name.startsWith('gea:'))).toBe(false)
  const resource = await baseInventoryResource()
  const { persona } = JSON.parse(await readFile(resolve(resource.root, 'prompt.json'), 'utf8'))
  expect(business.sections.map(row => row.text)).toEqual([MINIMAL_SYSTEM_PROMPT + '\n\n' + persona])
  await record('business-runtime-context', {
    officialSections: standard.sections,
    businessSections: business.sections,
    webProvider: '@deepseek-ai/dsh-web-app',
    surfaceContext: true,
    optionalGenUI: 'controlled public section provider passes real Core assembly and GEA hook; upstream not installed in fixture'
  })
})

it('prunes an oversized actual tool result through GEA turn pressure and continues with the same business scope', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const originalTask = 'Explain the 42 inventory rows for base-safety-stock; retain the user decision to make no stock adjustment. '
  const f = await baseInventoryHarness({ seed: await history(400, originalTask), sessionId: 'base-prune-through-gea' })
  const contextWindow = 98_304
  const file = `${f.home}/large-inventory-evidence.txt`
  const payload = [
    'HEAD_KEEP: original inventory decision; Consumer base-safety-stock.',
    ...Array.from({ length: 60 }, (_, index) => `MIDDLE_${index}: ${'Verified inventory evidence. '.repeat(27)}`),
    'TAIL_KEEP: preserve read-only scope and the original user decision.'
  ].join('\n')
  await f.login()
  expect((await f.execute('write', { file_path: file, content: payload })).isError).toBe(false)
  const requests = await completion(f.ctx, contextWindow, false, undefined, {
    checkpoint: 'CHECKPOINT: Explain the 42 inventory rows for base-safety-stock; retain the user decision to make no stock adjustment. Continue read-only analysis.',
    tools: [
      { name: 'mcp__gea-gateway__query_business_data', arguments: { queries: [{ name: 'inv', query: { measures: ['inv.row_count'], limit: 3 } }] } },
      { name: 'read', arguments: { file_path: file } },
      { name: 'todo_write', arguments: { todos: [{ content: 'Continue after the verified evidence', status: 'in_progress' }] } }
    ]
  })
  const before = f.agent.session.snapshotEvents()
  const pressure: {
    seq: number
    type: string
    totalTokens: number
    surfaceTokens: number
    baseline: unknown
    data?: unknown
    toolResult?: { callId: string; isError: boolean | undefined; chars: number }
  }[] = []
  f.ctx.on('session/event', (session, event) => {
    if (session !== f.agent.session) return
    if (!['step/start', 'tool/result', 'request/context', 'compaction/summary', 'compaction/prune'].includes(event.type)) return
    const measurement = f.ctx.tokenMeter.measure(session)
    pressure.push({
      seq: event.seq,
      type: event.type,
      totalTokens: measurement.totalTokens,
      surfaceTokens: measurement.surfaceTokens,
      baseline: measurement.baseline,
      data: event.type === 'request/context' || event.type.startsWith('compaction/') ? event.data : undefined,
      toolResult:
        event.type === 'tool/result'
          ? {
              callId: event.data.message.source.callId,
              isError: event.data.message.isError,
              chars: JSON.stringify(event.data.message.content).length
            }
          : undefined
    })
  })
  await turn(f.ctx, f.agent, 'Keep the original inventory decision and read-only Consumer scope; read the evidence and continue the same task.')
  const events = f.agent.session.snapshotEvents()
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(JSON.stringify(events.filter(event => event.type === 'assistant/message'))).toContain('Continued original task from the checkpoint.')
  // rc2 reserves 65536 tokens of headroom in the unchanged 98304-token model.
  // The real read must cross that pressure line on each supported platform.
  const pressureThreshold = 32768
  const afterRead = pressure.find(row => row.toolResult?.callId === 'scripted-task-step-2')
  const beforeRead = pressure.findLast(row => row.type === 'step/start' && row.seq < (afterRead?.seq ?? -1))
  expect(beforeRead?.totalTokens, JSON.stringify(pressure)).toBeLessThan(pressureThreshold)
  expect(afterRead?.totalTokens, JSON.stringify(pressure)).toBeGreaterThan(pressureThreshold)
  const prunes = events.filter(event => event.type === 'compaction/prune')
  expect(
    prunes,
    JSON.stringify({
      contextWindow,
      pressure,
      requests: requests.map(request => ({
        messageChars: JSON.stringify(request.messages).length,
        toolChars: JSON.stringify(request.tools).length,
        summary: request.messages.at(-1)?.content.some(block => block.text?.includes('acting as a compaction engine'))
      }))
    })
  ).toHaveLength(1)
  const original = events.find(event => event.type === 'tool/result' && event.seq === prunes[0].data.shadowedSeqs[0])!
  expect(original.type).toBe('tool/result')
  const originalText =
    original.type === 'tool/result'
      ? original.data.message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
      : ''
  expect(originalText.length).toBeGreaterThan(8192)
  expect(originalText).toContain('MIDDLE_30:')
  const replacement = events.find(
    event =>
      event.type === 'tool/result' &&
      event.seq > prunes[0].seq &&
      event.data.message.source.callId === (original.type === 'tool/result' ? original.data.message.source.callId : undefined)
  )!
  expect(replacement.type).toBe('tool/result')
  const replacementText =
    replacement.type === 'tool/result'
      ? replacement.data.message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
      : ''
  expect(replacementText).toContain('[... tool result middle pruned ...]')
  expect(replacementText).toContain('HEAD_KEEP:')
  expect(replacementText).toContain('TAIL_KEEP:')
  expect(replacementText).not.toContain('MIDDLE_30:')
  expect(replacementText.length).toBeLessThanOrEqual(8192)
  expect(events).toEqual(expect.arrayContaining(before))
  const nextStep = requests.find(request => JSON.stringify(request.messages).includes('[... tool result middle pruned ...]'))!
  expect(nextStep).toBeDefined()
  const nextText = JSON.stringify(nextStep.messages)
  const summaryRequest = requests.find(request => request.messages.at(-1)?.content.some(block => block.text?.includes('acting as a compaction engine')))
  expect(JSON.stringify(summaryRequest?.messages)).toContain(originalTask.trim())
  expect(nextText).toContain('CHECKPOINT: Explain the 42 inventory rows for base-safety-stock; retain the user decision to make no stock adjustment.')
  expect(nextText.includes('Original task turn 3.')).toBe(true)
  expect(nextText.includes('Keep read-only Consumer scope and preserve user decisions.')).toBe(true)
  expect(nextText.includes('Keep the original inventory decision')).toBe(true)
  const { persona } = JSON.parse(await readFile(resolve((await baseInventoryResource()).root, 'prompt.json'), 'utf8'))
  expect(nextStep.messages.some(message => message.content.some(block => block.text?.includes(persona)))).toBe(true)
  expect(nextText.includes('42')).toBe(true)
  expect(nextText.includes('MIDDLE_30:')).toBe(false)
  expect(events.map(event => event.type)).toContain('todo/write')
  expect(events.filter(event => event.type === 'tool/result').every(event => !event.data.message.isError)).toBe(true)
  expect(f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode).toBe('base-safety-stock')
  expect(JSON.stringify(await f.query())).toContain('42')
  const networkBeforeDenial = f.network.length
  const denied = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: 'branch-inventory' })
  expect(JSON.stringify(denied)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(f.network).toHaveLength(networkBeforeDenial)
  await turn(f.ctx, f.agent, 'Continue the same inventory task after pruning without extending Consumer access.')
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).toContain('todo_write')
  expect(f.agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(f.agent.session.snapshotEvents()).toContainEqual(original)
  expect(before.every(event => f.agent.session.snapshotEvents().includes(event))).toBe(true)
  await record('base-gea-tool-result-prune', {
    sessionId: f.agent.id,
    contextWindow,
    pressure,
    pressureThreshold,
    consumer: f.selection.profile!.consumerCode,
    prunes,
    originalSeq: original.seq,
    replacementSeq: replacement.seq,
    originalChars: originalText.length,
    replacementChars: replacementText.length,
    completedTurnsAfterSeed: f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end').length - before.filter(event => event.type === 'turn/end').length,
    nextStepPruned: JSON.stringify(nextStep.messages).includes('[... tool result middle pruned ...]'),
    originalHistoryPreserved: before.every(event => f.agent.session.snapshotEvents().includes(event)),
    denied,
    deniedTransportRequests: f.network.length - networkBeforeDenial,
    originalResultDurable: f.agent.session.snapshotEvents().includes(original),
    summaryReceivedOriginalTask: JSON.stringify(summaryRequest?.messages).includes(originalTask.trim()),
    nextStepCheckpointPreservedTask: nextText.includes('CHECKPOINT: Explain the 42 inventory rows for base-safety-stock; retain the user decision to make no stock adjustment.'),
    headKept: replacementText.includes('HEAD_KEEP:'),
    tailKept: replacementText.includes('TAIL_KEEP:'),
    todoEvents: events.filter(event => event.type === 'todo/write').length,
    gatewayConsumers: f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)
  })
})
