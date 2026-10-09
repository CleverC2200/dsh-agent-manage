/** Sales roles keep their own resource, Consumer and official draft assertions. */
import { expect, it } from 'vitest'
import { resourceClientFixture } from './resource-client-fixture.js'

const salesRoles = [
  { id: 'gea-html-inventory-apsplan', consumer: 'aps' },
  { id: 'gea-readonly', consumer: 'sales_forecast' }
]

it.each(salesRoles)('opens $id through Workbench and preserves the existing official draft', async role => {
  const sessionId = role.id + '-entry'
  const previousDraft = '销售原任务未发送草稿'
  const f = await resourceClientFixture({
    resourceId: role.id,
    workspaceId: role.id + '-workspace',
    sessionId,
    previousDraft,
    hostTest: 'tests/sales-resource-host.test.ts',
    hostEnv: 'SALES_HOST',
    evidenceName: role.id + '-resource-client'
  })
  const observation = await f.select()
  expect(observation.result).toEqual({ sessionId, preset: role.id })
  expect(observation.projection).toMatchObject({ sessionId, cwd: f.cwd, preset: role.id })
  expect(observation.receipt).toMatchObject({ sessionId, cwd: f.cwd, preset: role.id, consumer: role.consumer, queryConsumer: role.consumer })
  expect(observation.receipt.tools).toContain('subagent')
  expect(observation.receipt.commands).toContain('compact')
  expect(observation.opened).toEqual([sessionId])
  expect(observation.selectedDraft).toBe('')
  expect(observation.previousDraft).toBe(previousDraft)
  expect(observation.previousStoredPreserved).toBe(true)
})
