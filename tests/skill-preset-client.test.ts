/** Official InputHub uses a separate real Host process for resource/Session receipts. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TestSessions } from '../../../official-latest-standard/packages/test-support/client-runtime/src/sessions.ts'
import { InputHub } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/input/hub.ts'
import { mountNativeResourceSelection, selectResource, type NativeResourceSelection } from 'preset-client-workbench/resource-selection'

it('opens a real selected Skill Session through the resource entry and preserves official drafts on conflict, cancel and re-entry', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'skill-entry-client-'))
  onTestFinished(() => rm(cwd, { recursive: true, force: true }))
  const client = new Context()
  const sessions = new TestSessions(async operation => {
    await operation()
  }, client)
  const hub = new InputHub(client, ((key: string) => key) as never)
  const holds = new Map<string, ReturnType<TestSessions['retain']>>()
  const opened: string[] = []
  const receipts: { selection: { preset: string; skill: string }; sessionId: string; cwd: string; preset: string; tools: string[]; commands: string[] }[] = []
  let prepared: (typeof receipts)[number] | undefined
  let native: NativeResourceSelection | undefined
  let startingDraft = ''
  const cancellation: { beforeOpen?: AbortController } = {}
  const presets = {
    select: async (id: string, preset: string) => {
      expect(prepared).toMatchObject({ sessionId: id, preset })
      await sessions.setProjection(id, 'agentPreset', preset)
      cancellation.beforeOpen?.abort()
      return { ok: true, value: preset }
    }
  }
  const provider = await client.plugin({
    apply(ctx: Context) {
      ctx.provide('sessions', sessions)
      ctx.provide('workspaces', {
        create: async ({ path }: { path: string }) => {
          expect(path).toBe(cwd)
          return { workspaceId: 'selected-workspace', path }
        }
      })
      ctx.provide('remote', { agentPresets: presets })
      ctx.provide('remote.agentPresets', presets)
      ctx.provide('conversation', { input: hub })
      ctx.provide('uiWorkspace', {
        openSession: (id: string) => {
          holds.set(id, sessions.retain(id as never))
          opened.push(id)
        }
      })
    }
  })
  const mounting = mountNativeResourceSelection(client, value => {
    native = value
  })
  await mounting
  expect(native).toBeDefined()
  onTestFinished(async () => {
    for (const ref of holds.values()) ref.release()
    await mounting.dispose()
    await provider.dispose()
    await sessions.disposeScopes()
    await client.fiber.dispose()
    for (const receipt of receipts) localStorage.removeItem(`dsh.conversation.${receipt.sessionId}`)
    localStorage.removeItem('dsh.conversation.previous-session')
  })
  sessions.stubCreate(async options => {
    expect(options).toEqual({ workspaceId: 'selected-workspace' })
    const receipt = prepared!
    if (startingDraft)
      localStorage.setItem(`dsh.conversation.${receipt.sessionId}`, JSON.stringify({ draft: { text: startingDraft, references: [] }, view: 'trajectory', viewRequest: null }))
    await sessions.add({ id: receipt.sessionId, summary: { cwd: receipt.cwd } })
    return SessionId(receipt.sessionId)
  })
  native!.fetch = async (url, options) => {
    if (String(url).endsWith('/config')) return Response.json({ cwd })
    const request = JSON.parse(options!.body as string)
    expect(request).toEqual({ id: 'skill:selected-skill', cwd })
    const sessionId = `skill-entry-${receipts.length + 1}`
    const receiptPath = join(cwd, `${sessionId}.json`)
    const output = await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/skill-resource-host.test.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, SKILL_HOST_REQUEST: JSON.stringify({ ...request, sessionId }), SKILL_HOST_RECEIPT: receiptPath },
      timeout: 30_000
    })
    expect(output.stdout).toContain('1 passed')
    prepared = JSON.parse(await readFile(receiptPath, 'utf8'))
    receipts.push(prepared!)
    expect(prepared!.tools).toContain('subagent')
    expect(prepared!.commands).toContain('compact')
    return Response.json(prepared!.selection)
  }
  const previous = SessionId('previous-session')
  localStorage.setItem(`dsh.conversation.${previous}`, JSON.stringify({ draft: { text: '原任务未发送文字', references: [] }, view: 'trajectory', viewRequest: null }))
  await sessions.add({ id: previous })
  const old = sessions.retain(previous)
  await old.ready
  holds.set(previous, old)
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe('原任务未发送文字')
  const previousStored = localStorage.getItem(`dsh.conversation.${previous}`)
  const result = await selectResource(native!, 'skill:selected-skill', new AbortController().signal, cwd)
  expect(result).toEqual({ sessionId: 'skill-entry-1', preset: 'agent-resource-skill' })
  const current = holds.get(result.sessionId)!
  await current.ready
  const currentBinding = current.binding
  expect(hub.for(currentBinding.ctx).state.getSnapshot().draft).toBe('/selected-skill ')
  expect(opened).toEqual(['skill-entry-1'])
  const retainedBeforeReentry = holds.get(result.sessionId)!
  await native!.open(result.sessionId, undefined, new AbortController().signal)
  retainedBeforeReentry.release()
  expect(hub.for(currentBinding.ctx).state.getSnapshot().draft).toBe('/selected-skill ')
  await expect(native!.open(result.sessionId, 'selected-skill', new AbortController().signal)).rejects.toThrow('RESOURCE_DRAFT_CHANGED')
  expect(hub.for(currentBinding.ctx).state.getSnapshot().draft).toBe('/selected-skill ')
  startingDraft = '准备期间输入的文字'
  await expect(selectResource(native!, 'skill:selected-skill', new AbortController().signal, cwd)).rejects.toThrow('RESOURCE_DRAFT_CHANGED')
  const changedKey = 'dsh.conversation.skill-entry-2'
  expect(JSON.parse(localStorage.getItem(changedKey)!).draft.text).toBe(startingDraft)
  expect(opened).toEqual(['skill-entry-1', 'skill-entry-1'])
  startingDraft = ''
  cancellation.beforeOpen = new AbortController()
  await expect(selectResource(native!, 'skill:selected-skill', cancellation.beforeOpen.signal, cwd)).rejects.toThrow()
  expect(opened).toEqual(['skill-entry-1', 'skill-entry-1'])
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe('原任务未发送文字')
  expect(localStorage.getItem(`dsh.conversation.${previous}`)).toBe(previousStored)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, 'skill-resource-client.json'),
      JSON.stringify(
        {
          receipts,
          opened,
          selectedDraft: hub.for(currentBinding.ctx).state.getSnapshot().draft,
          conflictDraft: JSON.parse(localStorage.getItem(changedKey)!).draft.text,
          previousDraft: hub.for(old.binding.ctx).state.getSnapshot().draft,
          previousStoredPreserved: localStorage.getItem(`dsh.conversation.${previous}`) === previousStored,
          cancelledNavigation: true,
          reentryPreserved: true
        },
        null,
        2
      ) + '\n'
    )
})
