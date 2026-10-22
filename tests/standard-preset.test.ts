import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { composeStandardPreset, MINIMAL_SYSTEM_PROMPT } from '../src/runtime/standard-preset.js'
import { expect, it, vi } from 'vitest'
import { agentOn, completion, history, official, presetHarness, record, turn } from './core-preset-harness.js'

it('limits the inherited orchestration catalog and Skill tool to declared business Skills while preserving generic Skills', async () => {
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx)
  const invocation = { modelInvocable: true, userInvocable: true }
  ctx.skills.registerProvider(() => ({
    name: 'scope-fixture',
    async list() {
      return [{ name: 'general-skill', description: 'Generic fixture', provider: 'scope-fixture', source: 'custom', rank: 300, invocation }]
    },
    async get(candidate) {
      return { ...candidate, content: 'Generic fixture instructions' }
    }
  }))
  await writeFile(home + '/unrelated.md', '---\nname: unrelated-business\ndescription: Unrelated business fixture\n---\nUnrelated business instructions\n')
  await ctx.agentResources.register([
    {
      id: 'unrelated-owner',
      label: 'Unrelated fixture',
      root: home,
      profile: { label: 'Unrelated fixture', consumerCode: 'never-granted', skills: ['unrelated-business'] },
      skillFiles: { 'unrelated-business': 'unrelated.md' }
    }
  ])
  const agent = await agentOn(ctx, 'scoped-orchestration', 'auto-negotiation', undefined, home)
  const visible = (await ctx.skills.list({ scope: agent, cwd: home })).filter(skill => skill.invocation.modelInvocable).map(skill => skill.name)
  const business = (await ctx.skills.list({ cwd: home })).filter(skill => skill.provider === 'business-resource').map(skill => skill.name)
  expect(visible.filter(name => business.includes(name)).sort()).toEqual(['frozen-food-base-inventory-insight', 'frozen-food-sales-operations-diagnosis', 'prototype-html'].sort())
  expect(visible).toContain('general-skill')
  expect(visible).not.toContain('unrelated-business')
  expect((await ctx.agentResources.list({ cwd: home })).some(row => row.id === 'skill:unrelated-business')).toBe(true)
  await turn(ctx, agent, 'Explain the current task without loading other business resources.')
  const catalogs = requests.at(-1)?.messages.filter(message => message.content.some(block => block.text?.includes('<available_skills>'))) ?? []
  expect(JSON.stringify(catalogs)).not.toContain('unrelated-business')
  expect(JSON.stringify(catalogs)).toContain('general-skill')
  const execute = (name: string) => ctx.tools.execute({ callId: name as never, name: 'skill', arguments: { name }, agent, signal: new AbortController().signal })
  expect(JSON.stringify(await execute('unrelated-business'))).toContain('not available for model invocation')
  expect(JSON.stringify(await execute('frozen-food-sales-operations-diagnosis'))).toContain('frozen-food-sales-operations-diagnosis')
  expect(JSON.stringify(await execute('general-skill'))).toContain('Generic fixture instructions')
})

