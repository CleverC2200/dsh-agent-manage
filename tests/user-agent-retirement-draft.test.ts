// @vitest-environment jsdom
/** The official InputHub retains a draft while a separate real Host retires/restarts its Agent. */
import { expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { TestSessions } from '../../../official-latest-standard/packages/test-support/client-runtime/src/sessions.ts'
import { InputHub } from '../../../official-latest-standard/packages/client/ui-conversation/src/client/input/hub.ts'
import { mountConversationDraft, saveConversationDraft } from './conversation-draft-fixture.js'

it('preserves the official conversation draft through Agent retirement and cold recovery', async () => {
  const client = new Context()
  const sessions = new TestSessions(async operation => {
    await operation()
  }, client)
  client.provide('sessions', sessions)
  const id = SessionId('retirement-preserved-draft')
  const key = `dsh.conversation.${id}`
  saveConversationDraft(id, '保留尚未发送的原会话草稿')
  await sessions.add({ id })
  const retained = sessions.retain(id)
  await retained.ready
  onTestFinished(async () => {
    retained.release()
    await sessions.disposeScopes()
    await client.fiber.dispose()
    localStorage.removeItem(key)
  })
  const hub = new InputHub(client, (key => key) as never)
  await mountConversationDraft(hub, retained.binding)
  const stored = localStorage.getItem(key)
  expect(hub.for(retained.binding.ctx).state.getSnapshot().draft).toBe('保留尚未发送的原会话草稿')
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/user-agent-retirement.test.ts', '-t', 'withdraws a personal Agent'],
    {
      cwd: resolve(import.meta.dirname, '..'),
      timeout: 30_000,
      env: process.env
    }
  )
  expect(stderr).not.toContain('FAIL')
  expect(stdout).toContain('1 passed')
  expect(hub.for(retained.binding.ctx).state.getSnapshot().draft).toBe('保留尚未发送的原会话草稿')
  expect(localStorage.getItem(key)).toBe(stored)
  if (process.env.PRESET_EVIDENCE_DIR)
    await writeFile(
      join(process.env.PRESET_EVIDENCE_DIR, 'user-agent-draft-preservation.json'),
      JSON.stringify(
        {
          scope: 'official client InputHub plus independent real Core Host retirement/restart test',
          sessionId: id,
          draftPreserved: true,
          storedDraftPreserved: true,
          installedClient: false
        },
        null,
        2
      ) + '\n'
    )
})
