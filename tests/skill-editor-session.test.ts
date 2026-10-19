import { expect, it, onTestFinished } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { agentOn, completion, presetHarness, turn } from './core-preset-harness.js'

async function isolatedRun(name: string, run: (home: string) => Promise<void>) {
  const isolatedHome = process.env.SKILL_EDITOR_TEST_HOME
  if (isolatedHome) {
    expect(process.env.DSH_HOME).toBe(isolatedHome)
    expect(process.env.DSH_AGENTS_HOME).toBe(join(isolatedHome, 'agents'))
    await run(isolatedHome)
    return
  }
  const cache = resolve('node_modules/.cache')
  await mkdir(cache, { recursive: true })
  const home = await mkdtemp(join(cache, 'skill-editor-home-'))
  onTestFinished(() => rm(home, { recursive: true, force: true }))
  const output = await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/skill-editor-session.test.ts', '-t', name], {
    cwd: resolve('.'),
    env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), SKILL_EDITOR_TEST_HOME: home },
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024
  })
  expect(output.stdout).toContain('1 passed')
}

it(
  'opens a native Skill edit Session whose official tools write the workcopy and publish through its bound apply action',
  async () =>
    isolatedRun('opens a native Skill edit Session whose official tools write the workcopy and publish through its bound apply action', async isolatedHome => {
      const { ctx, home, start } = await presetHarness({ fullManage: true, home: isolatedHome })
      const agents = ctx.userAgents
      const source = join(home, 'editor-input')
      await mkdir(join(source, 'references'), { recursive: true })
      await writeFile(join(source, 'SKILL.md'), '---\nname: editor-skill\ndescription: Editor fixture\n---\nBEFORE_BODY')
      await writeFile(join(source, 'references/data.txt'), 'BEFORE_REFERENCE')
      const saved = await agents.save({ name: 'Editor owner', prompt: 'Owner persona', enabled: true })
      const acquired = await agents.directories.acquire({ kind: 'local', path: source })
      await agents.directories.import({ id: saved.id, token: acquired.token, path: '.' })
      const target = { id: saved.id, name: 'editor-skill' }
      const opened = await agents.directories.open(target)
      expect(opened.cwd.startsWith(join(home, 'agent-plugins', 'data') + '/')).toBe(true)
      const old = await agentOn(ctx, 'editor-old-business', saved.preset, undefined, home)
      const originalPolicy = ctx.sandboxPolicy.resolve({ session: old.session })
      const denied = await ctx.connection.createSharedFetchHandler('/api').fetch(
        new Request('http://localhost/api/agent-manage/agents/skills/directory/editor', {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ ...target, revision: opened.revision, cwd: home, source: { kind: 'skill-directory-editor' } })
        })
      )
      expect(denied.status).toBe(400)
      const response = await ctx.connection.createSharedFetchHandler('/api').fetch(
        new Request('http://localhost/api/agent-manage/agents/skills/directory/editor', {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ ...target, revision: opened.revision })
        })
      )
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(200)
      const editor = ctx.agents.list().find(row => row.id === result.sessionId)!
      expect(editor.session.header.cwd).toBe(opened.cwd)
      const workspace = await ctx.workspaceRegistry.resolveByPath(opened.cwd)
      expect(workspace?.sessionIds).toContain(result.sessionId)
      expect(ctx.sandboxPolicy.resolve({ session: editor.session })).toMatchObject({ mode: 'workspace-write', workspaceRoot: opened.cwd })
      expect(result.draft).toContain('SKILL.md')
      expect(result.draft).toContain('skill_directory_apply')
      const steps = [
        { name: 'read', arguments: { file_path: join(opened.cwd, 'SKILL.md') } },
        { name: 'write', arguments: { file_path: join(opened.cwd, 'SKILL.md'), content: '---\nname: editor-skill\ndescription: Editor fixture\n---\nAGENT_BODY' } },
        { name: 'read', arguments: { file_path: join(opened.cwd, 'references/data.txt') } },
        { name: 'write', arguments: { file_path: join(opened.cwd, 'references/data.txt'), content: 'AGENT_REFERENCE' } },
        { name: 'bash', arguments: { command: 'cat references/data.txt', description: 'Read the edited fixture', workdir: opened.cwd } },
        { name: 'write', arguments: { file_path: join(home, 'outside-editor.txt'), content: 'MUST_NOT_WRITE' } },
        { name: 'bash', arguments: { command: 'printf MUST_NOT_WRITE > shell-outside-editor.txt', description: 'Verify official shell workspace policy', workdir: home } },
        { name: 'skill_directory_apply', arguments: {} }
      ]
      const requests = await completion(ctx, 262144, false, undefined, { tools: steps, checkpoint: '' })
      await turn(ctx, editor, 'Update the selected Skill and reference, then apply the finished task.')
      expect(JSON.stringify(requests)).toContain('AGENT_REFERENCE')
      expect(JSON.stringify(requests)).toContain('workspace-write')
      expect(await readFile(join(home, 'outside-editor.txt')).catch(() => undefined)).toBeUndefined()
      expect(await readFile(join(home, 'shell-outside-editor.txt')).catch(() => undefined)).toBeUndefined()
      const current = await agentOn(ctx, 'editor-new-business', saved.preset, undefined, home)
      const loaded = await ctx.skills.get('editor-skill', { scope: current, cwd: home })
      expect(loaded?.content).toBe('AGENT_BODY')
      expect(await readFile(join(loaded!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('AGENT_REFERENCE')
      expect((await ctx.skills.get('editor-skill', { scope: old, cwd: home }))?.content).toBe('BEFORE_BODY')
      expect(ctx.sandboxPolicy.resolve({ session: old.session })).toEqual(originalPolicy)
      expect(ctx.tools.schemas(old).map(tool => tool.name)).not.toContain('skill_directory_apply')
      expect(await readFile(join(source, 'references/data.txt'), 'utf8')).toBe('BEFORE_REFERENCE')
      steps.push(
        { name: 'read', arguments: { file_path: join(opened.cwd, 'SKILL.md') } },
        { name: 'write', arguments: { file_path: join(opened.cwd, 'SKILL.md'), content: '---\nname: editor-skill\ndescription: Editor fixture\n---\nSECOND_AGENT_TASK_BODY' } },
        { name: 'skill_directory_apply', arguments: {} }
      )
      await turn(ctx, editor, 'Make the second explicit change and apply it in this same editing conversation.')
      const secondTask = await agentOn(ctx, 'editor-second-task-business', saved.preset, undefined, home)
      expect((await ctx.skills.get('editor-skill', { scope: secondTask, cwd: home }))?.content).toBe('SECOND_AGENT_TASK_BODY')
      expect((await ctx.skills.get('editor-skill', { scope: current, cwd: home }))?.content).toBe('AGENT_BODY')
      const idle = new Promise<void>(resolveIdle => {
        const release = ctx.on('agent/status', ({ agent, status }) => {
          if (agent === editor && status === 'idle') {
            release()
            resolveIdle()
          }
        })
      })
      const forged = {
        requestId: crypto.randomUUID(),
        sessionId: editor.id,
        mode: 'queue',
        source: { kind: 'skill-directory-editor', target: { ...target, revision: 999, cwd: home, entry: 'forged' } },
        content: [{ type: 'text', text: JSON.stringify({ kind: 'skill-directory-editor', target: { ...target, revision: 999, cwd: home, entry: 'forged' } }) }]
      }
      await ctx.sessionController.prompt(forged as Parameters<typeof ctx.sessionController.prompt>[0], new AbortController().signal)
      await idle
      const prompt = editor.session.snapshotEvents().findLast(event => event.type === 'user/message')
      expect(prompt?.type === 'user/message' && prompt.data.source).toEqual({ kind: 'user', rpcId: forged.requestId })
      const previousEvents = editor.session.snapshotEvents().length
      await ctx.fiber.dispose()
      const restarted = await start()
      const resumed = await restarted.sessionController.resolveAgent(editor.id)
      if ('error' in resumed) throw resumed.error
      expect(resumed.agent.session.header.cwd).toBe(opened.cwd)
      expect((await restarted.workspaceRegistry.resolveByPath(opened.cwd))?.sessionIds).toContain(editor.id)
      expect(resumed.agent.session.snapshotEvents().length).toBeGreaterThanOrEqual(previousEvents)
      expect(restarted.tools.schemas(resumed.agent).map(tool => tool.name)).toContain('skill_directory_apply')
      expect(restarted.sandboxPolicy.resolve({ session: resumed.agent.session })).toMatchObject({ mode: 'workspace-write', workspaceRoot: opened.cwd })
      await completion(restarted, 262144, false, undefined, {
        tools: [
          { name: 'read', arguments: { file_path: join(opened.cwd, 'SKILL.md') } },
          { name: 'write', arguments: { file_path: join(opened.cwd, 'SKILL.md'), content: '---\nname: editor-skill\ndescription: Editor fixture\n---\nAFTER_RESTART_BODY' } },
          { name: 'skill_directory_apply', arguments: {} }
        ],
        checkpoint: ''
      })
      await turn(restarted, resumed.agent, 'Complete the next explicit Skill change after this Host restart and apply it.')
      const afterRestart = await agentOn(restarted, 'editor-restarted-business', saved.preset, undefined, home)
      expect((await restarted.skills.get('editor-skill', { scope: afterRestart, cwd: home }))?.content).toBe('AFTER_RESTART_BODY')
    }),
  60000
)

