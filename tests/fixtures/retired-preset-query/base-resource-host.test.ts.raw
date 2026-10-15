/** Actual Core/GEA Host for the public Workbench resource client's wire adapter. */
import { expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { baseInventoryHarness } from './base-inventory-harness.js'
import { completion, turn } from './core-preset-harness.js'
import { profileFor } from 'preset-integration-gea/host/prompt-policy'

it('selects the base resource and materializes its returned preset in the requested workspace', async () => {
  const request = JSON.parse(process.env.BASE_HOST_REQUEST!) as { id: string; cwd: string; sessionId: string }
  expect(request.id).toBe('gea-html-inventory-aqkc')
  const f = await baseInventoryHarness({ sessionId: request.sessionId, cwd: request.cwd })
  const requests = await completion(f.ctx)
  expect(f.selection.preset).toBe(request.id)
  expect(f.agent.session.header).toMatchObject({ cwd: request.cwd, agentPreset: f.selection.preset })
  expect(profileFor(f.ctx.agentPresets.composedPreset(f.agent.ctx)!)).toMatchObject({ consumerCode: 'base-safety-stock', crossConsumers: ['sales_forecast'] })
  expect(f.ctx.tools.schemas(f.agent).map(row => row.name)).toContain('subagent')
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the selected inventory task.')
  const tools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(tools).toContain('subagent')
  expect(tools).not.toContain('gea_sales_plan_read')
  expect(JSON.stringify(await f.query())).toContain('42')
  await writeFile(
    process.env.BASE_HOST_RECEIPT!,
    JSON.stringify({
      selection: f.selection,
      sessionId: f.agent.id,
      cwd: f.agent.session.header.cwd,
      preset: f.ctx.agentPresets.composedPreset(f.agent.ctx),
      consumer: profileFor(f.selection.preset)?.consumerCode,
      tools,
      commands: f.ctx.commands.list(f.agent).map(row => row.name),
      queryConsumer: f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode
    })
  )
})
