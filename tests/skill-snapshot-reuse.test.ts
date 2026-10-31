import { expect, it, onTestFinished } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillDirectories } from '../src/runtime/skill-directories.js'
import type { UserAgentSkill } from '../src/contracts/user-agents.js'

it('reuses identical full resource trees across skills, restarts and concurrent creators', async () => {
  const home = await mkdtemp(join(tmpdir(), 'skill-reuse-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const source = join(home, 'source')
  for (const name of ['one', 'two']) {
    await mkdir(join(source, name), { recursive: true })
    await writeFile(join(source, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\nBODY`)
  }
  await writeFile(join(source, 'shared.txt'), 'RESOURCE')
  const ctx = {
    skills: {
      get: async (name: string) => ({
        name,
        provider: 'fixture',
        path: join(source, name, 'SKILL.md'),
        content: 'BODY',
        resourceBase: { kind: 'directory', path: join(source, name) }
      })
    }
  }
  const create = () =>
    new SkillDirectories(
      ctx as never,
      join(home, 'store'),
      async () => {
        throw Error('unused')
      },
      async () => {
        throw Error('unused')
      }
    )
  const skills: UserAgentSkill[] = ['one', 'two'].map(name => ({ kind: 'reference', name, provider: 'fixture', enabled: true }))
  const [a, b] = await Promise.all([create().migrate(skills, [], source), create().migrate(skills, [], source)])
  const old = a[0].directory!
  expect(new Set([...a, ...b].map(skill => skill.directory!.bundle)).size).toBe(1)
  expect(a[0].directory!.id).not.toBe(a[1].directory!.id)
  for (let reload = 0; reload < 5; reload++) expect((await create().migrate(skills, [], source))[0].directory!.bundle).toBe(old.bundle)
  await writeFile(join(source, 'shared.txt'), 'CHANGED')
  const changed = (await create().migrate(skills, [], source))[0].directory!
  expect(changed.bundle).not.toBe(old.bundle)
  expect(await readFile(join(old.bundle, 'tree/shared.txt'), 'utf8')).toBe('RESOURCE')
  await chmod(join(source, 'shared.txt'), 0o755)
  expect((await create().migrate(skills, [], source))[0].directory!.bundle).not.toBe(changed.bundle)
  expect((await readdir(join(home, 'store'))).filter(name => name.startsWith('.staging-'))).toEqual([])
  await writeFile(join(changed.bundle, 'tree/shared.txt'), 'CORRUPTED')
  await chmod(join(source, 'shared.txt'), 0o644)
  await expect(create().migrate(skills, [], source)).rejects.toThrow('SKILL_SNAPSHOT_CORRUPTED')
})
