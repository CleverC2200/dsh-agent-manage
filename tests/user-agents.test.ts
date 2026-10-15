import { expect, it } from 'vitest'
import { join } from 'node:path'
import { UserAgents } from '../src/runtime/user-agents.js'
import { agentOn, completion, presetHarness, turn } from './core-preset-harness.js'

it('persists a personal Agent, publishes standard capabilities and keeps its identity on edit and restart', async () => {
  const { ctx, home, start } = await presetHarness()
  const file = join(home, 'user-agents.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  const saved = await agents.save({ name: '销售助手', description: '个人配置', prompt: 'Answer every request with the marker SALES_PERSONA.', enabled: true })
  expect(saved.publication).toBe('ready')
  expect(ctx.agentPresets.defaultId).toBe('minimal')
  const requests = await completion(ctx)
  const agent = await agentOn(ctx, 'personal-agent', saved.preset)
  const standard = await agentOn(ctx, 'standard-reference', 'standard')
  expect(
    ctx.tools
      .schemas(agent)
      .map(tool => tool.name)
      .sort()
  ).toEqual(
    ctx.tools
      .schemas(standard)
      .map(tool => tool.name)
      .sort()
  )
  expect(ctx.commands.list(agent).map(command => command.name)).toContain('compact')
  await turn(ctx, agent, 'Identify your instructions')
  expect(JSON.stringify(requests)).toContain('SALES_PERSONA')
  const renamed = await agents.save({ ...saved, name: '改名后的助手', prompt: 'UPDATED_PERSONA' })
  expect(renamed.id).toBe(saved.id)
  expect(renamed.preset).toBe(saved.preset)
  expect(ctx.agentPresets.composedPreset(agent.ctx)).toBe(saved.preset)
  await agents.dispose()
  await ctx.fiber.dispose()
  const restored = new UserAgents(await start(), file)
  await restored.load()
  expect(await restored.list()).toContainEqual(expect.objectContaining({ id: saved.id, name: '改名后的助手', prompt: 'UPDATED_PERSONA', publication: 'ready' }))
  await restored.dispose()
})

it('exposes authenticated configuration operations and rejects disabled selection and cross-origin writes', async () => {
  const { mountUserAgentRoutes } = await import('../src/runtime/user-agent-routes.js')
  const { USER_AGENT_ROUTES } = await import('../src/contracts/user-agents.js')
  const { ctx, home } = await presetHarness()
  const agents = new UserAgents(ctx, join(home, 'route-agents.json'))
  await agents.load()
  mountUserAgentRoutes(ctx, agents)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const post = (path: string, value: unknown, origin = 'http://localhost') =>
    handler.fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(value)
      })
    )
  expect((await post(USER_AGENT_ROUTES.save, { name: 'Attacker', description: '', prompt: 'x', enabled: true }, 'https://elsewhere.example')).status).toBe(403)
  const response = await post(USER_AGENT_ROUTES.save, { name: '可选助手', description: '', prompt: 'PERSONAL_INSTRUCTIONS', enabled: true })
  expect(response.status).toBe(200)
  const saved = await response.json()
  expect(await (await post(USER_AGENT_ROUTES.select, { id: saved.id })).json()).toEqual({ preset: saved.preset })
  expect((await post(USER_AGENT_ROUTES.save, { ...saved, name: '' })).status).toBe(400)
  await post(USER_AGENT_ROUTES.enabled, { id: saved.id, enabled: false })
  expect((await post(USER_AGENT_ROUTES.select, { id: saved.id })).status).toBe(400)
  expect(await (await handler.fetch(new Request(`http://localhost${USER_AGENT_ROUTES.list}`))).json()).toContainEqual(
    expect.objectContaining({ id: saved.id, publication: 'disabled' })
  )
  await agents.dispose()
})
