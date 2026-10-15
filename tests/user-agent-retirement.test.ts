import { expect, it } from 'vitest'
import { join } from 'node:path'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountUserAgentRoutes } from '../src/runtime/user-agent-routes.js'
import { USER_AGENT_ROUTES } from '../src/contracts/user-agents.js'
import { completion, official, presetHarness, record, turn } from './core-preset-harness.js'

it('withdraws a personal Agent, retains live history and restores a deleted configuration explicitly after cold boot', async () => {
  const { ctx, home, start } = await presetHarness()
  const agents = new UserAgents(ctx, join(home, 'retired-agents.json'))
  await agents.load()
  mountUserAgentRoutes(ctx, agents)
  const changes: Promise<unknown>[] = []
  const unwatch = agents.watch(() => {
    changes.push(agents.list())
  })
  const post = async (host: typeof ctx, path: string, value: unknown) => {
    const response = await host.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify(value)
      })
    )
    return { status: response.status, body: await response.json() }
  }
  const saved = (await post(ctx, USER_AGENT_ROUTES.save, { name: '保留历史', description: '', prompt: 'RETAIN_ORIGINAL_PERSONA', enabled: true })).body
  await completion(ctx)
  const { SessionId } = await official('@deepseek-ai/dsh-session')
  const created = await ctx.sessionController.create({ cwd: home, sessionId: SessionId('retirement-preserved-draft'), agentPreset: saved.preset })
  const live = ctx.agents.get(created.sessionId)!
  await turn(ctx, live, 'Preserve this conversation')
  const history = live.session.snapshotEvents()
  const blank = await ctx.sessionController.create({ cwd: home, sessionId: SessionId('retired-blank-session'), agentPreset: saved.preset })
  await ctx.settings.update('agent-preset-registry', { selectedDefault: saved.preset })
  expect((await post(ctx, USER_AGENT_ROUTES.enabled, { id: saved.id, enabled: false })).status).toBe(200)
  expect((await ctx.agentPresets.list()).map(row => row.id)).not.toContain(saved.preset)
  expect((await post(ctx, USER_AGENT_ROUTES.select, { id: saved.id })).status).toBe(400)
  expect(ctx.agentPresets.composedPreset(live.ctx)).toBe(saved.preset)
  expect(live.session.snapshotEvents()).toEqual(history)
  const deleted = await post(ctx, USER_AGENT_ROUTES.remove, { id: saved.id })
  expect(deleted.status).toBe(200)
  expect(deleted.body).toMatchObject({ id: saved.id, publication: 'deleted', enabled: false, defaultUnavailable: true })
  expect(deleted.body.deletedAt).toEqual(expect.any(String))
  await Promise.all(changes)
  expect(changes).toHaveLength(3)
  unwatch()
  await agents.dispose()
  await ctx.fiber.dispose()
  const cold = await start()
  const restored = new UserAgents(cold, join(home, 'retired-agents.json'))
  await restored.load()
  mountUserAgentRoutes(cold, restored)
  expect(await restored.list()).toContainEqual(expect.objectContaining({ id: saved.id, preset: saved.preset, publication: 'deleted', prompt: 'RETAIN_ORIGINAL_PERSONA' }))
  expect(cold.agentPresets.defaultId).toBe(saved.preset)
  await expect(cold.sessionController.create({ cwd: home, sessionId: created.sessionId })).rejects.toThrow(saved.preset)
  await expect(cold.sessionController.create({ cwd: home, sessionId: blank.sessionId })).rejects.toThrow(saved.preset)
  const stored = await cold.sessionPersistence.open(created.sessionId, 'read')
  try {
    expect((await stored.read()).events).toEqual(history)
  } finally {
    await stored.close()
  }
  const recovered = await post(cold, USER_AGENT_ROUTES.restore, { id: saved.id })
  expect(recovered.body).toMatchObject({ id: saved.id, preset: saved.preset, publication: 'disabled', enabled: false })
  expect((await post(cold, USER_AGENT_ROUTES.select, { id: saved.id })).status).toBe(400)
  await post(cold, USER_AGENT_ROUTES.enabled, { id: saved.id, enabled: true })
  expect(await cold.sessionController.create({ cwd: home, sessionId: created.sessionId })).toEqual(created)
  expect(cold.agentPresets.composedPreset(cold.agents.get(created.sessionId)!.ctx)).toBe(saved.preset)
  expect(await cold.sessionController.create({ cwd: home, sessionId: blank.sessionId })).toEqual(blank)
  expect(cold.agentPresets.defaultId).toBe(saved.preset)
  await record('user-agent-retirement', {
    scope: 'authenticated configuration routes and fixed official Core libraries; local completion',
    preset: saved.preset,
    live: { withdrawnFromRoster: true, originalRevisionRetained: true, historyPreserved: true, defaultUnchanged: true },
    cold: {
      hostRestarted: true,
      missingPresetRejected: true,
      retainedHistoryRead: true,
      blankSessionPresetChecked: true,
      restoredDisabledFirst: true,
      explicitEnableRecoveredSameSession: true,
      defaultUnchanged: true
    },
    limitation: 'Cold recovery composes retained current configuration, not an archived historical revision'
  })
  await restored.dispose()
})

it('requires the missing Skill source again after explicitly restoring and enabling an Agent', async () => {
  const { ctx, home, start } = await presetHarness()
  const file = join(home, 'dependency-retirement.json')
  const agents = new UserAgents(ctx, file)
  await agents.load()
  const release = ctx.skills.register({ name: 'recover-source', description: 'Required source', source: 'bundled', content: 'TRUSTED_DEPENDENCY' })
  const saved = await agents.save({ name: '依赖恢复', description: '', prompt: 'KEEP_PERSONA', enabled: true })
  await agents.saveSkills(saved.id, [{ kind: 'reference', name: 'recover-source', provider: 'runtime', enabled: true }])
  const created = await ctx.sessionController.create({ cwd: home, agentPreset: saved.preset })
  await ctx.sessions.flush(ctx.agents.get(created.sessionId)!.session)
  await agents.remove(saved.id)
  release()
  await agents.dispose()
  await ctx.fiber.dispose()
  const cold = await start()
  const restored = new UserAgents(cold, file)
  await restored.load()
  await restored.restore(saved.id)
  const missing = await restored.setEnabled(saved.id, true)
  expect(missing).toMatchObject({ publication: 'failed', error: 'AGENT_SKILL_SOURCE_MISSING: recover-source' })
  await expect(restored.select(saved.id)).rejects.toThrow('AGENT_SKILL_SOURCE_MISSING')
  await expect(cold.sessionController.create({ cwd: home, sessionId: created.sessionId })).rejects.toThrow(saved.preset)
  const repaired = cold.skills.register({ name: 'recover-source', description: 'Required source', source: 'bundled', content: 'RESTORED_DEPENDENCY' })
  expect((await restored.setEnabled(saved.id, true)).publication).toBe('ready')
  expect(await cold.sessionController.create({ cwd: home, sessionId: created.sessionId })).toEqual(created)
  const agent = cold.agents.get(created.sessionId)!
  expect((await cold.skills.get('recover-source', { scope: agent })).content).toBe('RESTORED_DEPENDENCY')
  repaired()
  await record('user-agent-dependency-recovery', { hostRestarted: true, restoredSourceMissingRejected: true, sourceRestoredExplicitEnableRecoveredSameSession: true })
  await restored.dispose()
})
