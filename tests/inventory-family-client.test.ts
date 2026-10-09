/** Inventory roles keep catalog, Consumer and official draft behavior in one client lane. */
import { expect, it } from 'vitest'
import { resourceClientFixture, type ResourceHostReceipt } from './resource-client-fixture.js'
import { inventoryRoles } from './inventory-family-cases.js'

interface InventoryHostReceipt extends ResourceHostReceipt {
  summary: { label: string; description: string }
  catalog: { name: string; description: string }
}

it.each(inventoryRoles)('$name opens from its Workbench resource without changing the old Session draft', async role => {
  const preset = `gea-html-${role.id}`
  const sessionId = `${role.id}-resource-entry`
  const previousDraft = `${role.name}原任务未发送草稿`
  const f = await resourceClientFixture<InventoryHostReceipt>({
    resourceId: preset,
    workspaceId: role.id,
    sessionId,
    previousDraft,
    hostTest: 'tests/inventory-family-host.test.ts',
    hostEnv: 'INVENTORY_HOST',
    evidenceName: `${role.id}-resource-client`
  })
  const observation = await f.select()
  expect(observation.result).toEqual({ sessionId, preset })
  expect(observation.projection).toMatchObject({ sessionId, cwd: f.cwd, preset })
  expect(observation.receipt).toMatchObject({
    sessionId,
    cwd: f.cwd,
    preset,
    consumer: role.consumer,
    queryConsumer: role.consumer,
    summary: { label: role.name },
    catalog: { name: role.name }
  })
  expect(observation.receipt.summary.description).toBe(observation.receipt.catalog.description)
  expect(observation.receipt.tools).toContain('subagent')
  expect(observation.receipt.commands).toContain('compact')
  expect(observation.opened).toEqual([sessionId])
  expect(observation.selectedDraft).toBe('')
  expect(observation.previousDraft).toBe(previousDraft)
  expect(observation.previousStoredPreserved).toBe(true)
})
