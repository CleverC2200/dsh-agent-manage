/** Trusted plugin edits retain the native identity and original source/profile. */
import { join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { agentOn, presetHarness } from './core-preset-harness.js'

it('customizes a plugin Agent under its original preset, and separates Agent enablement from its fixed Cube switch', async () => {
  const { ctx, home } = await presetHarness()
  const source = join(home, 'plugin-source')
  await mkdir(source)
  const prompt = JSON.stringify({ persona: 'ORIGINAL_PLUGIN_PROMPT', consumerCode: 'trusted-reader', skills: ['plugin-skill'] })
  const body = '---\nname: plugin-skill\ndescription: Plugin instructions\n---\nORIGINAL_PLUGIN_SKILL\n'
  await writeFile(join(source, 'prompt.json'), prompt)
  await writeFile(join(source, 'SKILL.md'), body)
  const index = join(home, 'plugins.json')
  let resources = new BusinessResources(ctx, index)
  await resources.load()
  const definition = {
    id: 'plugin-reader',
    label: 'Reader',
    root: source,
    prompt: 'prompt.json',
    publishPreset: true,
    cube: true,
    profile: { label: 'Reader', consumerCode: 'trusted-reader', skills: ['plugin-skill'] },
    skillFiles: { 'plugin-skill': 'SKILL.md' }
  }
  await resources.register([definition])
  const before = ctx.agentPresets.defaultId
  const original = await resources.pluginAgent(definition.id)
  expect(original.origin).toBe('plugin')
  expect(original.error).toBeUndefined()
  const old = await agentOn(ctx, 'plugin-original', definition.id, undefined, home)
  const updated = await resources.savePlugin({
    id: definition.id,
    prompt: 'PERSONAL_PLUGIN_PROMPT',
    skills: original.skills.map(skill => ({ ...skill, content: 'PERSONAL_PLUGIN_SKILL' }))
  })
  expect(updated.preset).toBe(definition.id)
  expect(updated.customized).toBe(true)
  expect((await resources.copyable(definition.id)).skills[0].content).toBe('PERSONAL_PLUGIN_SKILL')
  const current = await agentOn(ctx, 'plugin-customized', definition.id, undefined, home)
  expect(JSON.stringify(await ctx.systemPrompt.assemble({ scope: current, agent: current } as never))).toContain('PERSONAL_PLUGIN_PROMPT')
  expect((await ctx.skills.get('plugin-skill', { scope: current, cwd: home }))?.content).toBe('PERSONAL_PLUGIN_SKILL')
  expect((await ctx.skills.get('plugin-skill', { scope: old, cwd: home }))?.content).toBe('ORIGINAL_PLUGIN_SKILL')
  expect((await resources.select(definition.id, new AbortController().signal)).profile?.consumerCode).toBe('trusted-reader')
  expect(await readFile(join(source, 'prompt.json'), 'utf8')).toBe(prompt)
  expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe(body)
  await expect(resources.savePlugin({ id: definition.id, prompt: 'bad', consumerCode: 'other' })).rejects.toThrow()
  await resources.setCubeEnabled(definition.id, false)
  expect((await resources.pluginAgent(definition.id)).enabled).toBe(true)
  await resources.setPluginEnabled(definition.id, false)
  expect((await resources.pluginAgent(definition.id)).publication).toBe('disabled')
  await expect(ctx.agentPresets.resolve(definition.id)).rejects.toThrow()
  await resources.dispose()
  resources = new BusinessResources(ctx, index)
  await resources.load()
  await resources.register([definition])
  expect((await resources.pluginAgent(definition.id)).enabled).toBe(false)
  await resources.setPluginEnabled(definition.id, true)
  expect((await resources.pluginAgent(definition.id)).prompt).toBe('PERSONAL_PLUGIN_PROMPT')
  expect(resources.cubeSource(definition.id)).toBeUndefined()
  expect(ctx.agentPresets.defaultId).toBe(before)
  await resources.dispose()
})
