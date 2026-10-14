/** Selected Skill Session crosses real GEA pre-step and system-prompt hooks. */
import { expect, it, onTestFinished } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { agentOn, completion, presetHarness, record, turn } from './core-preset-harness.js'

it('keeps selected Skill and general tools after GEA hooks without granting a business profile', async () => {
  const { mountBusinessPrompts } = await import('preset-integration-gea/host/prompt-runtime')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx, 262_144, true)
  await writeFile(join(home, 'SKILL.md'), '---\nname: selected-skill\ndescription: Selected task instructions\n---\nKeep the selected task scope.\n')
  const resources = new BusinessResources(ctx, join(home, 'selected.json'))
  onTestFinished(() => resources.dispose())
  await resources.register([
    {
      id: 'selected-owner',
      label: 'Selected owner',
      root: home,
      profile: { label: 'Selected owner', consumerCode: 'never-granted', skills: ['selected-skill'] },
      skillFiles: { 'selected-skill': 'SKILL.md' }
    }
  ])
  const selected = await resources.select('skill:selected-skill', new AbortController().signal, home)
  const agent = await agentOn(ctx, 'skill-gea-session', selected.preset)
  const standard = await agentOn(ctx, 'skill-gea-reference', 'standard')
  const standardTools = ctx.tools.schemas(standard).map(row => row.name)
  const release = mountBusinessPrompts(ctx, { config: { runtimeDir: home }, watchIdentity: () => () => {} } as never, createCapabilityRegistry([]))
  onTestFinished(release)
  await turn(ctx, agent, 'Organize the selected Skill task using official tools.')
  const finalTools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(finalTools).toEqual(expect.arrayContaining(standardTools))
  expect(finalTools.filter(name => !standardTools.includes(name))).toEqual(['gea_runtime_diagnose'])
  expect(finalTools).not.toContain('gea_evidence_read')
  expect(finalTools).not.toContain('gea_capabilities')
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('todo/write')
  const skill = await ctx.tools.execute({ callId: 'selected-skill-call' as never, name: 'skill', arguments: { name: selected.skill }, agent, signal: new AbortController().signal })
  expect(JSON.stringify(skill)).toContain('Keep the selected task scope.')
  const denied = await ctx.tools.execute({
    callId: 'skill-gea-denied' as never,
    name: 'gea_evidence_read',
    arguments: { artifact: 'no-grant' },
    agent,
    signal: new AbortController().signal
  })
  expect(JSON.stringify(denied)).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  await record('skill-gea-hooks', { inputs: { gea: process.env.DSH_GEA_CHECKOUT, workbench: process.env.DSH_WORKBENCH_CHECKOUT }, finalTools, skill, denied })
})
