/** Actual Core/GEA Host used by the sales Workbench client's public wire adapter. */
import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { baseInventoryHarness } from './base-inventory-harness.js'
import { agentOn, completion, turn } from './core-preset-harness.js'
import { profileFor } from 'preset-integration-gea/host/prompt-policy'
import { salesRoleInput, salesRoles } from './sales-role-input.js'

it('selects the requested sales resource and creates its actual Session in the requested workspace', async () => {
  const request = JSON.parse(process.env.SALES_HOST_REQUEST!) as { id: string; cwd: string; sessionId: string }
  const role = salesRoles.find(row => row.id === request.id)!
  expect(role).toBeDefined()
  const f = await baseInventoryHarness({ ...(await salesRoleInput(role.id)), sessionId: request.sessionId, cwd: request.cwd })
  const requests = await completion(f.ctx)
  const standard = await agentOn(f.ctx, request.sessionId + '-standard', 'standard', undefined, request.cwd)
  const standardTools = f.ctx.tools
    .schemas(standard)
    .map(row => row.name)
    .filter(name => !name.startsWith('gea_'))
  expect(f.selection.preset).toBe(request.id)
  expect(f.agent.session.header).toMatchObject({ cwd: request.cwd, agentPreset: f.selection.preset })
  expect(profileFor(f.ctx.agentPresets.composedPreset(f.agent.ctx)!)).toMatchObject({ consumerCode: role.consumer })
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the selected task with its existing business authorization.')
  const tools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(tools).toEqual(expect.arrayContaining(standardTools))
  expect(JSON.stringify(await f.query())).toContain('42')
  await writeFile(
    process.env.SALES_HOST_RECEIPT!,
    JSON.stringify({
      selection: f.selection,
      sessionId: f.agent.id,
      cwd: f.agent.session.header.cwd,
      preset: f.ctx.agentPresets.composedPreset(f.agent.ctx),
      consumer: role.consumer,
      tools,
      standardTools,
      commands: f.ctx.commands.list(f.agent).map(row => row.name),
      queryConsumer: f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode,
      crossConsumers: profileFor(f.selection.preset)?.crossConsumers ?? []
    })
  )
})
