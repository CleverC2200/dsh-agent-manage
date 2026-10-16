import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import type { SkillLookupOptions, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { stripFrontmatter } from '../src/catalog/skills-parse.js'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { officialStandardDocument } from './core-preset-harness.js'

it('discovers the supplied base inventory persona, six Skills and complete local references without replacing the original Skill or Consumer', async () => {
  const root = resolve('business-resources/inventory-aqkc')
  const names = ['aging-stagnation-monitoring', 'future-aging-projection', 'inventory-deviation-monitoring', 'inventory-policy', 'report-templates', 'shortage-monitoring']
  const skills = ['inventory-aqkc', ...names]
  const source = JSON.parse(await readFile(join(root, 'SOURCE.json'), 'utf8'))
  const prompt = JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8'))
  const capability = JSON.parse(await readFile(join(root, 'capability.json'), 'utf8'))
  const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
  expect(digest(prompt.persona)).toBe(source.personaSha256)
  expect(prompt.persona).toContain('你是思念食品基地库存运营监控 Agent')
  expect(prompt.skills).toEqual(skills)
  expect(capability.skills).toEqual(skills)
  expect(capability.resourceReferences).toEqual({ skills: names, consumers: ['sales_forecast'] })
  expect(capability).toMatchObject({ data: { consumerCode: 'base-safety-stock' }, maxEffect: 'view', layers: ['read'] })
  for (const [file, expected] of Object.entries(source.files)) expect(digest(await readFile(join(root, file))), file).toBe(expected)
  expect(digest(await readFile(join(root, 'skills/aqkc/SKILL.md')))).toBe(source.retainedSkillSha256)
  const home = await mkdtemp(join(tmpdir(), 'base-inventory-resources-'))
  let provider: SkillProvider
  let published: unknown
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
      async register(definition: unknown) {
        published = definition
        return async () => {}
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as ConstructorParameters<typeof BusinessResources>[0], join(home, 'selected.json'))
  try {
    await resources.register([
      {
        id: 'gea-html-inventory-aqkc',
        label: '基地库存',
        root,
        prompt: 'prompt.json',
        capability: 'capability.json',
        publishPreset: true,
        profile: { label: '基地库存', consumerCode: 'base-safety-stock', skills, crossConsumers: ['sales_forecast'] },
        skillFiles: { 'inventory-aqkc': 'skills/aqkc/SKILL.md', ...Object.fromEntries(names.map(name => [name, `skills/${name}/SKILL.md`])) }
      }
    ])
    expect((await host.skills.list({ cwd: home })).map(row => row.name).sort()).toEqual([...skills].sort())
    expect((await resources.list({ cwd: home })).find(row => row.id === 'gea-html-inventory-aqkc')).toMatchObject({ enabled: true, skills })
    expect(JSON.stringify(published)).toContain(JSON.stringify(prompt.persona).slice(1, -1))
    expect((await resources.select('gea-html-inventory-aqkc', new AbortController().signal, home)).profile).toMatchObject({
      consumerCode: 'base-safety-stock',
      skills,
      crossConsumers: ['sales_forecast']
    })
    let references = 0
    for (const name of names) {
      const skill = await host.skills.get(name, { cwd: home })
      expect(skill?.content).toBe(stripFrontmatter(await readFile(join(root, `skills/${name}/SKILL.md`), 'utf8')))
      expect(skill?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'skills', name) })
      for (const file of Object.keys(source.files).filter(file => file.startsWith(`skills/${name}/`) && !file.endsWith('/SKILL.md'))) {
        expect(digest(await readFile(resolve(dirname(join(root, `skills/${name}/SKILL.md`)), file.slice(`skills/${name}/`.length))))).toBe(source.files[file])
        references++
      }
    }
    expect(references).toBe(9)
  } finally {
    await resources.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