it.each(['source', 'directory', 'disabled-directory'])('keeps business isolation and healthy selections after %s loss, then recovers', async failure => {
  const { ctx, home } = await presetHarness()
  await completion(ctx)
  const diagnostics: string[] = []
  ctx.logger.exporter({ levels: { default: 2 }, export: ({ args }) => diagnostics.push(args.map(String).join(' ')) })
  const invocation = { modelInvocable: true, userInvocable: true }
  let invalidate = () => {}
  ctx.skills.registerProvider(control => {
    invalidate = control.invalidate
    return {
      name: 'generic-fixture',
      async list() {
        return ['general-skill', 'disabled-generic'].map(name => ({ name, description: name, provider: 'generic-fixture', source: 'custom', rank: 300, invocation }))
      },
      async get(candidate) {
        return { ...candidate, content: `Generic instructions for ${candidate.name}` }
      }
    }
  })
  const names = ['selected-sales', 'healthy-sales', 'inventory-aqkc', 'sales-forecast-result-analysis']
  for (const name of names) await writeFile(`${home}/${name}.md`, `---\nname: ${name}\ndescription: ${name}\n---\nInstructions for ${name}\n`)
  const definitions = names.map(name => ({
    id: name,
    label: name,
    root: home,
    profile: { label: name, consumerCode: 'never-granted', skills: [name] },
    skillFiles: { [name]: `${name}.md` }
  }))
  const release = await ctx.agentResources.register([definitions[0]!])
  await ctx.agentResources.register(definitions.slice(1))
  const directory = { id: 'sales-snapshot', bundle: `${home}/snapshot`, root: `${home}/snapshot/tree`, entry: 'selected-sales' }
  const restoreDirectory = async () => {
    await mkdir(`${directory.root}/selected-sales`, { recursive: true })
    await writeFile(`${directory.root}/selected-sales/SKILL.md`, '---\nname: selected-sales\ndescription: Sales snapshot\n---\nSnapshot instructions for selected-sales\n')
  }
  if (failure !== 'source') await restoreDirectory()
  await ctx.agentPresets.register(
    await composeStandardPreset(
      ctx.agentPresets,
      { id: 'sales-isolation-fixture' },
      {
        plugins: [
          {
            id: 'user-agent-skills',
            name: 'dsh-agent-manage/user-agent-skills',
            config: {
              inheritSkills: true,
              skills: [
                {
                  kind: 'reference',
                  name: 'selected-sales',
                  provider: 'business-resource',
                  enabled: failure !== 'disabled-directory',
                  ...(failure === 'source' ? {} : { directory })
                },
                { kind: 'reference', name: 'healthy-sales', provider: 'business-resource', enabled: true },
                { kind: 'reference', name: 'disabled-generic', provider: 'generic-fixture', enabled: false }
              ]
            }
          }
        ]
      }
    )
  )
  const agent = await agentOn(ctx, 'sales-isolation', 'sales-isolation-fixture', undefined, home)
  const execute = async (name: string) =>
    JSON.stringify(await ctx.tools.execute({ callId: name as never, name: 'skill', arguments: { name }, agent, signal: new AbortController().signal }))
  const selectedResult =
    failure === 'disabled-directory' ? 'not available for model invocation' : failure === 'source' ? 'Instructions for selected-sales' : 'Snapshot instructions for selected-sales'
  expect(await execute('selected-sales')).toContain(selectedResult)
  expect(await execute('inventory-aqkc')).toContain('not available for model invocation')
  if (failure === 'source') await release()
  else {
    await rm(directory.bundle, { recursive: true })
    invalidate()
  }
  for (const name of ['inventory-aqkc', 'sales-forecast-result-analysis', 'disabled-generic']) expect(await execute(name), name).toContain('not available for model invocation')
  const failed = await ctx.skills.snapshot({ scope: agent, cwd: home })
  expect(failed.complete).toBe(failure === 'disabled-directory')
  expect(failed.skills.filter(skill => [...names, 'general-skill', 'disabled-generic'].includes(skill.name) && skill.invocation.modelInvocable).map(skill => skill.name)).toEqual([
    'general-skill',
    'healthy-sales'
  ])
  expect(await execute('healthy-sales')).toContain('Instructions for healthy-sales')
  expect(await execute('general-skill')).toContain('Generic instructions for general-skill')
  if (failure !== 'disabled-directory')
    expect(diagnostics.join('\n')).toContain(failure === 'source' ? 'AGENT_SKILL_SOURCE_MISSING: selected-sales' : 'AGENT_SKILL_DIRECTORY_INVALID: selected-sales')
  const aborted = new AbortController()
  const reason = Error('Cancel Skill discovery')
  aborted.abort(reason)
  await expect(ctx.skills.snapshot({ scope: agent, cwd: home, signal: aborted.signal })).rejects.toBe(reason)
  if (failure === 'source') await ctx.agentResources.register([definitions[0]!])
  else await restoreDirectory()
  expect(await execute('selected-sales')).toContain(selectedResult)
  expect((await ctx.skills.snapshot({ scope: agent, cwd: home })).complete).toBe(true)
  expect(await execute('inventory-aqkc')).toContain('not available for model invocation')
})

it('publishes the original intelligent orchestration identity beside all official choices', async () => {
  const { ctx } = await presetHarness()
  expect(await ctx.agentPresets.resolve('auto-negotiation')).toEqual({ id: 'auto-negotiation' })
  expect(await ctx.agentPresets.list()).toContainEqual({
    id: 'auto-negotiation',
    name: '智能编排',
    description: '米面冻品全链路经营分析与运营决策，支持上下文压缩、规划、任务和协作。',
    order: 0
  })
  expect((await ctx.agentPresets.list()).map(row => row.id)).toEqual(expect.arrayContaining(['standard', 'minimal', 'ptc', 'cordis']))
})

