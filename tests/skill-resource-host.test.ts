/** Independent production Host behind the resource client's offline wire adapter. */
import { expect, it } from 'vitest'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { completion, official, presetHarness } from './core-preset-harness.js'

it('serves a selected Skill and materializes its real Core Session in the requested workspace', async () => {
  const request = JSON.parse(process.env.SKILL_HOST_REQUEST!) as { id: string; cwd: string; sessionId: string }
  const { ctx, home } = await presetHarness()
  await completion(ctx)
  await writeFile(join(home, 'SKILL.md'), '---\nname: selected-skill\ndescription: Selected task instructions\n---\nKeep the selected task scope.\n')
  const resources = ctx.agentResources
  await resources.register([
    {
      id: 'selected-owner',
      label: 'Selected owner',
      root: home,
      profile: { label: 'Selected owner', consumerCode: 'never-granted', skills: ['selected-skill'] },
      skillFiles: { 'selected-skill': 'SKILL.md' }
    }
  ])
  const selection = await resources.select(request.id, new AbortController().signal, request.cwd)
  const { SessionId } = await official('@deepseek-ai/dsh-session')
  const { agent } = await ctx.agents.create({
    sessionId: SessionId(request.sessionId),
    meta: { cwd: request.cwd, agentPreset: selection.preset },
    agentOptions: { provider: 'local', model: 'test' },
    setup: async agentCtx => {
      await ctx.agentPresets.mount(agentCtx, selection.preset)
    }
  })
  expect(agent.session.header).toMatchObject({ cwd: request.cwd, agentPreset: 'agent-resource-skill' })
  expect(ctx.commands.list(agent).map(row => row.name)).toContain('compact')
  await writeFile(
    process.env.SKILL_HOST_RECEIPT!,
    JSON.stringify({
      selection,
      sessionId: agent.id,
      cwd: agent.session.header.cwd,
      preset: ctx.agentPresets.composedPreset(agent.ctx),
      tools: ctx.tools.schemas(agent).map(row => row.name),
      commands: ctx.commands.list(agent).map(row => row.name)
    })
  )
})
