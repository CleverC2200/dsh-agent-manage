/** Selected resources exercise production Core registry, Session and compaction. */
import { expect, it, onTestFinished } from 'vitest'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { MINIMAL_SYSTEM_PROMPT } from '../src/runtime/standard-preset.js'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { agentOn, completion, history, official, presetHarness, record, turn } from './core-preset-harness.js'

async function pluginFailureHarness() {
  let failPersona = false
  const { ctx, home } = await presetHarness({
    importModule: async name => {
      if (failPersona && name === '@deepseek-ai/dsh-persona') throw Error('SELECTED_SKILL_PLUGIN_LOAD_FAILED')
      return official(name)
    }
  })
  const index = join(home, 'selected.json')
  await writeFile(join(home, 'SKILL.md'), '---\nname: selected-skill\ndescription: Selected instructions\n---\nOriginal Skill body.\n')
  await writeFile(join(home, 'prompt.json'), JSON.stringify({ persona: 'Original persona.', consumerCode: 'never-granted', skills: ['selected-skill'] }))
  const resources = new BusinessResources(ctx, index)
  onTestFinished(() => resources.dispose())
  await resources.register([
    {
      id: 'selected-owner',
      label: 'Selected owner',
      root: home,
      prompt: 'prompt.json',
      profile: { label: 'Selected owner', consumerCode: 'never-granted', skills: ['selected-skill'] },
      skillFiles: { 'selected-skill': 'SKILL.md' }
    }
  ])
  return {
    ctx,
    home,
    index,
    resources,
    failPlugin: () => {
      failPersona = true
    }
  }
}

it('rejects a Skill selection when an enabled standard plugin fails to load without persisting the failed selection', async () => {
  const { ctx, home, index, resources, failPlugin } = await pluginFailureHarness()
  failPlugin()
  await expect(resources.select('skill:selected-skill', new AbortController().signal, home)).rejects.toThrow('persona (@deepseek-ai/dsh-persona): never started')
  await expect(readFile(index, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(ctx.agentPresets.resolve('agent-resource-skill')).rejects.toThrow('Unknown agent preset')
})

it('preserves the selected Prompt and its recovery index when a new Skill activation fails', async () => {
  const { ctx, home, index, resources, failPlugin } = await pluginFailureHarness()
  await resources.select('selected-owner', new AbortController().signal, home)
  const previous = await readFile(index, 'utf8')
  failPlugin()
  await expect(resources.select('skill:selected-skill', new AbortController().signal, home)).rejects.toThrow('persona (@deepseek-ai/dsh-persona): never started')
  expect(await readFile(index, 'utf8')).toBe(previous)
  expect(await ctx.agentPresets.resolve('selected-owner')).toEqual({ id: 'selected-owner' })
})

it('rejects a broken restored Skill preset and preserves the selected identity for recovery', async () => {
  const { ctx, index, resources, failPlugin } = await pluginFailureHarness()
  const previous = '{"version":1,"selected":["agent-resource-skill"]}\n'
  await writeFile(index, previous)
  failPlugin()
  await expect(resources.load()).rejects.toThrow('persona (@deepseek-ai/dsh-persona): never started')
  expect(await readFile(index, 'utf8')).toBe(previous)
  await expect(ctx.agentPresets.resolve('agent-resource-skill')).rejects.toThrow('Unknown agent preset')
})

it('keeps rejecting a Prompt whose enabled standard plugin cannot load', async () => {
  const { ctx, home, index, resources, failPlugin } = await pluginFailureHarness()
  failPlugin()
  await expect(resources.select('selected-owner', new AbortController().signal, home)).rejects.toThrow('persona (@deepseek-ai/dsh-persona): never started')
  await expect(readFile(index, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(ctx.agentPresets.resolve('selected-owner')).rejects.toThrow('Unknown agent preset')
})

it('creates a selected Skill Session with the full standard tools and compaction and recovers its stable identity', async () => {
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx, 262_144, true)
  const index = join(home, 'selected.json')
  await writeFile(join(home, 'SKILL.md'), '---\nname: selected-skill\ndescription: Selected task instructions\n---\nKeep the selected task scope.\n')
  const resources = new BusinessResources(ctx, index)
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
  expect(selected).toEqual({ id: 'skill:selected-skill', preset: 'agent-resource-skill', skill: 'selected-skill' })
  const standard = await agentOn(ctx, 'skill-reference', 'standard')
  const agent = await agentOn(ctx, 'selected-skill-session', selected.preset, await history(20_000))
  const names = (subject: typeof agent) =>
    ctx.tools
      .schemas(subject)
      .map(row => row.name)
      .sort()
  expect(names(agent)).toEqual(names(standard))
  expect(ctx.commands.list(agent)).toEqual(ctx.commands.list(standard))
  expect(ctx.agentPresets.serviceFor(agent, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  const standardDoc = await ctx.agentPresets.readDocument('standard')
  const skillDoc = await ctx.agentPresets.readDocument(selected.preset)
  const expected = (load(standardDoc.content, { schema: entryListSchema }) as { name: string; config?: unknown }[]).filter(row => row.name !== '@deepseek-ai/dsh-agent-instructions')
  expected.find(row => row.name === '@deepseek-ai/dsh-persona')!.config = { prefix: MINIMAL_SYSTEM_PROMPT, suffix: '', complete: true, includeRuntimeContext: false }
  expect(load(skillDoc.content, { schema: entryListSchema })).toEqual(expected)
  expect(await ctx.agentPresets.list()).toContainEqual({
    id: 'agent-resource-skill',
    name: 'Skill',
    description: '使用所选 Skill 开始新任务，保留完整标准工具、上下文压缩与协作能力。'
  })
  expect((await resources.list()).find(row => row.id === 'skill:selected-skill')).toMatchObject({ description: 'Selected task instructions' })
  expect((await ctx.skills.list({ cwd: home })).filter(row => row.name === selected.skill)).toHaveLength(1)
  await turn(ctx, agent, 'Continue the selected Skill task.')
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  expect(agent.session.snapshotEvents().map(row => row.type)).toContain('todo/write')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  const manual = await agentOn(ctx, 'selected-skill-manual', selected.preset, await history(100))
  expect((await ctx.commands.execute(manual, '/compact', [], new AbortController().signal))?.result).toMatchObject({
    kind: 'success',
    text: expect.stringMatching(/^Compacted \d+ history items/)
  })
  await turn(ctx, manual, 'Continue after the selected Skill compact command.')
  expect(manual.session.snapshotEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await record('skill-capabilities', {
    selected,
    tools: names(agent),
    commands: ctx.commands.list(agent),
    automaticSummary: true,
    manualSummary: true,
    completed: true,
    grantsBusinessProfile: 'profile' in selected
  })
  await resources.dispose()
  const recovered = new BusinessResources(ctx, index)
  onTestFinished(() => recovered.dispose())
  await recovered.load()
  expect(await ctx.agentPresets.resolve('agent-resource-skill')).toEqual({ id: 'agent-resource-skill' })
  expect(JSON.parse(await readFile(index, 'utf8'))).toEqual({ version: 1, selected: ['agent-resource-skill'] })
})
