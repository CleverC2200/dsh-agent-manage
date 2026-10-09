// @vitest-environment node
/** Actual GEA hooks on the production Session; business identity is an offline adapter. */
import { expect, it, onTestFinished } from 'vitest'
import { agentOn, completion, presetHarness, record, turn } from './core-preset-harness.js'

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