it('keeps the final official standard tools, commands and compaction provider in a real Session', async () => {
  const { ctx } = await presetHarness()
  await completion(ctx)
  const standard = await agentOn(ctx, 'reference', 'standard')
  const orchestration = await agentOn(ctx, 'orchestration', 'auto-negotiation')
  const tools = (agent: typeof standard) =>
    ctx.tools
      .schemas(agent)
      .map(row => row.name)
      .sort()
  expect(tools(orchestration)).toEqual(tools(standard))
  expect(tools(orchestration).length).toBeGreaterThan(20)
  expect(ctx.commands.list(orchestration)).toEqual(ctx.commands.list(standard))
  expect(ctx.commands.list(orchestration).map(row => row.name)).toContain('compact')
  expect(ctx.agentPresets.serviceFor(orchestration, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  const minimal = await agentOn(ctx, 'minimal', 'minimal')
  expect(ctx.commands.list(minimal).map(row => row.name)).not.toContain('compact')
  expect(ctx.agentPresets.serviceFor(minimal, 'compaction')).toBeUndefined()
  await record('final-capabilities', {
    preset: 'auto-negotiation',
    tools: tools(orchestration),
    commands: ctx.commands.list(orchestration),
    compaction: ctx.agentPresets.serviceFor(orchestration, 'compaction')?.constructor.name,
    minimalCommands: ctx.commands.list(minimal)
  })
})

it('automatically compacts under the official model budget and continues from the checkpoint', async () => {
  const { ctx } = await presetHarness()
  const requests = await completion(ctx, 262_144, true)
  const agent = await agentOn(ctx, 'auto-compact', 'auto-negotiation', await history(20_000))
  await turn(ctx, agent, 'Continue the original task within the same read-only scope.')
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  await record(agent.id, { events: agent.session.snapshotEvents().filter(row => row.type.startsWith('compaction/') || row.type === 'turn/end'), requests: requests.length })
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
})

it('executes /compact on an idle Session and continues the original task', async () => {
  const { ctx } = await presetHarness()
  const requests = await completion(ctx)
  const agent = await agentOn(ctx, 'manual-compact', 'auto-negotiation', await history(100))
  const execution = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal)
  expect(execution?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted \d+ history items/) })
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  await record(agent.id, { events: agent.session.snapshotEvents().filter(row => row.type.startsWith('compaction/') || row.type === 'turn/end'), requests: requests.length })
  await turn(ctx, agent, 'Continue the original task after manual compaction.')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  expect(agent.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
})

it('restores only the official saved default, survives restart and preserves the original Session and other preferences', async () => {
  const { ctx, start } = await presetHarness()
  await completion(ctx)
  expect(ctx.agentPresets.defaultId).toBe('minimal')
  const original = await agentOn(ctx, 'original-session', undefined, await history(2))
  const originalEvents = original.session.snapshotEvents()
  const originalHeader = original.session.header
  expect(ctx.agentPresets.composedPreset(original.ctx)).toBe('minimal')
  await ctx.settings.update('agent-preset-registry', { selectedDefault: 'auto-negotiation' })
  expect(ctx.agentPresets.defaultId).toBe('auto-negotiation')
  const fresh = await agentOn(ctx, 'fresh-default')
  expect(ctx.agentPresets.composedPreset(fresh.ctx)).toBe('auto-negotiation')
  expect(ctx.commands.list(fresh).map(row => row.name)).toContain('compact')
  expect(original.session.header).toEqual(originalHeader)
  expect(original.session.snapshotEvents()).toEqual(originalEvents)
  expect(ctx.agentPresets.composedPreset(original.ctx)).toBe('minimal')
  await ctx.fiber.dispose()
  const restored = await start()
  await completion(restored)
  expect(restored.agentPresets.defaultId).toBe('auto-negotiation')
  expect(restored.agentDefaultModel.currentSelection()).toEqual({ provider: 'local', model: 'preserved' })
  expect(restored.agentPresets.composedPreset((await agentOn(restored, 'restart-default')).ctx)).toBe('auto-negotiation')
  const saved = await restored.sessionPersistence.open(original.id, 'read')
  try {
    expect(saved.header).toEqual({ ...originalHeader, delegationDepth: 0 })
    expect((await saved.read()).events).toEqual(originalEvents)
  } finally {
    await saved.close()
  }
  await record('default-preservation', {
    defaultBefore: 'minimal',
    defaultAfter: restored.agentPresets.defaultId,
    officialSettings: true,
    coldRestart: true,
    originalSessionPreserved: true,
    unrelatedPreferencePreserved: true
  })
  if (process.env.PRESET_RECEIPT_PATH)
    await writeFile(
      process.env.PRESET_RECEIPT_PATH,
      JSON.stringify({
        defaultBefore: 'minimal',
        defaultAfter: restored.agentPresets.defaultId,
        officialSettings: true,
        coldRestart: true,
        originalSessionPreserved: true,
        unrelatedPreferencePreserved: true
      })
    )
  await restored.settings.update('agent-preset-registry', { selectedDefault: 'minimal' })
  expect(restored.agentPresets.composedPreset((await agentOn(restored, 'user-minimal')).ctx)).toBe('minimal')
})

