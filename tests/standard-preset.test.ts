import { writeFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { composeStandardPreset } from '../src/runtime/standard-preset.js'
import { expect, it, vi } from 'vitest'
import { agentOn, completion, history, official, presetHarness, record, turn } from './core-preset-harness.js'

it('publishes the original intelligent orchestration identity beside all official choices', async () => {
  const { ctx } = await presetHarness()
  expect(await ctx.agentPresets.resolve('auto-negotiation')).toEqual({ id: 'auto-negotiation' })
  expect(await ctx.agentPresets.list()).toContainEqual({
    id: 'auto-negotiation',
    name: '智能编排',
    description: '通用任务的完整官方标准能力，支持上下文压缩、规划、任务和协作。',
    order: 0
  })
  expect((await ctx.agentPresets.list()).map(row => row.id)).toEqual(expect.arrayContaining(['standard', 'minimal', 'ptc']))
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

it('preserves every official declaration field including disabled expressions and isolated groups', async () => {
  const { ctx } = await presetHarness()
  const standard = await ctx.agentPresets.readDocument('standard')
  const composed = await ctx.agentPresets.readDocument('auto-negotiation')
  expect(load(composed.content, { schema: entryListSchema })).toEqual(load(standard.content, { schema: entryListSchema }))
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
