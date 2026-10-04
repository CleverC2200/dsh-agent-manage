import { afterEach, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
      async list(options: SkillLookupOptions) {
        return provider.list(options)
      }
    },
    agentPresets: {
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
  expect(await resources.list()).toEqual([{ id: 'original', label: 'Original', kind: 'prompt', installed: true, enabled: true, provider: 'package', skills: [] }])
  expect(registered).toEqual([])
  await writeFile(join(root, 'prompt.json'), JSON.stringify({ ...definition.profile, persona: 'Original exact words\nSecond line' }))
  const selected = await resources.select('original', new AbortController().signal)
  expect(selected.preset).toBe('original')
  expect((registered[0].plugins[0].config as { prefix: string }).prefix).toBe('Original exact words\nSecond line')
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
      async list(options: SkillLookupOptions) {
        return provider.list(options)
      },
      async get(name: string, options: SkillLookupOptions) {
        const candidate = (await provider.list(options)).find(item => item.name === name)
        return candidate && provider.get(candidate, options)
      }
    },
    agentPresets: {
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
