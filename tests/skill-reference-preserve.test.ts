import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { UserAgentSkill } from '../src/contracts/user-agents.js'
import { SkillDirectories } from '../src/runtime/skill-directories.js'

it('a reference metadata update without content preserves its complete directory body and reference files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skill-content-preserve-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const bundle = join(root, 'snapshot'),
    directory = join(bundle, 'tree/skills/retained-skill')
  await mkdir(join(directory, 'references'), { recursive: true })
  const body = '# 用户保留的说明\n\n参见 [业务规则](references/rules.md)。'
  const raw = '---\nname: retained-skill\ndescription: Retained custom instructions\n---\n' + body
  await writeFile(join(directory, 'SKILL.md'), raw)
  await writeFile(join(directory, 'references/rules.md'), 'CUSTOM_REFERENCE')
  const previous: UserAgentSkill = {
    kind: 'reference',
    name: 'retained-skill',
    provider: 'business-resource',
    path: 'old-installed-source',
    content: body,
    enabled: true,
    directory: { id: 'snapshot-id', bundle, root: join(bundle, 'tree/skills'), entry: 'skills/retained-skill' }
  }
  const { content, ...metadata } = previous
  const manager = new SkillDirectories(
    {} as Pick<Context, 'skills'>,
    join(root, 'store'),
    async () => {
      throw Error('No Agent mutation expected')
    },
    async () => {
      throw Error('No publication expected')
    }
  )
  const [updated] = await manager.migrate([{ ...metadata, path: 'new-installed-source' }], [previous])
  expect(updated.content).toBe(body)
  expect(updated.directory).toEqual(previous.directory)
  expect(updated.path).toBe('new-installed-source')
  expect(await readFile(join(directory, 'SKILL.md'), 'utf8')).toBe(raw)
  expect(await readFile(join(directory, 'references/rules.md'), 'utf8')).toBe('CUSTOM_REFERENCE')
})
