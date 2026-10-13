/** Actual Host registry receipt consumed by the official client catalog test. */
import { expect, it, onTestFinished } from 'vitest'
import { record } from './core-preset-harness.js'

it('projects every company resource into one described registry catalog without duplicate identities', async () => {
  const { baseInventoryHarness } = await import('./base-inventory-harness.js')
  const { inventoryRoleInput } = await import('./inventory-family-harness.js')
  const { inventoryRoles } = await import('./inventory-family-cases.js')
  const { salesRoleInput, salesRoles } = await import('./sales-role-input.js')
  const f = await baseInventoryHarness()
  const inventory = await Promise.all(inventoryRoles.map(inventoryRoleInput))
  const sales = await Promise.all(salesRoles.map(role => salesRoleInput(role.id)))
  const definitions = [...inventory.map(row => row.resource), ...sales.flatMap(row => [row.resource!, ...(row.additionalResources ?? [])])]
  const release = await f.resources.register(definitions)
  onTestFinished(release)
  const expected = ['gea-html-inventory-aqkc', ...definitions.filter(row => row.prompt).map(row => row.id)]
  for (const id of expected) await f.resources.select(id, new AbortController().signal, f.home)
  await f.resources.select('skill:inventory-aqkc', new AbortController().signal, f.home)
  const catalog = await f.ctx.agentPresets.list()
  const resources = await f.resources.list({ cwd: f.home })
  expect(new Set(catalog.map(row => row.id)).size).toBe(catalog.length)
  expect(catalog.map(row => row.id)).toEqual(expect.arrayContaining(['standard', 'minimal', 'ptc', 'cordis', 'auto-negotiation', 'agent-resource-skill', ...expected]))
  for (const id of expected) {
    const summary = resources.find(row => row.id === id)!
    const preset = catalog.find(row => row.id === id)!
    expect(summary.description).toBeTruthy()
    expect(preset).toMatchObject({ name: summary.label, description: summary.description })
  }
  expect(catalog.find(row => row.id === 'agent-resource-skill')).toMatchObject({ name: 'Skill', description: expect.any(String) })
  await record('company-catalog', { catalog, resources, source: 'actual package resources and public registry; official locale supplies built-in labels' })
})
