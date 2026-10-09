import { officialStandardDocument } from './core-preset-harness.js'
import { expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BusinessResources } from '../src/runtime/business-resources.js'
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
it('selects original APS profile with unique Manage analysis sources and refuses malformed explicit references', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'aps-resource-'))
  const root = fileURLToPath(new URL('../business-resources/inventory-apsplan/', import.meta.url))
  let provider: SkillProvider
  const host = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ invalidate() {}, signal: new AbortController().signal })
        return () => {}
      },
      async list() {
        return provider.list({})
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register() {
        return async () => {}
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as ConstructorParameters<typeof BusinessResources>[0], join(temporary, 'selected.json'))
  const skills = ['inventory-apsplan', 'sales-forecast-result-analysis', 'sales-ops-problem-analysis']
  try {
    await resources.register([
      {
        id: 'aps-analysis-skills',
        label: 'APS analysis',
        root: fileURLToPath(new URL('../business-resources/aps-analysis/', import.meta.url)),
        profile: { label: 'APS analysis', consumerCode: 'aps', skills: skills.slice(1) },
        skillFiles: { 'sales-forecast-result-analysis': 'sales-forecast-result-analysis.skill.md', 'sales-ops-problem-analysis': 'sales-ops-problem-analysis.skill.md' }
      },
      {
        id: 'gea-html-inventory-apsplan',
        label: 'APS',
        root,
        prompt: 'prompt.json',
        capability: 'capability.json',
        profile: { label: 'APS', consumerCode: 'aps', skills, crossConsumers: ['sales_forecast'] },
        skillFiles: { 'inventory-apsplan': 'skills/aps/SKILL.md' }
      }
    ])
    expect((await provider!.list({})).map(item => item.name).sort()).toEqual([...skills].sort())
    expect((await resources.select('gea-html-inventory-apsplan', new AbortController().signal)).profile?.skills).toEqual(skills)
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
