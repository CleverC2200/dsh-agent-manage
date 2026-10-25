import { officialStandardDocument, presetHarness, agentOn, completion, turn } from './core-preset-harness.js'
import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, readFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BusinessResources } from '../src/runtime/business-resources.js'
import type { SkillProvider, SkillProviderControl, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
it('selects original APS profile with unique Manage analysis sources and refuses malformed explicit references', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'aps-resource-'))
  const source = fileURLToPath(new URL('../business-resources/inventory-apsplan/', import.meta.url))
  const root = join(temporary, 'installed')
  await cp(source, root, { recursive: true })
  const profile = JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8'))
  const registered: Parameters<ConstructorParameters<typeof BusinessResources>[0]['agentPresets']['register']>[0][] = []
  let provider: SkillProvider
  const host = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ invalidate() {}, signal: new AbortController().signal })
        return () => {}
      },
      async list(options: SkillLookupOptions = {}) {
        return provider.list(options)
      },
      async get(name: string, options: SkillLookupOptions = {}) {
        const candidate = (await provider.list(options)).find(row => row.name === name)
        return candidate ? provider.get(candidate, options) : undefined
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register(definition: (typeof registered)[number]) {
        registered.push(definition)
        return async () => {}
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as ConstructorParameters<typeof BusinessResources>[0], join(temporary, 'selected.json'))
  const skills = ['plan-operations-weekly-report', 'answer-visualization', 'order-satisfaction-analysis']
  try {
    await resources.register([
      {
        id: 'gea-html-inventory-apsplan',
        label: 'APS',
        root,
        prompt: 'prompt.json',
        capability: 'capability.json',
        profile: { label: 'APS', consumerCode: 'aps', skills, crossConsumers: ['sales_forecast'] },
        skillFiles: Object.fromEntries(skills.map(name => [name, `skills/${name}/SKILL.md`]))
      }
    ])
    expect((await provider!.list({})).map(item => item.name).sort()).toEqual([...skills].sort())
    expect((await resources.select('gea-html-inventory-apsplan', new AbortController().signal)).profile?.skills).toEqual(skills)
    const agent = await resources.pluginAgent('gea-html-inventory-apsplan')
    expect(agent.publication).toBe('ready')
    expect(agent.prompt).toBe(profile.persona)
    expect(agent.skills.map(skill => skill.name).sort()).toEqual([...skills].sort())
    expect(agent.skills.every(skill => skill.enabled)).toBe(true)
    expect((registered.at(-1)!.plugins[0].config as { prefix: string }).prefix).toContain(profile.persona)
    // Existing personal instructions remain an explicit override after a restart.
    await resources.savePlugin({ id: agent.id, prompt: 'Personal instructions to preserve', skills: [] })
    const restarted = new BusinessResources(host as unknown as ConstructorParameters<typeof BusinessResources>[0], join(temporary, 'selected.json'))
    await restarted.load()
    await restarted.register([
      {
        id: agent.id,
        label: 'APS',
        root,
        prompt: 'prompt.json',
        capability: 'capability.json',
        profile,
        skillFiles: Object.fromEntries(skills.map(name => [name, `skills/${name}/SKILL.md`]))
      }
    ])
    const preserved = await restarted.pluginAgent(agent.id)
    expect(preserved.prompt).toBe('Personal instructions to preserve')
    expect(preserved.skills).toEqual([])
    expect(preserved.publication).toBe('ready')
    await restarted.dispose()
    await writeFile(join(temporary, 'prompt.json'), JSON.stringify({ persona: 'Exact original', consumerCode: 'aps', skills, crossConsumers: ['sales_forecast'] }))
    await writeFile(
      join(temporary, 'capability.json'),
      JSON.stringify({
        id: 'inventory-bad',
        data: { consumerCode: 'aps' },
        skills,
        resourceReferences: { skills: ['sales-forecast-result-analysis', 'sales-forecast-result-analysis'], consumers: ['sales_forecast'] }
      })
    )
    await resources.register([
      {
        id: 'gea-html-inventory-bad',
        label: 'Bad APS',
        root: temporary,
        prompt: 'prompt.json',
        capability: 'capability.json',
        profile: { label: 'APS', consumerCode: 'aps', skills, crossConsumers: ['sales_forecast'] }
      }
    ])
    await expect(resources.select('gea-html-inventory-bad', new AbortController().signal)).rejects.toThrow('INVALID_AGENT_RESOURCE_REFERENCES')
  } finally {
    await resources.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
})

it('publishes the installed APS persona and three callable Skills to a real Core session', async () => {
  const { ctx, home } = await presetHarness()
  const requests = await completion(ctx)
  const root = join(home, 'installed-aps')
  await cp(fileURLToPath(new URL('../business-resources/inventory-apsplan/', import.meta.url)), root, { recursive: true })
  const profile = JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8'))
  const id = 'gea-html-inventory-apsplan'
  await ctx.agentResources.register([
    {
      id,
      label: profile.label,
      root,
      prompt: 'prompt.json',
      capability: 'capability.json',
      profile,
      skillFiles: Object.fromEntries(profile.skills.map((name: string) => [name, `skills/${name}/SKILL.md`]))
    }
  ])
  await ctx.agentResources.select(id, new AbortController().signal, home)
  const agent = await agentOn(ctx, 'installed-aps-session', id, undefined, home)
  const visible = (await ctx.skills.list({ scope: agent, cwd: home })).filter(skill => skill.invocation.modelInvocable).map(skill => skill.name)
  for (const name of profile.skills) {
    expect(visible).toContain(name)
    const result = await ctx.tools.execute({ callId: name as never, name: 'skill', arguments: { name }, agent, signal: new AbortController().signal })
    expect(JSON.stringify(result)).not.toContain('not available for model invocation')
    expect(JSON.stringify(result)).toContain(name)
  }
  for (const name of ['inventory-apsplan', 'sales-forecast-result-analysis', 'sales-ops-problem-analysis']) expect(visible).not.toContain(name)
  await turn(ctx, agent, 'Describe the available analysis capabilities without querying data.')
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain('RTGO')
}, 60000)