it('keeps the official no-history and busy guards without inventing compaction', async () => {
  const { ctx } = await presetHarness()
  let resume!: () => void
  const requests = await completion(
    ctx,
    262_144,
    false,
    new Promise<void>(resolve => {
      resume = resolve
    })
  )
  const agent = await agentOn(ctx, 'guarded-compact', 'auto-negotiation')
  const empty = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal)
  expect(empty?.result).toMatchObject({ kind: 'success', text: expect.stringContaining('No compactable history') })
  const running = turn(ctx, agent, 'Finish the admitted task.')
  await vi.waitFor(() => expect(requests.length).toBe(1))
  try {
    const busy = await ctx.commands.execute(agent, '/compact', [], new AbortController().signal)
    expect(busy?.result).toMatchObject({ kind: 'error', text: expect.stringContaining('idle') })
    expect(agent.session.snapshotEvents().map(row => row.type)).not.toContain('compaction/summary')
  } finally {
    resume()
    await running
  }
})

it('does not fabricate an automatic budget when the model has no context-window metadata', async () => {
  const { ctx } = await presetHarness()
  await completion(ctx, 0, true)
  const agent = await agentOn(ctx, 'unknown-budget', 'auto-negotiation', await history(100))
  await turn(ctx, agent, 'Continue without assuming a model budget.')
  expect(agent.session.snapshotEvents().map(row => row.type)).not.toContain('compaction/summary')
  const final = agent.session.snapshotEvents().at(-1)
  if (process.env.PRESET_EVIDENCE_DIR) await writeFile(`${process.env.PRESET_EVIDENCE_DIR}/missing-budget.json`, JSON.stringify(final, null, 2) + '\n')
  expect(final).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'INVALID_MODEL_CONTEXT' } } } })
})

it('retains the real standard tool-result pruner and its durable replacement behavior', async () => {
  const { ctx } = await presetHarness()
  await completion(ctx)
  const agent = await agentOn(ctx, 'prune-result', 'auto-negotiation')
  const { createMessage, createToolResultMessage } = await official('@deepseek-ai/dsh-llm')
  const callId = 'original-tool' as never
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append('step/start', { turn: 1, step: 1 })
  agent.session.append(
    'assistant/message',
    {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: callId, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: 'local', model: 'test' }
      })
    },
    { surfaceOp: 'append' }
  )
  agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: '{}' })
  const original = agent.session.append(
    'tool/result',
    { turn: 1, step: 1, message: createToolResultMessage({ callId, content: [{ type: 'text', text: 'Original result. '.repeat(10_000) }], isError: false }) },
    { surfaceOp: 'append' }
  )
  agent.session.append('step/end', { turn: 1, step: 1 })
  agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const pruner = ctx.agentPresets.serviceFor(agent, 'toolResultPruner')
  expect(pruner.constructor.name).toBe('ToolResultPruner')
  const result = pruner.pruneSession(agent.session)
  expect(result.pruned).toHaveLength(1)
  expect(agent.session.snapshotEvents()).toContainEqual(original)
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/prune')
  expect(agent.session.snapshotEvents().at(-1)?.type).toBe('tool/result')
})

it('keeps standard capabilities while replacing the company persona and automatic workspace instructions', async () => {
  const { ctx } = await presetHarness()
  const standard = await ctx.agentPresets.readDocument('standard')
  const composed = await ctx.agentPresets.readDocument('auto-negotiation')
  const expected = (load(standard.content, { schema: entryListSchema }) as { name: string; config?: unknown }[]).filter(row => row.name !== '@deepseek-ai/dsh-agent-instructions')
  expected.find(row => row.name === '@deepseek-ai/dsh-persona')!.config = {
    prefix: MINIMAL_SYSTEM_PROMPT + '\n\n' + (await readFile('business-resources/orchestration/prompt.md', 'utf8')),
    suffix: '',
    complete: true,
    includeRuntimeContext: false
  }
  const actual = load(composed.content, { schema: entryListSchema }) as { name: string; config?: unknown }[]
  expect(actual.filter(row => row.name !== 'dsh-agent-manage/user-agent-skills')).toEqual(expected)
  expect(actual.find(row => row.name === 'dsh-agent-manage/user-agent-skills')).toMatchObject({ id: 'user-agent-skills', config: { inheritSkills: true } })
})

