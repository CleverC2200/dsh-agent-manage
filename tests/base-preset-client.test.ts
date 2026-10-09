/** Actual Workbench selection and official drafts, with the shared real Host wire. */
import { expect, it } from 'vitest'
import { resourceClientFixture } from './resource-client-fixture.js'

it('opens the selected base business Session through Workbench and preserves the existing official draft', async () => {
  const sessionId = 'base-resource-entry'
  const preset = 'gea-html-inventory-aqkc'
  const previousDraft = '基地原任务未发送草稿'
  const f = await resourceClientFixture({
    resourceId: preset,
    workspaceId: 'base-workspace',
    sessionId,
    previousDraft,
    hostTest: 'tests/base-resource-host.test.ts',
    hostEnv: 'BASE_HOST',
    evidenceName: 'base-resource-client'
  })
  const observation = await f.select()
  expect(observation.result).toEqual({ sessionId, preset })
  expect(observation.projection).toMatchObject({ sessionId, cwd: f.cwd, preset })
  expect(observation.receipt).toMatchObject({ sessionId, cwd: f.cwd, preset, consumer: 'base-safety-stock', queryConsumer: 'base-safety-stock' })
  expect(observation.receipt.tools).toContain('subagent')
  expect(observation.receipt.commands).toContain('compact')
  expect(observation.opened).toEqual([sessionId])
  expect(observation.selectedDraft).toBe('')
  expect(observation.previousDraft).toBe(previousDraft)
  expect(observation.previousStoredPreserved).toBe(true)
})
