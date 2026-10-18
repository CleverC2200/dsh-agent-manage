import { expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountUserAgentRoutes } from '../src/runtime/user-agent-routes.js'
import { agentOn, presetHarness } from './core-preset-harness.js'

it('updates a Git Skill through public three-way source actions while preserving local files and old Sessions', async () => {
  const { ctx, home, start } = await presetHarness()
  const root = join(home, 'git-source')
  await mkdir(join(root, 'skills/selected/references'), { recursive: true })
  await writeFile(join(root, 'skills/selected/SKILL.md'), '---\nname: sourced-skill\ndescription: Git source\n---\nRead references/value.txt')
  await writeFile(join(root, 'skills/selected/references/value.txt'), 'BASE')
  const run = promisify(execFile)
  const commit = async () => {
    await run('git', ['-C', root, 'add', '.'])
    await run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'Skill source'])
  }
  await run('git', ['init', root])
  await commit()
  const file = join(home, 'git-source-agents.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  mountUserAgentRoutes(ctx, agents)
  const agent = await agents.save({ name: 'Source', prompt: 'Source persona', enabled: true })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const post = async (action: string, input: unknown, expected = 200) => {
    const response = await handler.fetch(
      new Request(`http://localhost/api/agent-manage/agents/skills/directory/${action}`, {
        method: 'POST',
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
    )
    expect(response.status).toBe(expected)
    return response.json()
  }
  const acquired = await post('acquire', { kind: 'git', url: `file://${root}` })
  await post('import', { id: agent.id, token: acquired.token, path: 'skills/selected' })
  const target = { id: agent.id, name: 'sourced-skill' }
  const opened = await post('open', target)
  expect(opened.source).toMatchObject({ kind: 'git', url: `file://${root}` })
  const path = 'skills/selected/references/value.txt'
  const read = await post('read', { ...target, path })
  const changed = await post('write', { ...target, path, revision: opened.revision, fileVersion: read.fileVersion, encoding: 'utf8', data: 'LOCAL' })
  await post('apply', { ...target, revision: changed.revision })
  const old = await agentOn(ctx, 'git-source-old', agent.preset, undefined, home)
  const oldDefinition = await ctx.skills.get(target.name, { scope: old, cwd: home })
  await writeFile(join(root, path), 'UPSTREAM')
  await writeFile(join(root, 'skills/selected/references/added.txt'), 'UPSTREAM_ADDED')
  await commit()
  const preview = await post('source-preview', target)
  expect(preview.changed).toBe(true)
  expect(preview.conflicts).toContainEqual(expect.objectContaining({ key: `file:${path}` }))
  expect((await post('source-commit', { token: preview.token, resolutions: {} }, 400)).error).toContain('SOURCE_CONFLICT_UNRESOLVED')
  const synced = await post('source-commit', { token: preview.token, resolutions: { [`file:${path}`]: { choice: 'local' } } })
  expect(synced.changes).toEqual([])
  expect(synced.source.commit).toBe(preview.commit)
  const fresh = await agentOn(ctx, 'git-source-new', agent.preset, undefined, home)
  const definition = await ctx.skills.get(target.name, { scope: fresh, cwd: home })
  expect(await readFile(join(definition!.resourceBase!.path!, 'references/value.txt'), 'utf8')).toBe('LOCAL')
  expect(await readFile(join(definition!.resourceBase!.path!, 'references/added.txt'), 'utf8')).toBe('UPSTREAM_ADDED')
  await expect(readFile(join(oldDefinition!.resourceBase!.path!, 'references/added.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(root, path), 'utf8')).toBe('UPSTREAM')
  const unchanged = await post('source-preview', target)
  expect(unchanged.changed).toBe(false)
  expect((await post('source-commit', { token: unchanged.token, resolutions: {} })).revision).toBe(synced.revision)
  const largeManual = await post('source-preview', target)
  await post('source-commit', {
    token: largeManual.token,
    resolutions: { [`file:${path}`]: { choice: 'manual', value: { data: 'M'.repeat(80000), encoding: 'utf8', executable: false } } }
  })
  expect((await post('read', { ...target, path })).data).toBe('M'.repeat(80000))
  await agents.dispose()
  await ctx.fiber.dispose()
  const restored = new UserAgents(await start(), file)
  await restored.load()
  expect((await restored.directories.open(target)).source).toMatchObject({ kind: 'git', commit: preview.commit })
  const nextPreview = await restored.directories.sourcePreview(target)
  await restored.directories.sourceCancel({ token: nextPreview.token })
  await expect(restored.directories.sourceCommit({ token: nextPreview.token, resolutions: {} })).rejects.toThrow('SKILL_SOURCE_PREVIEW_EXPIRED')
  await restored.dispose()
})

it('preserves unapplied work, rejects stale source plans and accepts a manual file resolution', async () => {
  const { ctx, home } = await presetHarness()
  const root = join(home, 'draft-source')
  await mkdir(root)
  await writeFile(join(root, 'SKILL.md'), '---\nname: draft-source\ndescription: Draft source\n---\nRead value.txt')
  await writeFile(join(root, 'value.txt'), 'BASE')
  const run = promisify(execFile)
  const commit = async () => {
    await run('git', ['-C', root, 'add', '.'])
    await run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'Source update'])
  }
  await run('git', ['init', root])
  await commit()
  const agents = new UserAgents(ctx, join(home, 'draft-source-agents.json'))
  await agents.load()
  const a = await agents.save({ name: 'Draft source', prompt: 'Draft source persona', enabled: true })
  const acquisition = await agents.directories.acquire({ kind: 'git', url: `file://${root}` })
  await agents.directories.import({ id: a.id, token: acquisition.token, path: '.' })
  const target = { id: a.id, name: 'draft-source' }
  let opened = await agents.directories.open(target)
  const original = await agents.directories.read({ ...target, path: 'value.txt' })
  opened = await agents.directories.write({ ...target, revision: opened.revision, path: 'value.txt', data: 'LOCAL', encoding: 'utf8', fileVersion: original.fileVersion })
  opened = await agents.directories.apply({ ...target, revision: opened.revision })
  await writeFile(join(root, 'value.txt'), 'UPSTREAM')
  await commit()
  const stale = await agents.directories.sourcePreview(target)
  await agents.directories.write({ ...target, revision: opened.revision, path: 'draft.txt', data: 'PRESERVE_DRAFT', encoding: 'utf8', fileVersion: null })
  await expect(agents.directories.sourceCommit({ token: stale.token, resolutions: { 'file:value.txt': { choice: 'local' } } })).rejects.toThrow('SKILL_SOURCE_PREVIEW_STALE')
  await agents.directories.sourceCancel({ token: stale.token })
  const preview = await agents.directories.sourcePreview(target)
  await expect(agents.directories.sourceCommit({ token: preview.token, resolutions: { 'file:value.txt': { choice: 'upstream' } } })).rejects.toThrow('SKILL_EDIT_CONFLICT')
  const local = await agents.directories.sourceCommit({ token: preview.token, resolutions: { 'file:value.txt': { choice: 'local' } } })
  expect(local.changes).toEqual([{ path: 'draft.txt', kind: 'added' }])
  expect((await agents.directories.read({ ...target, path: 'draft.txt' })).data).toBe('PRESERVE_DRAFT')
  await agents.directories.reset({ ...target, revision: local.revision })
  await writeFile(join(root, 'value.txt'), 'UPSTREAM_NEXT')
  await commit()
  const manual = await agents.directories.sourcePreview(target)
  await agents.directories.sourceCommit({
    token: manual.token,
    resolutions: { 'file:value.txt': { choice: 'manual', value: { data: 'MANUAL_MERGE', encoding: 'utf8', executable: false } } }
  })
  const session = await agentOn(ctx, 'manual-source', a.preset, undefined, home)
  const definition = await ctx.skills.get(target.name, { scope: session, cwd: home })
  expect(await readFile(join(definition!.resourceBase!.path!, 'value.txt'), 'utf8')).toBe('MANUAL_MERGE')
  const invalid = await agents.directories.sourcePreview(target)
  await expect(agents.directories.sourceCommit({ token: invalid.token, resolutions: { 'file:SKILL.md': { choice: 'manual', value: null } } })).rejects.toThrow(
    'SKILL_DIRECTORY_INVALID'
  )
  expect((await agents.list())[0].publication).toBe('ready')
  await agents.directories.sourceCancel({ token: invalid.token })
  await agents.dispose()
})
