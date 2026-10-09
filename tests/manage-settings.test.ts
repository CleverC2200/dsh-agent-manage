/** Native SettingsForms edits the actual Manage Loader entry in an isolated Host. */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'

it('projects and persists live Manage configuration through official SettingsForms', async () => {
  const isolatedHome = process.env.MANAGE_SETTINGS_HOME
  if (!isolatedHome) {
    const home = await mkdtemp(join(tmpdir(), 'manage-settings-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const output = await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/manage-settings.test.ts'], {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), MANAGE_SETTINGS_HOME: home },
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024
    })
    const receipt = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'))
    expect(receipt).toMatchObject({ namespace: 'dsh-agent-manage', defaults: true, liveUpdates: true, restartPreserved: true, reset: true, resourcesPreserved: true })
    if (process.env.PRESET_EVIDENCE_DIR) {
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'manage-settings.json'), JSON.stringify(receipt, null, 2) + '\n')
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'manage-settings.log'), output.stdout + output.stderr)
    }
    return
  }
  const { agentOn, completion, official, presetHarness } = await import('./core-preset-harness.js')
  const fixture = await presetHarness({ fullManage: true, home: isolatedHome, manageConfig: { git: { timeoutMs: 12345, cloneRetry: false } } })
  let ctx = fixture.ctx
  await completion(ctx)
  const serve = async () => {
    const server = await official('@deepseek-ai/dsh-host-webserver')
    await ctx.plugin(server.default ?? server, { host: '127.0.0.1', port: 0 }).await()
  }
  await serve()
  const backend = async () => {
    const response = await fetch(`http://127.0.0.1:${ctx.webServer.port}/api/agent-plugins/mcp-backend`)
    expect(response.status).toBe(200)
    return response.json()
  }
  const namespace = 'dsh-agent-manage'
  const ordinaryConfig = () => [...ctx.loader.entries()].find(entry => entry.options.id === namespace)!.fiber!.config
  const originalConfig = { geaMcp: false, sources: [], git: { timeoutMs: 12345, cloneRetry: false } }
  expect(ordinaryConfig()).toMatchObject(originalConfig)
  const descriptor = () => ctx.settings.describe().find(row => row.ns === namespace)
  const defaults = { mcpEnhanced: true, downloadRegion: 'auto', feedbackEnabled: true, scanProjectLayouts: true }
  expect(descriptor()).toMatchObject({ ns: namespace, value: defaults, applies: 'live' })
  expect(ctx.settings.describe().some(row => row.ns === 'dsh-agent-plugins-market')).toBe(false)
  const initial = await agentOn(ctx, 'settings-standard', 'standard', undefined, isolatedHome)
  const tools = () => ctx.tools.schemas(initial).map(row => row.name)
  expect(tools()).toContain('report_market_issue')
  expect(tools()).not.toContain('agent_plugins')
  expect(await backend()).toMatchObject({ backend: 'builtin', downloadRegion: { setting: 'auto' } })
  const resources = ctx.agentResources
  const disabled = { mcpEnhanced: false, downloadRegion: 'china', feedbackEnabled: false, scanProjectLayouts: false }
  await ctx.settings.update(namespace, disabled, descriptor()!.revision)
  expect(descriptor()?.value).toEqual(disabled)
  expect(ordinaryConfig()).toMatchObject(originalConfig)
  expect(tools()).not.toContain('report_market_issue')
  expect(ctx.agentResources).toBe(resources)
  expect(await backend()).toMatchObject({ backend: 'host', downloadRegion: { setting: 'china' } })
  const writeBackend = await fetch(`http://127.0.0.1:${ctx.webServer.port}/api/agent-plugins/set-mcp-backend`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ backend: 'builtin' })
  })
  expect(writeBackend.status).toBe(200)
  expect(descriptor()?.value).toMatchObject({ mcpEnhanced: true })
  await ctx.settings.update(namespace, { mcpEnhanced: false })
  const savedPatch = await readFile(fixture.profile.patchPath, 'utf8')
  expect(savedPatch).toContain('dsh-agent-manage')
  expect(savedPatch).not.toContain('dsh-agent-plugins-market')
  await ctx.fiber.dispose()
  ctx = await fixture.start()
  await completion(ctx)
  await serve()
  expect(descriptor()?.value).toEqual(disabled)
  expect(ordinaryConfig()).toMatchObject(originalConfig)
  expect(await backend()).toMatchObject({ backend: 'host', downloadRegion: { setting: 'china' } })
  const restarted = await agentOn(ctx, 'settings-restart', 'standard', undefined, isolatedHome)
  expect(ctx.tools.schemas(restarted).map(row => row.name)).not.toContain('report_market_issue')
  await ctx.settings.replace(namespace, {})
  expect(descriptor()?.value).toEqual(defaults)
  expect(ordinaryConfig()).toMatchObject(originalConfig)
  expect(ctx.tools.schemas(restarted).map(row => row.name)).toContain('report_market_issue')
  await ctx.settings.mutate(namespace, [{ op: 'set', path: ['feedbackEnabled'], value: false }])
  expect(ctx.tools.schemas(restarted).map(row => row.name)).not.toContain('report_market_issue')
  expect(fixture.startupMessages.filter(message => message.type === 'error')).toEqual([])
  await writeFile(
    join(isolatedHome, 'settings.json'),
    JSON.stringify({
      namespace,
      defaults: true,
      liveUpdates: true,
      restartPreserved: true,
      reset: true,
      resourcesPreserved: true,
      ordinaryConfigPreserved: true,
      startupMessages: fixture.startupMessages
    })
  )
})
