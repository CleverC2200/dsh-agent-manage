// @vitest-environment jsdom
/** Official client source graph; separate Host process keeps Core module identities intact. */
import { expect, it, onTestFinished } from 'vitest'
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

it('preserves an existing official Session draft when the new-task default is saved and restarted', async () => {
  const receiptDir = await mkdtemp(join(tmpdir(), 'preset-draft-receipt-'))
  const receiptPath = join(receiptDir, 'host.json')
  onTestFinished(() => rm(receiptDir, { recursive: true, force: true }))
  const client = new Context()
  const sessions = new TestSessions(async (operation: () => Promise<void>) => {
    await operation()
  }, client)
  client.provide('sessions', sessions)
  const id = SessionId('preserved-draft')
  const key = `dsh.conversation.${id}`
  const draft = { text: '尚未发送的原任务草稿', references: [] }
  saveConversationDraft(id, draft.text)
  await sessions.add({ id })
  const retained = sessions.retain(id)
  await retained.ready
  onTestFinished(async () => {
    retained.release()
    await sessions.disposeScopes()
    await client.fiber.dispose()
    localStorage.removeItem(key)
  })
  const binding = retained.binding
  const hub = new InputHub(client, ((key: string) => key) as never)
  await mountConversationDraft(hub, binding)
  const input = hub.for(binding.ctx)
  const before = input.state.getSnapshot().draft
  expect(before).toBe(draft.text)
  const stored = localStorage.getItem(key)
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/standard-preset.test.ts', '-t', 'restores only the official saved default'],
    { cwd: resolve(import.meta.dirname, '..'), env: { ...process.env, PRESET_RECEIPT_PATH: receiptPath }, timeout: 30_000 }
  )
  expect(stderr).not.toContain('FAIL')
  expect(stdout).toContain('1 passed')
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  expect(receipt).toEqual({
    defaultBefore: 'minimal',
    defaultAfter: 'auto-negotiation',
    officialSettings: true,
    coldRestart: true,
    originalSessionPreserved: true,
    unrelatedPreferencePreserved: true
  })
  expect(hub.for(binding.ctx).state.getSnapshot().draft).toBe(before)
  expect(localStorage.getItem(key)).toBe(stored)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, 'draft-preservation.json'),
      JSON.stringify(
        { hostReceipt: receipt, draftBefore: before, draftAfter: hub.for(binding.ctx).state.getSnapshot().draft, storedValuePreserved: localStorage.getItem(key) === stored },
        null,
        2
      ) + '\n'
    )
})
