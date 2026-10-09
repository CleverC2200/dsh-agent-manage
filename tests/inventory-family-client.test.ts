/** Official InputHub and actual Workbench selection, wired to an independent actual Host. */
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
import { inventoryRoles } from './inventory-family-cases.js'

it.each(inventoryRoles)('$name opens from its Workbench resource without changing the old Session draft', async role => {
  const cwd = await mkdtemp(join(tmpdir(), `${role.id}-client-`))
  onTestFinished(() => rm(cwd, { recursive: true, force: true }))
  const client = new Context()
  const sessions = new TestSessions(async operation => {
    await operation()
  }, client)
  const hub = new InputHub(client, ((key: string) => key) as never)
  const holds: ReturnType<TestSessions['retain']>[] = []
  const opened: string[] = []
  let native: NativeResourceSelection | undefined
  let receipt: {
    selection: { preset: string }
    sessionId: string
    cwd: string
    preset: string
    consumer: string
    queryConsumer: string
    tools: string[]
    commands: string[]
    summary: { label: string; description: string }
    catalog: { name: string; description: string }
  }
  const preset = `gea-html-${role.id}`
  const sessionId = `${role.id}-resource-entry`
  const previousId = SessionId(`${role.id}-previous-session`)
  const presets = {
    select: async (id: string, selectedPreset: string) => {
      expect(receipt).toMatchObject({ sessionId: id, preset: selectedPreset })
      await sessions.setProjection(id, 'agentPreset', selectedPreset)
      return { ok: true, value: selectedPreset }
    }
  }
  const provider = await client.plugin({
    apply(ctx: Context) {
      ctx.provide('sessions', sessions)
      ctx.provide('workspaces', {
        create: async ({ path }: { path: string }) => {
          expect(path).toBe(cwd)
          return { workspaceId: role.id, path }
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
    localStorage.removeItem(`dsh.conversation.${previousId}`)
  })
  sessions.stubCreate(async options => {
    expect(options).toEqual({ workspaceId: role.id })
    await sessions.add({ id: receipt.sessionId, summary: { cwd: receipt.cwd } })
    return SessionId(receipt.sessionId)
  })
  native!.fetch = async (_url, options) => {
    const request = JSON.parse(options!.body as string)
    expect(request).toEqual({ id: preset, cwd })
    const receiptPath = join(cwd, 'host.json')
    const output = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.preset-integration.config.ts', 'tests/inventory-family-host.test.ts'],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, INVENTORY_HOST_REQUEST: JSON.stringify({ ...request, sessionId }), INVENTORY_HOST_RECEIPT: receiptPath },
        timeout: 30_000
      }
    )
    expect(output.stdout).toContain('1 passed')
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    return Response.json(receipt.selection)
  }
  const previousKey = `dsh.conversation.${previousId}`
  const previousDraft = `${role.name}原任务未发送草稿`
  localStorage.setItem(previousKey, JSON.stringify({ draft: { text: previousDraft, references: [] }, view: 'trajectory', viewRequest: null }))
  await sessions.add({ id: previousId })
  const old = sessions.retain(previousId)
  await old.ready
  holds.push(old)
  const previousStored = localStorage.getItem(previousKey)
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe(previousDraft)
  let projection: unknown
  const result = await selectResource(native!, preset, new AbortController().signal, cwd, value => {
    projection = value
  })
  expect(result).toEqual({ sessionId, preset })
  expect(projection).toMatchObject({ sessionId, cwd, preset })
  expect(receipt!).toMatchObject({ sessionId, cwd, preset, consumer: role.consumer, queryConsumer: role.consumer, summary: { label: role.name }, catalog: { name: role.name } })
  expect(receipt!.summary.description).toBe(receipt!.catalog.description)
  expect(receipt!.tools).toContain('subagent')
  expect(receipt!.commands).toContain('compact')
  expect(opened).toEqual([sessionId])
  const selected = holds.at(-1)!
  await selected.ready
  expect(hub.for(selected.binding.ctx).state.getSnapshot().draft).toBe('')
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe(previousDraft)
  expect(localStorage.getItem(previousKey)).toBe(previousStored)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, `${role.id}-resource-client.json`),
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
