/** Actual Core/GEA Host behind the public Workbench selection wire adapter. */
import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { inventoryFamilyHarness, inventoryRoles } from './inventory-family-harness.js'
import { completion, history, turn } from './core-preset-harness.js'
import { profileFor } from 'preset-integration-gea/host/prompt-policy'

it('materializes the selected inventory preset in its requested workspace and queries its authorized Consumer', async () => {
  const request = JSON.parse(process.env.INVENTORY_HOST_REQUEST!) as { id: string; cwd: string; sessionId: string }
  const role = inventoryRoles.find(row => `gea-html-${row.id}` === request.id)!
  expect(role).toBeDefined()
  const f = await inventoryFamilyHarness(role, { sessionId: request.sessionId, cwd: request.cwd, seed: await history(100) })
  const requests = await completion(f.ctx)
  expect(f.selection.preset).toBe(request.id)
  expect(f.agent.session.header).toMatchObject({ cwd: request.cwd, agentPreset: f.selection.preset })
  expect(profileFor(f.ctx.agentPresets.composedPreset(f.agent.ctx)!)).toMatchObject({ consumerCode: role.consumer, skills: [role.id] })
  const summary = (await f.resources.list()).find(row => row.id === request.id)
  const catalog = (await f.ctx.agentPresets.list()).find(row => row.id === request.id)
  expect(summary).toMatchObject({ label: role.name, description: f.resource.description, skills: [role.id], interpreters: [request.id] })
  expect(catalog).toMatchObject({ name: role.name, description: summary?.description })
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the inventory task selected from the business resource entry.')
  const tools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(tools).toContain('subagent')
  expect(tools).toContain('workflow')
  expect(tools).not.toContain('gea_sales_plan_read')
  expect(JSON.stringify(await f.query())).toContain('42')
  const denied = await f.execute('gea_module_mcp', { consumerCode: role.forbiddenConsumer })
  expect(JSON.stringify(denied)).toContain('GEA_CONSUMER_ROUTE_NOT_REGISTERED')
  const compact = await f.ctx.commands.execute(f.agent, '/compact', [], new AbortController().signal)
  expect(compact?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  await writeFile(
    process.env.INVENTORY_HOST_RECEIPT!,
    JSON.stringify({
      selection: f.selection,
      sessionId: f.agent.id,
      cwd: f.agent.session.header.cwd,
      preset: f.ctx.agentPresets.composedPreset(f.agent.ctx),
      consumer: profileFor(f.selection.preset)?.consumerCode,
      queryConsumer: f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode,
      tools,
      commands: f.ctx.commands.list(f.agent).map(row => row.name),
      summary,
      catalog,
      compact: compact?.result,
      denied
    })
  )
})
