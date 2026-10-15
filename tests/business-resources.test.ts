import { officialStandardDocument } from './core-preset-harness.js'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillProvider, SkillProviderControl, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
type NativeHost = ConstructorParameters<typeof BusinessResources>[0]
type Definition = Parameters<NativeHost['agentPresets']['register']>[0]
import { BusinessResources } from '../src/runtime/business-resources.js'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
it('isolates malformed Skill metadata within one provider and applies the same fail-closed rule to a cached body lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-malformed-'))
  roots.push(root)
  await writeFile(join(root, 'bad.md'), '---\nname: broken-skill\ndescription: reason: detail\n---\nBroken body\n')
  const healthy = '---\nname: healthy-skill\ndescription: Healthy rules\n---\nHealthy exact body\n'
  await writeFile(join(root, 'healthy.md'), healthy)
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
      async register() {
        return async () => {}
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await resources.register([
    {
      id: 'broken',
      label: 'Broken',
      root,
      prompt: 'prompt.json',
      profile: { label: 'Broken', consumerCode: 'known', skills: ['broken-skill'] },
      skillFiles: { 'broken-skill': 'bad.md' }
    },
    { id: 'healthy', label: 'Healthy', root, profile: { label: 'Healthy', consumerCode: 'known', skills: ['healthy-skill'] }, skillFiles: { 'healthy-skill': 'healthy.md' } }
  ])
  const candidates = await provider.list({})
  expect(candidates.map(candidate => candidate.name)).toEqual(['healthy-skill'])
  expect((await provider.get(candidates[0], {}))?.content).toBe('Healthy exact body\n')
  const rows = await resources.list()
  expect(rows.find(row => row.id === 'broken')?.error).toContain('broken-skill')
  await writeFile(join(root, 'healthy.md'), '---\nname: healthy-skill\ndescription: reason: detail\n---\nChanged body\n')
  expect(await provider.get(candidates[0], {})).toBeUndefined()
  const controller = new AbortController()
  controller.abort()
  await expect(provider.list({ signal: controller.signal })).rejects.toThrow()
  await expect(provider.get(candidates[0], { signal: controller.signal })).rejects.toThrow()
  await resources.dispose()
})
it('lists installed prompt metadata before reading the selected original persona and restores only selected identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-choice-'))
  roots.push(root)
  const registered: Definition[] = []
  const providers: SkillProvider[] = []
  const host = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        providers.push(create({ invalidate() {}, signal: new AbortController().signal }))
        return () => {}
      },
      async list() {
        return []
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async resolve(id: string) {
        return { id }
      },
      async register(value: Definition) {
        registered.push(value)
        return async () => {
          registered.splice(registered.indexOf(value), 1)
        }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await resources.load()
  const definition = { id: 'original', label: 'Original', root, prompt: 'prompt.json', profile: { label: 'Original', consumerCode: 'known', skills: [] } }
  const owner = await resources.register([definition])
  expect(await resources.list()).toMatchObject([{ id: 'original', label: 'Original', kind: 'prompt', installed: true, enabled: true, provider: 'package', skills: [] }])
  expect(registered).toEqual([])
  await writeFile(join(root, 'prompt.json'), JSON.stringify({ ...definition.profile, persona: 'Original exact words\nSecond line' }))
  const selected = await resources.select('original', new AbortController().signal)
  expect(selected.preset).toBe('original')
  expect((registered[0].plugins[0].config as { prefix: string }).prefix).toContain('Original exact words\nSecond line')
  expect(JSON.parse(await readFile(join(root, 'selected.json'), 'utf8'))).toEqual({ version: 1, selected: ['original'] })
  expect(registered).toHaveLength(1)
  await resources.dispose()
  expect(registered).toHaveLength(0)
  const restored = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await restored.load()
  await restored.register([definition])
  expect(registered).toHaveLength(1)
  await restored.dispose()
  await owner()
})
it('publishes opted-in installed business presets before any selection and releases them with their owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-discovery-'))
  roots.push(root)
  const registered: Definition[] = []
  const host = {
    skills: {
      registerProvider: () => () => {},
      async list() {
        return []
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async resolve(id: string) {
        return { id }
      },
      async register(value: Definition) {
        registered.push(value)
        return async () => {
          registered.splice(registered.indexOf(value), 1)
        }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await resources.load()
  await writeFile(join(root, 'prompt.json'), JSON.stringify({ label: 'Base stock', consumerCode: 'base-safety-stock', skills: [], persona: 'Exact original business persona' }))
  const owner = await resources.register([
    { id: 'base-stock', label: 'Base stock', root, prompt: 'prompt.json', publishPreset: true, profile: { label: 'Base stock', consumerCode: 'base-safety-stock', skills: [] } },
    { id: 'preview', label: 'Preview', root, prompt: 'missing.json', publishPreset: false, profile: { label: 'Preview', consumerCode: 'preview', skills: [] } },
    { id: 'disabled', label: 'Disabled', root, prompt: 'missing.json', publishPreset: true, enabled: false, profile: { label: 'Disabled', consumerCode: 'disabled', skills: [] } },
    { id: 'broken', label: 'Broken', root, prompt: 'missing.json', publishPreset: true, profile: { label: 'Broken', consumerCode: 'broken', skills: [] } }
  ])
  expect(registered.map(p => p.id)).toEqual(['base-stock'])
  expect((registered[0].plugins[0].config as { prefix: string }).prefix).toContain('Exact original business persona')
  await expect(readFile(join(root, 'selected.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await resources.list()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'broken', enabled: false, error: expect.any(String) }), expect.objectContaining({ id: 'base-stock', enabled: true })])
  )
  await resources.select('base-stock', new AbortController().signal)
  expect(registered.map(p => p.id)).toEqual(['base-stock'])
  await owner()
  expect(registered).toEqual([])
  await resources.dispose()
})
it('refuses disabled resources and cleans partial registration on cancellation without writing source files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-cancel-'))
  roots.push(root)
  const source = JSON.stringify({ consumerCode: 'known', skills: [], persona: 'Keep user words' })
  await writeFile(join(root, 'prompt.json'), source)
  const controller = new AbortController()
  let disposed = 0
  const host = {
    skills: {
      registerProvider() {
        return () => {}
      },
      async list() {
        return []
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register() {
        controller.abort()
        return async () => {
          disposed++
        }
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await resources.load()
  await resources.register([
    { id: 'disabled', label: 'Disabled', root, prompt: 'prompt.json', profile: { label: 'Disabled', consumerCode: 'known', skills: [] }, enabled: false },
    { id: 'original', label: 'Original', root, prompt: 'prompt.json', profile: { label: 'Original', consumerCode: 'known', skills: [] } }
  ])
  await expect(resources.select('disabled', new AbortController().signal)).rejects.toThrow('AGENT_RESOURCE_DISABLED_OR_MISSING')
  await expect(resources.select('original', controller.signal)).rejects.toThrow()
  expect(disposed).toBe(1)
  await expect(readFile(join(root, 'selected.json'))).rejects.toThrow()
  expect(await readFile(join(root, 'prompt.json'), 'utf8')).toBe(source)
  await resources.dispose()
})
it('loads a packaged Skill verbatim, rejects symlink escapes and withdraws an unloaded owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-skill-'))
  roots.push(root)
  const { symlink } = await import('node:fs/promises')
  const raw = '---\nname: original-skill\ndescription: Original rules\n---\nOriginal body ${CLAUDE_PLUGIN_ROOT}\n'
  await writeFile(join(root, 'SKILL.md'), raw)
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
      },
      async get(name: string, options: SkillLookupOptions) {
        const candidate = (await provider.list(options)).find(item => item.name === name)
        return candidate && provider.get(candidate, options)
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
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await resources.load()
  const remove = await resources.register([
    {
      id: 'original',
      label: 'Original',
      root,
      prompt: 'prompt.json',
      profile: { label: 'Original', consumerCode: 'known', skills: ['original-skill'] },
      skillFiles: { 'original-skill': 'SKILL.md' }
    }
  ])
  const candidate = (await provider.list({}))[0]
  expect((await provider.get(candidate, {})).content).toBe('Original body ${CLAUDE_PLUGIN_ROOT}\n')
  await resources.select('skill:original-skill', new AbortController().signal)
  await remove()
  expect(await provider.get(candidate, {})).toBeUndefined()
  const outside = await mkdtemp(join(tmpdir(), 'resource-outside-'))
  roots.push(outside)
  await writeFile(join(outside, 'SKILL.md'), raw)
  await symlink(join(outside, 'SKILL.md'), join(root, 'escape.md'))
  await resources.register([
    {
      id: 'escape',
      label: 'Escape',
      root,
      prompt: 'prompt.json',
      profile: { label: 'Escape', consumerCode: 'known', skills: ['original-skill'] },
      skillFiles: { 'original-skill': 'escape.md' }
    }
  ])
  const rows = await resources.list()
  expect(rows.find(row => row.id === 'escape')?.error).toContain('INVALID_AGENT_RESOURCE_PATH')
  expect(await readFile(join(root, 'SKILL.md'), 'utf8')).toBe(raw)
  await resources.dispose()
})

it('publishes only selected validated page Interpreter choices which still have installed enabled resource owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'resource-interpreters-'))
  roots.push(root)
  const host = {
    skills: { registerProvider: () => () => {}, list: async () => [] },
    agentPresets: { readDocument: officialStandardDocument, register: async () => async () => {}, resolve: async (id: string) => ({ id }) }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  await writeFile(
    join(root, 'prompt.json'),
    JSON.stringify({
      persona: 'original',
      consumerCode: 'branch',
      skills: [],
      pageAgents: ['gea-html-inventory-fc', 'gea-html-inventory-qll', 'gea-html-inventory-missing', 'gea-html-inventory-disabled']
    })
  )
  await resources.register([{ id: 'gea-html-inventory-fc', label: 'Branch', root, prompt: 'prompt.json', profile: { label: 'Branch', consumerCode: 'branch', skills: [] } }])
  const removeOther = await resources.register([
    { id: 'gea-html-inventory-qll', label: 'Full chain', root, prompt: 'other.json', profile: { label: 'Full chain', consumerCode: 'full-chain', skills: [] } },
    { id: 'gea-html-inventory-disabled', label: 'Disabled', root, prompt: 'other.json', enabled: false, profile: { label: 'Disabled', consumerCode: 'disabled', skills: [] } }
  ])
  expect((await resources.list()).find(row => row.id === 'gea-html-inventory-fc')?.interpreters).toBeUndefined()
  const selected = await resources.select('gea-html-inventory-fc', new AbortController().signal)
  expect(selected.interpreters).toEqual(['gea-html-inventory-fc', 'gea-html-inventory-qll'])
  expect((await resources.list()).find(row => row.id === 'gea-html-inventory-fc')?.interpreters).toEqual(['gea-html-inventory-fc', 'gea-html-inventory-qll'])
  await removeOther()
  expect((await resources.select('gea-html-inventory-fc', new AbortController().signal)).interpreters).toEqual(['gea-html-inventory-fc'])
  expect((await resources.list()).find(row => row.id === 'gea-html-inventory-fc')?.interpreters).toEqual(['gea-html-inventory-fc'])
  await resources.dispose()
})

it('selects the restored regional resource through the original Skill provider and withdraws only its mounted contribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'regional-resource-'))
  roots.push(root)
  let provider: SkillProvider
  const registered: Definition[] = []
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
      async resolve(id: string) {
        return { id }
      },
      async register(definition: Definition) {
        registered.push(definition)
        return async () => {
          registered.splice(registered.indexOf(definition), 1)
        }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  const originalRoot = fileURLToPath(new URL('../business-resources/plan-regional/', import.meta.url))
  const owner = await resources.register([
    {
      id: 'gea-html-plan-regional',
      label: '区域计划',
      root: originalRoot,
      prompt: 'prompt.json',
      profile: { label: '区域计划', consumerCode: 'regional-plan-prototype', skills: ['plan-regional'] },
      skillFiles: { 'plan-regional': 'skills/regional/SKILL.md' }
    }
  ])
  const otherOwner = await resources.register([
    {
      id: 'gea-html-inventory-orderfulfillment',
      label: '履约原型',
      root: fileURLToPath(new URL('../business-resources/inventory-orderfulfillment/', import.meta.url)),
      prompt: 'prompt.json',
      profile: { label: '履约原型', consumerCode: 'orderfulfillment-preview', skills: ['inventory-orderfulfillment'] },
      skillFiles: { 'inventory-orderfulfillment': 'skills/orderfulfillment/SKILL.md' }
    }
  ])
  expect((await resources.list()).find(row => row.id === 'gea-html-plan-regional')).toMatchObject({ enabled: true, skills: ['plan-regional'] })
  const skill = (await provider.list({})).find(row => row.name === 'plan-regional')
  expect(skill?.path).toContain('/business-resources/plan-regional/skills/regional/SKILL.md')
  expect((await resources.select('gea-html-plan-regional', new AbortController().signal)).preset).toBe('gea-html-plan-regional')
  expect((registered[0].plugins[0].config as { prefix: string }).prefix).toContain('你负责当前区域计划原型的模拟数据解释')
  await owner()
  expect((await resources.list()).map(row => row.id)).toEqual(['gea-html-inventory-orderfulfillment', 'skill:inventory-orderfulfillment'])
  expect((await provider.list({})).map(row => row.name)).toEqual(['inventory-orderfulfillment'])
  expect(registered).toEqual([])
  await otherOwner()
  expect(await resources.list()).toEqual([])
  expect(await readFile(join(originalRoot, 'skills/regional/SKILL.md'), 'utf8')).toContain('name: plan-regional')
  await resources.dispose()
})

it('selects the retained category prototype resource and keeps its Skill contribution scoped to that owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'category-resource-'))
  roots.push(root)
  const installedRoot = join(process.cwd(), 'business-resources/category-plan')
  const registered: Definition[] = []
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
      async resolve(id: string) {
        return { id }
      },
      async register(value: Definition) {
        registered.push(value)
        return async () => {
          registered.splice(registered.indexOf(value), 1)
        }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  const release = await resources.register([
    {
      id: 'gea-html-category-plan',
      label: '品类计划原型',
      root: installedRoot,
      prompt: 'prompt.json',
      profile: { label: '品类计划原型', consumerCode: 'category-plan-prototype', skills: ['category-plan'] },
      skillFiles: { 'category-plan': 'skills/category-plan/SKILL.md' }
    }
  ])
  expect((await resources.list()).find(row => row.id === 'gea-html-category-plan')).toMatchObject({ enabled: true, skills: ['category-plan'] })
  expect(await resources.select('gea-html-category-plan', new AbortController().signal)).toMatchObject({
    preset: 'gea-html-category-plan',
    profile: { consumerCode: 'category-plan-prototype' }
  })
  expect((registered[0].plugins[0].config as { prefix: string }).prefix).toContain(
    '本页面为模拟原型。只解释自述模拟快照，不能把演示数量、建议采纳、任务状态或本地问答当作真实业务、模型调用或系统回执。'
  )
  const candidates = await provider.list({})
  expect(candidates[0]).toMatchObject({ name: 'category-plan', path: join(installedRoot, 'skills/category-plan/SKILL.md') })
  expect((await provider.get(candidates[0], {}))?.content).toContain('未发文字按真实 Session 恢复')
  await release()
  expect(await resources.list()).toEqual([])
  expect(await provider.get(candidates[0], {})).toBeUndefined()
  await resources.dispose()
})

async function releaseFixture() {
  const root = await mkdtemp(join(tmpdir(), 'resource-release-'))
  roots.push(root)
  const mounted = new Map<string, Definition>()
  const attempts: string[] = []
  const failed = new Set<string>()
  let broken: string | undefined
  let onRegister: (() => void) | undefined
  let releaseGate: Promise<void> | undefined
  const host = {
    skills: {
      registerProvider() {
        return () => {}
      },
      async list() {
        return []
      },
      async get() {
        return { invocation: { userInvocable: true } }
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register(definition: Definition) {
        if (mounted.has(definition.id)) throw Error('HOST_PRESET_ALREADY_MOUNTED')
        mounted.set(definition.id, definition)
        onRegister?.()
        return async () => {
          attempts.push(definition.id)
          if (failed.delete(definition.id)) throw Error('HOST_RELEASE_FAILED')
          await releaseGate
          mounted.delete(definition.id)
        }
      },
      async resolve(id: string) {
        return { id, broken }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(root, 'selected.json'))
  const definition = (id: string) => ({ id, label: id, root, prompt: id + '.json', profile: { label: id, consumerCode: 'known', skills: [] } })
  const prompt = async (id: string, persona: string) => writeFile(join(root, id + '.json'), JSON.stringify({ consumerCode: 'known', skills: [], persona }))
  return {
    resources,
    mounted,
    attempts,
    failed,
    definition,
    prompt,
    breakResolution: () => {
      broken = 'HOST_RESOLUTION_FAILED'
    },
    onRegistration: (callback: () => void) => {
      onRegister = callback
    },
    blockRelease: (gate: Promise<void>) => {
      releaseGate = gate
    }
  }
}
it('retains a failed owner release for explicit retry and prevents a replacement owner', async () => {
  const f = await releaseFixture()
  await f.prompt('original', 'Original persona')
  const owner = await f.resources.register([f.definition('original')])
  await f.resources.select('original', new AbortController().signal)
  f.failed.add('original')
  await expect(owner()).rejects.toThrow('HOST_RELEASE_FAILED')
  expect(f.mounted.has('original')).toBe(true)
  expect(await f.resources.list()).toEqual([expect.objectContaining({ id: 'original', enabled: false, error: expect.stringContaining('HOST_RELEASE_FAILED') })])
  await expect(f.resources.register([f.definition('original')])).rejects.toThrow('DUPLICATE_AGENT_RESOURCE')
  await owner()
  expect(f.mounted.size).toBe(0)
  expect(await f.resources.list()).toEqual([])
  await owner()
  expect(f.attempts).toEqual(['original', 'original'])
  await f.resources.dispose()
})

it('reports a failed rollback once and retains its mounted preset for owner cleanup', async () => {
  const f = await releaseFixture()
  await f.prompt('original', 'Original persona')
  const owner = await f.resources.register([f.definition('original')])
  f.breakResolution()
  f.failed.add('original')
  await expect(f.resources.select('original', new AbortController().signal)).rejects.toThrow('HOST_RELEASE_FAILED')
  expect(f.mounted.has('original')).toBe(true)
  expect(f.attempts).toEqual(['original'])
  await owner()
  expect(f.mounted.size).toBe(0)
  await f.resources.dispose()
})

it('does not register a changed persona while the old preset release fails', async () => {
  const f = await releaseFixture()
  await f.prompt('original', 'Original persona')
  const owner = await f.resources.register([f.definition('original')])
  await f.resources.select('original', new AbortController().signal)
  const original = f.mounted.get('original')
  await f.prompt('original', 'Changed persona')
  f.failed.add('original')
  await expect(f.resources.select('original', new AbortController().signal)).rejects.toThrow('HOST_RELEASE_FAILED')
  expect(f.mounted.get('original')).toBe(original)
  await f.resources.select('original', new AbortController().signal)
  expect(f.mounted.get('original')).not.toBe(original)
  await owner()
  await f.resources.dispose()
})
it('revokes successfully disposed entries but retains a failed entry until explicit retry', async () => {
  const f = await releaseFixture()
  await f.prompt('first', 'First persona')
  await f.prompt('second', 'Second persona')
  await f.resources.register([f.definition('first'), f.definition('second')])
  await f.resources.select('first', new AbortController().signal)
  await f.resources.select('second', new AbortController().signal)
  f.failed.add('second')
  await expect(f.resources.dispose()).rejects.toThrow('HOST_RELEASE_FAILED')
  expect([...f.mounted.keys()]).toEqual(['second'])
  expect((await f.resources.list()).map(entry => entry.id)).toEqual(['second'])
  await f.resources.dispose()
  expect(f.mounted.size).toBe(0)
  expect(await f.resources.list()).toEqual([])
  expect(f.attempts).toEqual(['first', 'second', 'second'])
})

it('serializes concurrent explicit release attempts and retries only failed mounts of one owner', async () => {
  const f = await releaseFixture()
  await f.prompt('first', 'First persona')
  await f.prompt('second', 'Second persona')
  const owner = await f.resources.register([f.definition('first'), f.definition('second')])
  await f.resources.select('first', new AbortController().signal)
  await f.resources.select('second', new AbortController().signal)
  f.failed.add('second')
  const results = await Promise.allSettled([owner(), owner()])
  expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled'])
  expect(f.mounted.size).toBe(0)
  expect(await f.resources.list()).toEqual([])
  expect(f.attempts).toEqual(['first', 'second', 'second'])
  await f.resources.dispose()
})

it('a Skill mount rollback failure rejects selection without an implicit second release', async () => {
  const f = await releaseFixture()
  let continueRelease!: () => void
  f.blockRelease(
    new Promise(resolve => {
      continueRelease = resolve
    })
  )
  let disposal: Promise<void> | undefined
  f.onRegistration(() => {
    disposal = f.resources.dispose()
  })
  f.failed.add('agent-resource-skill')
  let result: unknown
  let settled = false
  const selection = f.resources.select('skill:original', new AbortController().signal).catch(error => {
    result = error
    settled = true
  })
  try {
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 500 })
    expect(result).toBeInstanceOf(Error)
    expect(String(result)).toContain('HOST_RELEASE_FAILED')
    expect(f.mounted.has('agent-resource-skill')).toBe(true)
  } finally {
    continueRelease()
    await selection
    await disposal
  }
  expect(f.mounted.size).toBe(0)
})
