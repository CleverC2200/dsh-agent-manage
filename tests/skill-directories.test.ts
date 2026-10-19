import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { UserAgents } from '../src/runtime/user-agents.js'
import { agentOn, completion, presetHarness, turn } from './core-preset-harness.js'

const isolatedHome = process.env.T01_SKILL_DIRECTORY_HOME
if (!isolatedHome) {
  it('runs all Skill directory scenarios with isolated homes', async () => {
    const home = await mkdtemp(resolve('.t01-skill-directories-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const report = join(home, 'results.json')
    const output = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/skill-directories.test.ts', '--reporter=json', `--outputFile=${report}`],
      {
        cwd: resolve('.'),
        env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), T01_SKILL_DIRECTORY_HOME: home },
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024
      }
    )
    const result = await readFile(report, 'utf8')
    if (process.env.PRESET_EVIDENCE_DIR) {
      await mkdir(process.env.PRESET_EVIDENCE_DIR, { recursive: true })
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 't01-directories-isolated.json'), result)
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 't01-directories-isolated.log'), output.stdout + output.stderr)
    }
    expect(JSON.parse(result)).toMatchObject({ numPassedTests: 10, numFailedTests: 0, numPendingTests: 0 })
  }, 70_000)
} else {
  expect(process.env.DSH_HOME).toBe(isolatedHome)
  expect(process.env.DSH_AGENTS_HOME).toBe(join(isolatedHome, 'agents'))
  async function writeDraft(
    agents: UserAgents,
    input: { id: string; name: string; revision: number; path: string; data: string; encoding: 'utf8' | 'base64'; fileVersion?: string | null }
  ) {
    const fileVersion =
      input.fileVersion !== undefined
        ? input.fileVersion
        : await agents.directories
            .read({ id: input.id, name: input.name, path: input.path })
            .then(file => file.fileVersion)
            .catch(() => null)
    return agents.directories.write({ ...input, fileVersion })
  }

  it('imports a pure directory Skill and keeps full resources isolated in published Core Sessions', async () => {
    const { ctx, home } = await presetHarness()
    const root = join(home, 'input')
    await mkdir(join(root, 'references'), { recursive: true })
    await writeFile(join(root, 'SKILL.md'), '---\nname: directory-skill\ndescription: Full directory\nuser-invocable: true\n---\nRead references/data.txt')
    await writeFile(join(root, 'references/data.txt'), 'ORIGINAL_REFERENCE')
    await mkdir(join(root, 'scripts'))
    await writeFile(join(root, 'scripts/check.sh'), '#!/bin/sh\nprintf CORE_SCRIPT_EXECUTED')
    await chmod(join(root, 'scripts/check.sh'), 0o755)
    const agents = new UserAgents(ctx, join(home, 'agents.json'))
    await agents.load()
    const a = await agents.save({ name: 'A', prompt: 'A persona', enabled: true })
    const b = await agents.save({ name: 'B', prompt: 'B persona', enabled: true })
    const acquired = await agents.directories.acquire({ kind: 'local', path: root })
    expect(acquired.candidates).toEqual([expect.objectContaining({ name: 'directory-skill', path: '.' })])
    await agents.directories.import({ id: a.id, token: acquired.token, path: '.' })
    const first = await agentOn(ctx, 'directory-first', a.preset, undefined, home)
    const other = await agentOn(ctx, 'directory-other', b.preset, undefined, home)
    const loaded = await ctx.skills.get('directory-skill', { scope: first, cwd: home })
    expect(loaded?.content).toBe('Read references/data.txt')
    expect(await readFile(join(loaded!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('ORIGINAL_REFERENCE')
    const requests = await completion(ctx, 262144, false, undefined, {
      tools: [
        { name: 'skill', arguments: { name: 'directory-skill' } },
        { name: 'read', arguments: { file_path: join(loaded!.resourceBase!.path!, 'references/data.txt') } },
        { name: 'bash', arguments: { command: './scripts/check.sh', description: 'Run controlled imported script', workdir: loaded!.resourceBase!.path! } }
      ],
      checkpoint: ''
    })
    await turn(ctx, first, 'Load the selected Skill, read its reference and run its script')
    expect(JSON.stringify(requests).includes('ORIGINAL_REFERENCE')).toBe(true)
    expect(JSON.stringify(requests).includes('CORE_SCRIPT_EXECUTED')).toBe(true)
    expect(await ctx.skills.get('directory-skill', { scope: other, cwd: home })).toBeUndefined()
    expect(await readFile(join(root, 'references/data.txt'), 'utf8')).toBe('ORIGINAL_REFERENCE')
    await agents.dispose()
  })

  it('publishes edits atomically, retains old resources, detects stale writes and restores complete versions', async () => {
    const { ctx, home, start } = await presetHarness()
    const root = join(home, 'edit-input')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'SKILL.md'), '---\nname: editable\ndescription: Editable directory\n---\nFIRST_BODY')
    await writeFile(join(root, 'assets/blob.bin'), Buffer.from([0, 255, 13, 10]))
    const file = join(home, 'edit-agents.json')
    const agents = new UserAgents(ctx, file)
    await agents.load()
    const a = await agents.save({ name: 'A', prompt: 'A persona', enabled: true })
    const acquired = await agents.directories.acquire({ kind: 'local', path: root })
    await agents.directories.import({ id: a.id, token: acquired.token, path: '.' })
    const old = await agentOn(ctx, 'editable-old', a.preset, undefined, home)
    const target = { id: a.id, name: 'editable' }
    const opened = await agents.directories.open(target)
    expect(opened.changes).toEqual([])
    const changed = await writeDraft(agents, {
      ...target,
      revision: opened.revision,
      path: 'SKILL.md',
      data: '---\nname: editable\ndescription: Editable directory\n---\nSECOND_BODY',
      encoding: 'utf8'
    })
    await expect(writeDraft(agents, { ...target, revision: opened.revision, path: 'SKILL.md', data: 'STALE', encoding: 'utf8' })).rejects.toThrow('SKILL_EDIT_CONFLICT')
    expect(changed.changes).toEqual([{ path: 'SKILL.md', kind: 'modified' }])
    expect((await ctx.skills.get('editable', { scope: old, cwd: home }))?.content).toBe('FIRST_BODY')
    await agents.directories.apply({ ...target, revision: changed.revision })
    const next = await agentOn(ctx, 'editable-next', a.preset, undefined, home)
    const updated = await ctx.skills.get('editable', { scope: next, cwd: home })
    expect(updated?.content).toBe('SECOND_BODY')
    expect(await readFile(join(updated!.resourceBase!.path!, 'assets/blob.bin'))).toEqual(Buffer.from([0, 255, 13, 10]))
    expect((await ctx.skills.get('editable', { scope: old, cwd: home }))?.content).toBe('FIRST_BODY')
    let current = await agents.directories.open(target)
    current = await writeDraft(agents, { ...target, revision: current.revision, path: 'SKILL.md', data: 'invalid YAML', encoding: 'utf8' })
    await expect(agents.directories.apply({ ...target, revision: current.revision })).rejects.toThrow('SKILL_DIRECTORY_INVALID')
    expect((await agents.directories.open(target)).changes).not.toEqual([])
    current = await agents.directories.reset({ ...target, revision: current.revision })
    expect(current.changes).toEqual([])
    current = await agents.directories.restore({ ...target, revision: current.revision })
    const restored = await agentOn(ctx, 'editable-restored', a.preset, undefined, home)
    expect((await ctx.skills.get('editable', { scope: restored, cwd: home }))?.content).toBe('FIRST_BODY')
    await agents.dispose()
    await ctx.fiber.dispose()
    const restarted = await start()
    const reloaded = new UserAgents(restarted, file)
    await reloaded.load()
    const final = await agentOn(restarted, 'editable-restart', a.preset, undefined, home)
    expect((await restarted.skills.get('editable', { scope: final, cwd: home }))?.content).toBe('FIRST_BODY')
    await reloaded.dispose()
  })

  it('migrates old personal bodies and writes the simple editor to the same published directory', async () => {
    const { ctx, home } = await presetHarness()
    const file = join(home, 'legacy.json')
    const id = '02dc9788-aace-4759-a3bd-d4242d4a557f'
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        agents: [
          {
            id,
            name: 'Legacy',
            description: '',
            prompt: 'Legacy persona',
            enabled: true,
            revision: 1,
            skills: [{ kind: 'personal', name: 'legacy-skill', description: 'Legacy description', enabled: true, content: 'ORIGINAL_BODY' }]
          }
        ]
      })
    )
    const agents = new UserAgents(ctx, file)
    await agents.load()
    const initial = (await agents.list())[0]
    expect(initial.skills[0].directory).toBeDefined()
    const work = await agents.directories.open({ id, name: 'legacy-skill' })
    await expect(
      agents.saveSkills(id, [{ kind: 'personal', name: 'legacy-skill', description: 'Updated description', enabled: true, content: 'SIMPLE_EDITOR_UPDATE' }])
    ).rejects.toThrow('SKILL_EDIT_BASELINE_REQUIRED')
    await agents.saveSkills(id, [{ ...initial.skills[0], description: 'Updated description', content: 'SIMPLE_EDITOR_UPDATE' }])
    const session = await agentOn(ctx, 'legacy-migrated', initial.preset, undefined, home)
    const loaded = await ctx.skills.get('legacy-skill', { scope: session, cwd: home })
    expect(loaded?.resourceBase?.kind).toBe('directory')
    expect(loaded?.content).toBe('SIMPLE_EDITOR_UPDATE')
    expect(loaded?.description).toBe('Updated description')
    expect(await readFile(join(work.cwd, 'SKILL.md'), 'utf8')).toContain('SIMPLE_EDITOR_UPDATE')
    await agents.dispose()
  })

  it('imports a local ZIP through authenticated HTTP and edits binary files without text conversion', async () => {
    const { zipSync, strToU8 } = await import('fflate')
    const { mountUserAgentRoutes } = await import('../src/runtime/user-agent-routes.js')
    const { ctx, home } = await presetHarness()
    const agents = new UserAgents(ctx, join(home, 'http-agents.json'))
    await agents.load()
    mountUserAgentRoutes(ctx, agents)
    const a = await agents.save({ name: 'HTTP', prompt: 'HTTP persona', enabled: true })
    const handler = ctx.connection.createSharedFetchHandler('/api')
    const post = async (action: string, input: unknown) => {
      const response = await handler.fetch(
        new Request(`http://localhost/api/agent-manage/agents/skills/directory/${action}`, {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify(input)
        })
      )
      expect(response.status).toBe(200)
      return response.json()
    }
    const bytes = zipSync({
      'bundle/one/SKILL.md': strToU8('---\nname: zip-skill\ndescription: ZIP files\n---\nZIP_BODY'),
      'bundle/one/assets/large.bin': new Uint8Array(80000).fill(255),
      'bundle/one/scripts/run.sh': [strToU8('#!/bin/sh\nprintf ZIP_SCRIPT'), { os: 3, attrs: 0o100755 << 16 }],
      'bundle/two/SKILL.md': strToU8('---\nname: second-skill\ndescription: Another Skill\n---\nSECOND')
    })
    const acquired = await post('acquire', { kind: 'zip', data: Buffer.from(bytes).toString('base64') })
    expect(acquired.candidates).toHaveLength(2)
    await post('import', { id: a.id, token: acquired.token, path: 'bundle/one' })
    const target = { id: a.id, name: 'zip-skill' }
    const opened = await post('open', target)
    expect(opened.files).toContainEqual(expect.objectContaining({ path: 'bundle/one/assets/large.bin', size: 80000, binary: true }))
    expect(opened.files).toContainEqual(expect.objectContaining({ path: 'bundle/one/scripts/run.sh', executable: true }))
    const read = await post('read', { ...target, path: 'bundle/one/assets/large.bin' })
    expect(Buffer.from(read.data, read.encoding)).toEqual(Buffer.alloc(80000, 255))
    const written = await post('write', {
      ...target,
      revision: opened.revision,
      path: 'bundle/one/assets/large.bin',
      encoding: 'base64',
      data: Buffer.alloc(80000, 254).toString('base64'),
      fileVersion: read.fileVersion
    })
    await post('apply', { ...target, revision: written.revision })
    const session = await agentOn(ctx, 'zip-session', a.preset, undefined, home)
    const loaded = await ctx.skills.get('zip-skill', { scope: session, cwd: home })
    expect(await readFile(join(loaded!.resourceBase!.path!, 'assets/large.bin'))).toEqual(Buffer.alloc(80000, 254))
    await agents.dispose()
  })

  it('rejects escaped references and paths, requires replacement, and drops cancelled imports', async () => {
    const { ctx, home } = await presetHarness()
    const agents = new UserAgents(ctx, join(home, 'safe-agents.json'))
    await agents.load()
    const agent = await agents.save({ name: 'Safe', prompt: 'Safe persona', enabled: true })
    const source = join(home, 'safe-source')
    await mkdir(source)
    await writeFile(join(source, 'SKILL.md'), '---\nname: safe-skill\ndescription: Safe\n---\nRead [outside](../private.txt)')
    await writeFile(join(home, 'private.txt'), 'PRIVATE')
    await expect(agents.directories.acquire({ kind: 'local', path: source })).rejects.toThrow('SKILL_DEPENDENCY_OUTSIDE_ROOT')
    await writeFile(join(source, 'SKILL.md'), '---\nname: safe-skill\ndescription: Safe\n---\nSAFE_BODY')
    const acquired = await agents.directories.acquire({ kind: 'local', path: source })
    await agents.directories.import({ id: agent.id, token: acquired.token, path: '.' })
    await expect(agents.directories.import({ id: agent.id, token: acquired.token, path: '.' })).rejects.toThrow('SKILL_NAME_EXISTS')
    const opened = await agents.directories.open({ id: agent.id, name: 'safe-skill' })
    await expect(writeDraft(agents, { id: agent.id, name: 'safe-skill', revision: opened.revision, path: '../escape', data: 'x', encoding: 'utf8' })).rejects.toThrow(
      'SKILL_PATH_ESCAPE'
    )
    await agents.directories.cancel({ token: acquired.token })
    await expect(agents.directories.import({ id: agent.id, token: acquired.token, path: '.', replace: true })).rejects.toThrow('SKILL_IMPORT_SELECTION_STALE')
    await agents.dispose()
  })

  it('acquires a selected Skill from Git without requiring an Agent manifest', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const run = promisify(execFile)
    const { ctx, home } = await presetHarness()
    const root = join(home, 'git-input')
    await mkdir(join(root, 'skills/selected'), { recursive: true })
    await writeFile(join(root, 'skills/selected/SKILL.md'), '---\nname: git-selected\ndescription: Git import\n---\nGIT_BODY')
    await run('git', ['init', root])
    await run('git', ['-C', root, 'add', '.'])
    await run('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'Skill fixture'])
    const agents = new UserAgents(ctx, join(home, 'git-agents.json'))
    await agents.load()
    const agent = await agents.save({ name: 'Git', prompt: 'Git persona', enabled: true })
    const acquired = await agents.directories.acquire({ kind: 'git', url: new URL(`file://${root}`).href })
    expect(acquired.candidates).toEqual([{ name: 'git-selected', description: 'Git import', path: 'skills/selected' }])
    await agents.directories.import({ id: agent.id, token: acquired.token, path: 'skills/selected' })
    const session = await agentOn(ctx, 'git-import-session', agent.preset, undefined, home)
    expect((await ctx.skills.get('git-selected', { scope: session, cwd: home }))?.content).toBe('GIT_BODY')
    await agents.dispose()
  })

  it('keeps the last association and directory when Core rejects a candidate publication', async () => {
    const { vi } = await import('vitest')
    const { ctx, home } = await presetHarness()
    const agents = new UserAgents(ctx, join(home, 'publication-agents.json'))
    await agents.load()
    const a = await agents.save({ name: 'Atomic', prompt: 'Atomic persona', enabled: true })
    const source = join(home, 'atomic-source')
    await mkdir(source)
    await writeFile(join(source, 'SKILL.md'), '---\nname: atomic-skill\ndescription: Atomic\n---\nATOMIC_BODY')
    const acquired = await agents.directories.acquire({ kind: 'local', path: source })
    const failure = vi.spyOn(ctx.agentPresets, 'register').mockRejectedValueOnce(Error('CANDIDATE_REJECTED'))
    await expect(agents.directories.import({ id: a.id, token: acquired.token, path: '.' })).rejects.toThrow('CANDIDATE_REJECTED')
    failure.mockRestore()
    expect((await agents.list())[0].skills).toEqual([])
    const session = await agentOn(ctx, 'atomic-unchanged', a.preset, undefined, home)
    expect(await ctx.skills.get('atomic-skill', { scope: session, cwd: home })).toBeUndefined()
    await agents.dispose()
  })

  it('preserves Agent file writes when a manual editor saves an older observed file', async () => {
    const { ctx, home } = await presetHarness()
    const agents = new UserAgents(ctx, join(home, 'race-agents.json'))
    await agents.load()
    const agent = await agents.save({ name: 'Race', prompt: 'Race persona', enabled: true })
    await agents.saveSkills(agent.id, [{ kind: 'personal', name: 'race', description: 'Race', content: 'START', enabled: true }])
    const target = { id: agent.id, name: 'race' }
    const opened = await agents.directories.open(target)
    const before = await agents.directories.read({ ...target, path: 'SKILL.md' })
    await writeFile(join(opened.cwd, 'SKILL.md'), '---\nname: race\ndescription: Race\n---\nAGENT_WRITTEN')
    await expect(
      writeDraft(agents, { ...target, revision: opened.revision, path: 'SKILL.md', data: 'MANUAL_STALE', encoding: 'utf8', fileVersion: before.fileVersion })
    ).rejects.toThrow('SKILL_EDIT_CONFLICT')
    expect((await agents.directories.read({ ...target, path: 'SKILL.md' })).data).toContain('AGENT_WRITTEN')
    await agents.directories.apply({ ...target, revision: opened.revision })
    const session = await agentOn(ctx, 'race-published', agent.preset, undefined, home)
    expect((await ctx.skills.get('race', { scope: session, cwd: home }))?.content).toBe('AGENT_WRITTEN')
    await agents.dispose()
  })

  it('checks file observations before rename and delete and never replaces a rename target', async () => {
    const { ctx, home } = await presetHarness()
    const agents = new UserAgents(ctx, join(home, 'file-actions.json'))
    await agents.load()
    const agent = await agents.save({ name: 'File actions', prompt: 'File actions persona', enabled: true })
    await agents.saveSkills(agent.id, [{ kind: 'personal', name: 'file-actions', description: 'Files', content: 'BODY', enabled: true }])
    const target = { id: agent.id, name: 'file-actions' }
    const opened = await agents.directories.open(target)
    const observed = await agents.directories.read({ ...target, path: 'SKILL.md' })
    await writeFile(join(opened.cwd, 'SKILL.md'), 'AGENT_CHANGED')
    const stale = { ...target, revision: opened.revision, path: 'SKILL.md', fileVersion: observed.fileVersion }
    await expect(agents.directories.delete(stale)).rejects.toThrow('SKILL_EDIT_CONFLICT')
    await expect(agents.directories.rename({ ...stale, to: 'moved.md' })).rejects.toThrow('SKILL_EDIT_CONFLICT')
    const fresh = await agents.directories.read({ ...target, path: 'SKILL.md' })
    await writeFile(join(opened.cwd, 'existing.md'), 'PRESERVE_TARGET')
    await expect(agents.directories.rename({ ...stale, fileVersion: fresh.fileVersion, to: 'existing.md' })).rejects.toThrow('SKILL_FILE_EXISTS')
    const renamed = await agents.directories.rename({ ...stale, fileVersion: fresh.fileVersion, to: 'moved.md' })
    expect((await agents.directories.read({ ...target, path: 'moved.md' })).data).toBe('AGENT_CHANGED')
    await agents.directories.delete({ ...target, revision: renamed.revision, path: 'moved.md', fileVersion: fresh.fileVersion })
    expect((await agents.directories.open(target)).files.map(row => row.path)).toEqual(['existing.md'])
    await agents.dispose()
  })

  it('edits plugin Skill directories under the original preset identity and preserves plugin source files', async () => {
    const { BusinessResources } = await import('../src/runtime/business-resources.js')
    const { ctx, home } = await presetHarness({ companyBundle: 'absent', selectedDefault: 'minimal' })
    const root = join(home, 'plugin-files')
    await mkdir(join(root, 'references'), { recursive: true })
    await writeFile(join(root, 'prompt.json'), JSON.stringify({ persona: 'Plugin persona', consumerCode: 'plugin', skills: ['plugin-skill'] }))
    await writeFile(join(root, 'plugin-skill.md'), '---\nname: plugin-skill\ndescription: Plugin files\n---\nRead references/data.txt')
    await writeFile(join(root, 'references/data.txt'), 'PLUGIN_ORIGINAL')
    const resources = new BusinessResources(ctx, join(home, 'selected.json'))
    ctx.provide('agentResources', resources)
    await resources.register([
      {
        id: 'plugin-agent',
        label: 'Plugin',
        root,
        prompt: 'prompt.json',
        publishPreset: true,
        profile: { label: 'Plugin', consumerCode: 'plugin', skills: ['plugin-skill'] },
        skillFiles: { 'plugin-skill': 'plugin-skill.md' }
      }
    ])
    const agents = new UserAgents(ctx, join(home, 'plugin-agents.json'))
    await agents.load()
    const target = { id: 'plugin-agent', name: 'plugin-skill' }
    const opened = await agents.directories.open(target)
    const written = await writeDraft(agents, { ...target, revision: opened.revision, path: 'references/data.txt', data: 'PLUGIN_CUSTOM', encoding: 'utf8' })
    await agents.directories.apply({ ...target, revision: written.revision })
    const session = await agentOn(ctx, 'plugin-custom', 'plugin-agent', undefined, home)
    const loaded = await ctx.skills.get('plugin-skill', { scope: session, cwd: home })
    expect(await readFile(join(loaded!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('PLUGIN_CUSTOM')
    expect(await readFile(join(root, 'references/data.txt'), 'utf8')).toBe('PLUGIN_ORIGINAL')
    expect((await resources.pluginAgents())[0]).toMatchObject({ id: 'plugin-agent', customized: true, publication: 'ready' })
    await agents.dispose()
    await resources.dispose()
  })
}