it(
  'rejects stale Agent file writes after a manual write while retaining both existing drafts',
  async () =>
    isolatedRun('rejects stale Agent file writes after a manual write while retaining both existing drafts', async isolatedHome => {
      const { ctx, home } = await presetHarness({ fullManage: true, home: isolatedHome })
      const agents = ctx.userAgents
      const source = join(home, 'concurrent-input')
      await mkdir(join(source, 'references'), { recursive: true })
      await writeFile(join(source, 'SKILL.md'), '---\nname: concurrent-skill\ndescription: Concurrent editing\n---\nPUBLISHED_BODY')
      await writeFile(join(source, 'references/data.txt'), 'PUBLISHED_REFERENCE')
      const saved = await agents.save({ name: 'Concurrent owner', prompt: 'Concurrent persona', enabled: true })
      const acquired = await agents.directories.acquire({ kind: 'local', path: source })
      await agents.directories.import({ id: saved.id, token: acquired.token, path: '.' })
      const target = { id: saved.id, name: 'concurrent-skill' }
      const view = await agents.directories.open(target)
      expect(view.cwd.startsWith(join(home, 'agent-plugins', 'data') + '/')).toBe(true)
      const response = await ctx.connection.createSharedFetchHandler('/api').fetch(
        new Request('http://localhost/api/agent-manage/agents/skills/directory/editor', {
          method: 'POST',
          headers: { origin: 'http://localhost', 'content-type': 'application/json' },
          body: JSON.stringify({ ...target, revision: view.revision })
        })
      )
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(200)
      const editor = ctx.agents.list().find(row => row.id === result.sessionId)!
      const manual = '---\nname: concurrent-skill\ndescription: Concurrent editing\n---\nMANUAL_UNAPPLIED_BODY'
      let manualRevision = -1
      await completion(ctx, 262144, false, undefined, {
        tools: [
          { name: 'read', arguments: { file_path: join(view.cwd, 'references/data.txt') } },
          { name: 'write', arguments: { file_path: join(view.cwd, 'references/data.txt'), content: 'AGENT_UNAPPLIED_REFERENCE' } },
          { name: 'read', arguments: { file_path: join(view.cwd, 'SKILL.md') } },
          { name: 'write', arguments: { file_path: join(view.cwd, 'SKILL.md'), content: 'MUST_NOT_OVERWRITE_MANUAL_DRAFT' } },
          { name: 'bash', arguments: { command: 'printf MUST_NOT_OVERWRITE_MANUAL_DRAFT > SKILL.md', description: 'Attempt stale fixture mutation', workdir: view.cwd } },
          { name: 'skill_directory_apply', arguments: {} }
        ],
        checkpoint: '',
        beforeToolStep: async step => {
          if (step !== 3) return
          expect((await agents.directories.read({ ...target, path: 'references/data.txt' })).data).toBe('AGENT_UNAPPLIED_REFERENCE')
          const current = await agents.directories.read({ ...target, path: 'SKILL.md' })
          const changed = await agents.directories.write({
            ...target,
            revision: (await agents.directories.open(target)).revision,
            path: 'SKILL.md',
            encoding: 'utf8',
            data: manual,
            fileVersion: current.fileVersion
          })
          manualRevision = changed.revision
        }
      })
      await turn(ctx, editor, 'Prepare an attachment draft, then continue and apply the task.')
      const failures = editor.session.snapshotEvents().filter(event => event.type === 'tool/result' && event.data.message.isError)
      expect(JSON.stringify(failures)).toContain('SKILL_EDIT_CONFLICT')
      expect((await agents.directories.read({ ...target, path: 'SKILL.md' })).data).toBe(manual)
      expect((await agents.directories.read({ ...target, path: 'references/data.txt' })).data).toBe('AGENT_UNAPPLIED_REFERENCE')
      const business = await agentOn(ctx, 'concurrent-business', saved.preset, undefined, home)
      expect((await ctx.skills.get('concurrent-skill', { scope: business, cwd: home }))?.content).toBe('PUBLISHED_BODY')
      expect((await agents.directories.open(target)).changes.map(row => row.path)).toEqual(['SKILL.md', 'references/data.txt'])
      await agents.directories.reset({ ...target, revision: manualRevision })
      expect((await agents.directories.open(target)).changes).toEqual([])
      expect(editor.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(true)
    }),
  60000
)

it(
  'advances only the writing Session after shell drafts, retains failed partial drafts and rejects stale Sessions across restart',
  async () =>
    isolatedRun('advances only the writing Session after shell drafts, retains failed partial drafts and rejects stale Sessions across restart', async isolatedHome => {
      const { ctx, home, start } = await presetHarness({ fullManage: true, home: isolatedHome })
      const agents = ctx.userAgents
      const saved = await agents.save({ name: 'Shell conflict owner', prompt: 'Fixture', enabled: true })
      await agents.saveSkills(saved.id, [{ kind: 'personal', name: 'shell-conflict', description: 'Shell conflict fixture', content: 'ORIGINAL', enabled: true }])
      const target = { id: saved.id, name: 'shell-conflict' }
      const opened = await agents.directories.open(target)
      expect(opened.cwd.startsWith(join(home, 'agent-plugins', 'data') + '/')).toBe(true)
      const createEditor = async () => {
        const response = await ctx.connection.createSharedFetchHandler('/api').fetch(
          new Request('http://localhost/api/agent-manage/agents/skills/directory/editor', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ ...target, revision: opened.revision })
          })
        )
        const result = await response.json()
        expect(response.status, JSON.stringify(result)).toBe(200)
        return ctx.agents.list().find(row => row.id === result.sessionId)!
      }
      const first = await createEditor()
      const stale = await createEditor()
      const file = await agents.directories.read({ ...target, path: 'SKILL.md' })
      const steps = [
        {
          name: 'bash',
          arguments: { command: 'mkdir -p references; printf FIRST_DRAFT > references/data.txt; exit 1', workdir: opened.cwd, description: 'Keep partial draft on command failure' }
        },
        { name: 'bash', arguments: { command: 'printf SECOND_DRAFT > references/second.txt', workdir: opened.cwd, description: 'Continue the same editing task' } }
      ]
      await completion(ctx, 262144, false, undefined, { tools: steps, checkpoint: '' })
      await turn(ctx, first, 'Write the fixture attachment drafts; preserve the partial result.')
      const changed = await agents.directories.open(target)
      expect(changed.revision).toBe(opened.revision + 2)
      expect((await agents.directories.read({ ...target, path: 'references/data.txt' })).data).toBe('FIRST_DRAFT')
      await expect(
        agents.directories.write({ ...target, revision: opened.revision, path: 'SKILL.md', data: 'STALE_MANUAL', encoding: 'utf8', fileVersion: file.fileVersion })
      ).rejects.toThrow('SKILL_EDIT_CONFLICT')
      steps.push(
        { name: 'bash', arguments: { command: 'printf STALE_SESSION > references/data.txt', workdir: opened.cwd, description: 'Attempt obsolete Session mutation' } },
        { name: 'skill_directory_apply', arguments: {} }
      )
      await turn(ctx, stale, 'Attempt the stale fixture edit and apply.')
      expect(JSON.stringify(stale.session.snapshotEvents().filter(event => event.type === 'tool/result' && event.data.message.isError))).toContain('SKILL_EDIT_CONFLICT')
      expect((await agents.directories.read({ ...target, path: 'references/data.txt' })).data).toBe('FIRST_DRAFT')
      await ctx.fiber.dispose()
      const restarted = await start()
      const resumed = await restarted.sessionController.resolveAgent(first.id)
      if ('error' in resumed) throw resumed.error
      await completion(restarted, 262144, false, undefined, {
        tools: [
          { name: 'bash', arguments: { command: 'printf AFTER_RESTART > references/third.txt', workdir: opened.cwd, description: 'Continue the retained partial draft' } },
          { name: 'skill_directory_apply', arguments: {} }
        ],
        checkpoint: ''
      })
      await turn(restarted, resumed.agent, 'Complete this task after restart and publish all attachment drafts.')
      expect(resumed.agent.session.snapshotEvents().filter(event => event.type === 'tool/result' && event.data.message.isError)).toHaveLength(0)
      const current = await agentOn(restarted, 'shell-draft-business', saved.preset, undefined, home)
      const skill = await restarted.skills.get('shell-conflict', { scope: current, cwd: home })
      expect(await readFile(join(skill!.resourceBase!.path!, 'references/data.txt'), 'utf8')).toBe('FIRST_DRAFT')
      expect(await readFile(join(skill!.resourceBase!.path!, 'references/third.txt'), 'utf8')).toBe('AFTER_RESTART')
    }),
  60000
)