it('sends only the minimal system sentence and selected user persona while retaining tool schemas', async () => {
  const { ctx } = await presetHarness()
  const requests = await completion(ctx)
  await ctx.agentPresets.register(await composeStandardPreset(ctx.agentPresets, { id: 'minimal-business' }, { personaPrefix: '用户配置的业务角色正文。' }))
  const agent = await agentOn(ctx, 'minimal-business-session', 'minimal-business')
  await turn(ctx, agent, '核对当前输入。')
  const messages = agent.session.snapshotEvents().filter(event => event.type === 'system/message')
  expect(messages).toHaveLength(1)
  expect(messages[0]).toMatchObject({ data: { message: { content: [{ type: 'text', text: MINIMAL_SYSTEM_PROMPT + '\n\n用户配置的业务角色正文。' }] } } })
  expect(
    agent.session
      .snapshotEvents()
      .filter(event => event.type === 'user/message')
      .some(event => event.data.source.kind === 'runtime-context' || event.data.source.kind === 'agent-instructions')
  ).toBe(false)
  expect(requests.at(-1)?.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(['skill', 'read', 'write', 'edit', 'bash']))
})

it('rejects a conflicting business tool nested in a new isolated group', async () => {
  const { ctx } = await presetHarness()
  await expect(
    composeStandardPreset(
      ctx.agentPresets,
      { id: 'company-test', name: 'Company test' },
      { plugins: [{ id: 'company-group', name: 'cordis:group', group: true, config: [{ id: 'duplicate-tool', name: '@deepseek-ai/dsh-tool-fs' }] }] }
    )
  ).rejects.toThrow('STANDARD_PRESET_PLUGIN_CONFLICT: duplicate-tool')
})

it('keeps the four official modes and their disabled or conditional providers', async () => {
  const { ctx } = await presetHarness()
  await completion(ctx)
  const standard = await agentOn(ctx, 'mode-standard', 'standard')
  const minimal = await agentOn(ctx, 'mode-minimal', 'minimal')
  const ptc = await agentOn(ctx, 'mode-ptc', 'ptc')
  const creative = await agentOn(ctx, 'mode-creative', 'cordis')
  const tools = (agent: typeof standard) =>
    ctx.tools
      .schemas(agent)
      .map(row => row.name)
      .sort()
  expect(tools(standard)).toContain('workflow')
  expect(tools(ptc)).not.toContain('workflow')
  expect(tools(creative)).toEqual(expect.arrayContaining(['workflow', 'cordis_inspect_list', 'cordis_inspect_query']))
  expect(tools(creative)).toContain('present')
  expect(tools(creative)).toContain('plugin_manager')
  expect(tools(standard)).not.toContain('plugin_manager')
  expect(tools(ptc)).not.toContain('plugin_manager')
  const inspect = await ctx.tools.execute({ callId: 'creator-inspect' as never, name: 'cordis_inspect_list', arguments: {}, agent: creative, signal: new AbortController().signal })
  expect(inspect.isError).toBe(false)
  expect(tools(minimal)).toHaveLength(1)
  expect(tools(minimal)[0]).toMatch(/bash|pwsh/)
  expect(ctx.commands.list(minimal)).toEqual([])
  expect(ctx.commands.list(creative).map(row => row.name)).toContain('compact')
  for (const agent of [standard, ptc, creative]) {
    expect(tools(agent)).not.toContain('subagent_codex')
    expect(tools(agent)).not.toContain('subagent_claude_code')
    expect(tools(agent)).not.toContain('ralph')
    expect(ctx.agentPresets.serviceFor(agent, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  }
  const catalog = await ctx.agentPresets.list()
  expect(new Set(catalog.map(row => row.id)).size).toBe(catalog.length)
  expect(catalog.find(row => row.id === 'auto-negotiation')?.description).toBeTruthy()
  await record('official-mode-differences', {
    catalog,
    standard: tools(standard),
    minimal: tools(minimal),
    ptc: tools(ptc),
    creative: tools(creative),
    inspect,
    optionalProviders: 'Codex, Claude Code and Ralph remain disabled; plugin-manager remains disabled in standard/PTC and conditional on profileContext in Creator'
  })
})
