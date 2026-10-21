import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import { expect, it, onTestFinished, vi } from 'vitest'
import { apply } from '../src/runtime/user-agent-skills.js'

it.each([false, true])('keeps selected business Skills and limits inherited Skills to generic sources (inherit=%s)', async inheritSkills => {
  const sources = [
    { name: 'general-skill', provider: 'filesystem' },
    { name: 'selected-business', provider: 'business-resource' },
    { name: 'other-business', provider: 'business-resource' },
    { name: 'disabled-choice', provider: 'filesystem' }
  ].map(source => ({ ...source, description: source.name, source: 'bundled' as const, rank: 600, invocation: { modelInvocable: true, userInvocable: true } }))
  let provider: SkillProvider
  const get = vi.fn(async (name: string) => ({ ...sources.find(source => source.name === name)!, content: name }))
  const ctx = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ signal: new AbortController().signal, invalidate() {} })
      },
      async list() {
        return sources
      },
      get
    }
  }
  apply(ctx as unknown as Context, {
    inheritSkills,
    skills: [
      { kind: 'reference', name: 'selected-business', provider: 'business-resource', enabled: true },
      { kind: 'reference', name: 'disabled-choice', provider: 'filesystem', enabled: false }
    ]
  })
  const listed = await provider!.list({ cwd: '/scope-fixture' })
  const entries = Array.isArray(listed) ? listed : listed.candidates
  expect(entries.filter(skill => skill.invocation.modelInvocable).map(skill => skill.name)).toEqual(inheritSkills ? ['general-skill', 'selected-business'] : ['selected-business'])
  for (const entry of entries) {
    const body = await provider!.get(entry, { cwd: '/scope-fixture' })
    expect(body?.content).toBe(entry.invocation.modelInvocable ? entry.name : '')
  }
  expect(get.mock.calls.map(([name]) => name)).toEqual(inheritSkills ? ['general-skill', 'selected-business'] : ['selected-business'])
})

it('keeps a disabled Skill masked when its snapshot bundle uses a directory alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-skill-alias-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const physical = join(root, 'physical')
  const file = join(physical, 'tree/skills/alias-skill/SKILL.md')
  await mkdir(join(physical, 'tree/skills/alias-skill'), { recursive: true })
  await writeFile(file, '---\nname: alias-skill\ndescription: Alias entry\n---\nOriginal body\n')
  const alias = join(root, 'alias')
  await symlink(physical, alias, 'junction')
  let provider: SkillProvider
  const ctx = {
    get: () => undefined,
    logger: { warn() {} },
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ signal: new AbortController().signal, invalidate() {} })
      },
      async list() {
        return [{ name: 'alias-skill', provider: 'source', path: await realpath(file) }]
      }
    }
  }
  apply(ctx as unknown as Context, {
    skills: [
      {
        kind: 'reference',
        name: 'alias-skill',
        provider: 'source',
        path: await realpath(file),
        enabled: false,
        directory: { id: 'alias', bundle: alias, root: join(alias, 'tree/skills'), entry: 'skills/alias-skill' }
      }
    ]
  })
  const listed = await provider!.list({ cwd: root })
  const entries = Array.isArray(listed) ? listed : listed.candidates
  expect(entries.find(skill => skill.name === 'alias-skill')).toMatchObject({ provider: 'user-agent-skills', invocation: { modelInvocable: false, userInvocable: false } })
})
