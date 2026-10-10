/** Official client lifecycle plus an independent real Host resource-selection wire. */
import { expect, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TestSessions } from '../../../official-latest-standard/packages/test-support/client-runtime/src/sessions.ts'
import { mountConversationDraft, saveConversationDraft } from './conversation-draft-fixture.js'
import { InputHub } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/input/hub.ts'
import { mountNativeResourceSelection, selectResource, type NativeResourceSelection } from 'preset-client-workbench/resource-selection'

export interface ResourceHostReceipt {
  selection: { preset: string }
  sessionId: string
  cwd: string
  preset: string
  consumer: string
  queryConsumer: string
  tools: string[]
  commands: string[]
}

/** One owner for provider wiring, Session holds, draft storage and Host receipts. */
export async function resourceClientFixture<Receipt extends ResourceHostReceipt = ResourceHostReceipt>(options: {
  resourceId: string
  workspaceId: string
  sessionId: string
  previousDraft: string
  hostTest: string
  hostEnv: string
  evidenceName: string
}) {
  const cwd = await mkdtemp(join(tmpdir(), `${options.workspaceId}-client-`))
  onTestFinished(() => rm(cwd, { recursive: true, force: true }))
  const client = new Context()
  const sessions = new TestSessions(async operation => {
    await operation()
  }, client)
  const hub = new InputHub(client, ((key: string) => key) as never)
  const holds: ReturnType<TestSessions['retain']>[] = []
  const opened: string[] = []
  const previousId = SessionId(`${options.workspaceId}-previous-session`)
  const previousKey = `dsh.conversation.${previousId}`
  let native: NativeResourceSelection | undefined
  let receipt: Receipt
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
          return { workspaceId: options.workspaceId, path }
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
    localStorage.removeItem(`dsh.conversation.${options.sessionId}`)
    localStorage.removeItem(previousKey)
  })
  sessions.stubCreate(async input => {
    expect(input).toEqual({ workspaceId: options.workspaceId })
    await sessions.add({ id: receipt.sessionId, summary: { cwd: receipt.cwd } })
    return SessionId(receipt.sessionId)
  })
  native!.fetch = async (_url, input) => {
    const request = JSON.parse(input!.body as string)
    expect(request).toEqual({ id: options.resourceId, cwd })
    const receiptPath = join(cwd, 'host.json')
    const output = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.preset-integration.config.ts', options.hostTest],
      {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, [`${options.hostEnv}_REQUEST`]: JSON.stringify({ ...request, sessionId: options.sessionId }), [`${options.hostEnv}_RECEIPT`]: receiptPath },
        timeout: 30_000
      }
    )
    expect(output.stdout).toContain('1 passed')
    receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    return Response.json(receipt.selection)
  }
  saveConversationDraft(previousId, options.previousDraft)
  await sessions.add({ id: previousId })
  const old = sessions.retain(previousId)
  await old.ready
  holds.push(old)
  await mountConversationDraft(hub, old.binding)
  const previousStored = localStorage.getItem(previousKey)
  expect(hub.for(old.binding.ctx).state.getSnapshot().draft).toBe(options.previousDraft)
  return {
    cwd,
    async select() {
      let projection: unknown
      const result = await selectResource(native!, options.resourceId, new AbortController().signal, cwd, value => {
        projection = value
      })
      const selected = holds.at(-1)!
      await selected.ready
      const observation = {
        result,
        receipt,
        opened,
        projection,
        selectedDraft: hub.for(selected.binding.ctx).state.getSnapshot().draft,
        previousDraft: hub.for(old.binding.ctx).state.getSnapshot().draft,
        previousStoredPreserved: localStorage.getItem(previousKey) === previousStored
      }
      if (process.env.PRESET_EVIDENCE_DIR) await writeFile(join(process.env.PRESET_EVIDENCE_DIR, `${options.evidenceName}.json`), JSON.stringify(observation, null, 2) + '\n')
      return observation
    }
  }
}
