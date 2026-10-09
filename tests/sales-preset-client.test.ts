/** Reuses the Skill lane's official InputHub and separate real Host wire adapter. */
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

const salesRoles = [
  { id: 'gea-html-inventory-apsplan', consumer: 'aps' },
  { id: 'gea-readonly', consumer: 'sales_forecast' }
]

it.each(salesRoles)('opens $id through Workbench and preserves the existing official draft', async role => {
  const cwd = await mkdtemp(join(tmpdir(), 'sales-entry-client-'))
  onTestFinished(() => rm(cwd, { recursive: true, force: true }))
  const client = new Context()
  const sessions = new TestSessions(async operation => {
    await operation()
  }, client)
  const hub = new InputHub(client, ((key: string) => key) as never)
  const holds: ReturnType<TestSessions['retain']>[] = []
  const opened: string[] = []
  let native: NativeResourceSelection | undefined
  let receipt: { selection: { preset: string }; sessionId: string; cwd: string; preset: string; consumer: string; queryConsumer: string; tools: string[]; commands: string[] }
  const sessionId = role.id + '-entry'
  const presets = {
    select: async (id: string, preset: string) => {
      expect(receipt).toMatchObject({ sessionId: id, preset })
      await sessions.setProjection(id, 'agentPreset', preset)
      return { ok: true, value: preset }
    }
  }
  const provider = await client.plugin({
    apply(ctx: Context) {
      ctx.provide('sessions', sessions)
      ctx.provide('workspaces', {
        create: async ({ path }: { path: string }) => {
          expect(path).toBe(cwd)
          return { workspaceId: 'base-workspace', path }
        }
      })
      ctx.provide('remote', { agentPresets: presets })
      ctx.provide('remote.agentPresets', presets)
      ctx.provide('conversation', { input: hub })
      ctx.provide('uiWorkspace', {
        openSession: (id: string) => {
          holds.push(sessions.retain(id as never))
          opened.push(id)
        }
      })
    }
  })
  const mounting = mountNativeResourceSelection(client, value => {
    native = value
  })
  await mounting
  onTestFinished(async () => {
    for (const ref of holds) ref.release()
    await mounting.dispose()
    await provider.dispose()
    await sessions.disposeScopes()
    await client.fiber.dispose()
    localStorage.removeItem(`dsh.conversation.${sessionId}`)
    localStorage.removeItem('dsh.conversation.base-previous-session')
  })
  sessions.stubCreate(async options => {
    expect(options).toEqual({ workspaceId: 'base-workspace' })
    await sessions.add({ id: receipt.sessionId, summary: { cwd: receipt.cwd } })
    return SessionId(receipt.sessionId)
  })
  native!.fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string)
    expect(request).toEqual({ id: role.id, cwd })
    const receiptPath = join(cwd, 'host.json')
    const output = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.preset-integration.config.ts', 'tests/sales-resource-host.test.ts'],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, SALES_HOST_REQUEST: JSON.stringify({ ...request, sessionId }), SALES_HOST_RECEIPT: receiptPath },
        timeout: 30_000
      }
    )
    expect(output.stdout).toContain('1 passed')
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    return Response.json(receipt.selection)
  }
  const previousId = SessionId('base-previous-session')
  const previousKey = `dsh.conversation.${previousId}`
  localStorage.setItem(previousKey, JSON.stringify({ draft: { text: '销售原任务未发送草稿', references: [] }, view: 'trajectory', viewRequest: null }))
  await sessions.add({ id: previousId })
  const old = sessions.retain(previousId)
  await old.ready
  holds.push(old)
  const previousStored = localStorage.getItem(previousKey)
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe('销售原任务未发送草稿')
  let projection: unknown
  const result = await selectResource(native!, role.id, new AbortController().signal, cwd, value => {
    projection = value
  })
  expect(result).toEqual({ sessionId, preset: role.id })
  expect(projection).toMatchObject({ sessionId, cwd, preset: role.id })
  expect(receipt!).toMatchObject({ sessionId, cwd, preset: result.preset, consumer: role.consumer, queryConsumer: role.consumer })
  expect(receipt!.tools).toContain('subagent')
  expect(receipt!.commands).toContain('compact')
  expect(opened).toEqual([sessionId])
  const selected = holds.at(-1)!
  await selected.ready
  expect(hub.for(selected.binding.ctx).state.getSnapshot().draft).toBe('')
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe('销售原任务未发送草稿')
  expect(localStorage.getItem(previousKey)).toBe(previousStored)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, role.id + '-resource-client.json'),
      JSON.stringify(
        {
          receipt: receipt!,
          opened,
          projection,
          selectedDraft: hub.for(selected.binding.ctx).state.getSnapshot().draft,
          previousDraft: hub.for(old.binding.ctx).state.getSnapshot().draft,
          previousStoredPreserved: localStorage.getItem(previousKey) === previousStored
        },
        null,
        2
      ) + '\n'
    )
})
