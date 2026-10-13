/** Full Manage cold starts use the shipped Loader, Connection and durable Session APIs. */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, expect, it, onTestFinished } from 'vitest'

const childHome = process.env.MANAGE_COLD_BOOT_HOME
const mode = process.env.MANAGE_COLD_BOOT_MODE

if (!childHome) {
  const scenarios = ['selected', 'gated', 'clean', 'standard-failure', 'legacy-userRoot', 'legacy-dataRoot']
  const observations: unknown[] = []
  afterAll(async () => {
    if (process.env.PRESET_EVIDENCE_DIR && observations.length === scenarios.length)
      await writeFile(join(process.env.PRESET_EVIDENCE_DIR, 'cold-boot.json'), JSON.stringify({ stage: 'offline', fullManage: true, modes: observations }, null, 2) + '\n')
  })
  it.each(scenarios)('restores full Manage resources across cold starts (%s)', async scenario => {
    const home = await mkdtemp(join(tmpdir(), 'manage-cold-boot-'))
    const receipt = join(home, 'receipt.json')
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    if (scenario !== 'clean' && !scenario.startsWith('legacy-')) {
      await mkdir(join(home, 'agent-plugins/data'), { recursive: true })
      await writeFile(join(home, 'agent-plugins/data/selected-resources.json'), '{"version":1,"selected":["agent-resource-skill"]}\n')
    }
    const evidence = process.env.PRESET_EVIDENCE_DIR
    try {
      const result = await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/manage-cold-boot.test.ts'], {
        cwd: resolve(import.meta.dirname, '..'),
        env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), MANAGE_COLD_BOOT_HOME: home, MANAGE_COLD_BOOT_MODE: scenario },
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024
      })
      if (evidence) await writeFile(join(evidence, `cold-boot-${scenario}.log`), result.stdout + result.stderr)
      const observation = JSON.parse(await readFile(receipt, 'utf8'))
      if (scenario.startsWith('legacy-')) expect(observation).toMatchObject({ mode: scenario, legacyOverrideRejected: true })
      else if (scenario === 'standard-failure')
        expect(observation).toMatchObject({ mode: scenario, bootReturned: true, standardInitialization: 'failed', resources: 'unavailable', realInitFailure: true })
      else
        expect(observation).toMatchObject({
          mode: scenario,
          starts: 2,
          restoredPreset: 'agent-resource-skill',
          compact: true,
          previousSessionPreserved: true,
          indexPreserved: true
        })
      observations.push(observation)
      if (evidence) await writeFile(join(evidence, `cold-boot-${scenario}.json`), JSON.stringify(observation, null, 2) + '\n')
    } catch (error) {
      const output = error as { stdout?: string; stderr?: string }
      if (evidence) await writeFile(join(evidence, `cold-boot-${scenario}-failure.log`), (output.stdout ?? '') + (output.stderr ?? ''))
      throw error
    }
  })
} else {
  it('serves the restored Skill through public Fetch and preserves the previous durable Session', async () => {
    // The parent sets both homes before Vitest imports any Manage/Core module.
    const { agentOn, completion, history, official, presetHarness } = await import('./core-preset-harness.js')
    const index = join(childHome, 'agent-plugins/data/selected-resources.json')
    if (mode?.startsWith('legacy-')) {
      const key = mode.slice('legacy-'.length)
      const legacy = join(childHome, 'previous-root')
      await mkdir(legacy)
      await writeFile(join(legacy, 'state.json'), 'original retained bytes')
      const startupMessages: { type: string; args: string[] }[] = []
      const failed = await presetHarness({ fullManage: true, waitForResources: false, home: childHome, startupMessages, manageConfig: { [key]: legacy } })
      expect(startupMessages.some(message => message.args.some(value => value.includes('MANAGE_STORAGE_UPGRADE_REQUIRED')))).toBe(true)
      const response = await failed.ctx.connection
        .createSharedFetchHandler('/api')
        .fetch(new Request(`http://localhost/api/agent-manage/resources?cwd=${encodeURIComponent(childHome)}`))
      expect(response.status).toBe(404)
      expect(await readFile(join(legacy, 'state.json'), 'utf8')).toBe('original retained bytes')
      expect(
        await stat(join(childHome, 'agent-plugins')).then(
          () => 'unexpected storage write',
          error => error.code
        )
      ).toBe('ENOENT')
      await writeFile(
        join(childHome, 'receipt.json'),
        JSON.stringify({ mode, legacyOverrideRejected: true, resources: 'unavailable', previousBytesPreserved: true, startupMessages })
      )
      return
    }
    if (mode === 'standard-failure') {
      const startupMessages: { type: string; args: string[] }[] = []
      const failed = await presetHarness({
        fullManage: true,
        waitForResources: false,
        home: childHome,
        startupMessages,
        importModule: async name => {
          if (name === '@deepseek-ai/dsh-agent-preset') throw Error('COLD_BOOT_STANDARD_MODULE_FAILURE')
          return official(name)
        }
      })
      const response = await failed.ctx.connection
        .createSharedFetchHandler('/api')
        .fetch(new Request(`http://localhost/api/agent-manage/resources?cwd=${encodeURIComponent(childHome)}`))
      expect(response.status).toBe(404)
      expect(
        await failed.ctx.agentPresets.resolve('agent-resource-skill').then(
          () => 'unexpected success',
          error => error.message
        )
      ).toContain('Unknown agent preset')
      expect(startupMessages.some(message => message.args.some(value => value.includes('COLD_BOOT_STANDARD_MODULE_FAILURE')))).toBe(true)
      await writeFile(
        join(childHome, 'receipt.json'),
        JSON.stringify({ mode, bootReturned: true, standardInitialization: 'failed', resources: 'unavailable', realInitFailure: true, startupMessages })
      )
      return
    }
    let gates = 0
    const gatedHosts = new WeakSet<object>()
    const harness = await presetHarness({
      fullManage: true,
      home: childHome,
      importModule:
        mode !== 'gated'
          ? undefined
          : async (name, runtime) => {
              if (name === '@deepseek-ai/dsh-agent-preset' && !gatedHosts.has(runtime)) {
                gatedHosts.add(runtime)
                gates++
                // The first shipped declaration is standard. Gate only its real
                // module import; other official modes and providers start normally.
                await new Promise<void>(release => {
                  const stop = runtime.on('internal/status', fiber => {
                    if (fiber.ctx.fiber.entry?.options.id !== 'dsh-agent-manage' || fiber.state !== 2) return
                    stop()
                    release()
                  })
                })
                // Exercise the public Skill discovery and resource Fetch interfaces
                // while the standard module remains gated. No polling or timer.
                await new Promise<void>((resolveProbe, rejectProbe) => {
                  runtime.inject(['skills', 'connection'], async host => {
                    try {
                      await host.skills.list({ cwd: childHome })
                      const pending = await host.connection
                        .createSharedFetchHandler('/api')
                        .fetch(new Request(`http://localhost/api/agent-manage/resources?cwd=${encodeURIComponent(childHome)}`))
                      expect(pending.status).toBe(404)
                      resolveProbe()
                    } catch (error) {
                      rejectProbe(error)
                      throw error
                    }
                  })
                })
              }
              return official(name)
            }
    })
    expect(harness.startupMessages.flatMap(message => message.args).some(value => value.includes('Unknown agent preset: standard'))).toBe(false)
    let ctx = harness.ctx
    await completion(ctx)
    const request = (method: string, path: string, body?: unknown) =>
      ctx.connection.createSharedFetchHandler('/api').fetch(
        new Request(`http://localhost/api/agent-manage/resources${path}`, {
          method,
          ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
        })
      )
    const skillId = 'skill:sales-forecast-result-analysis'
    const list = await request('GET', `?cwd=${encodeURIComponent(childHome)}`)
    expect(list.status).toBe(200)
    expect(await list.json()).toContainEqual(expect.objectContaining({ id: skillId, kind: 'skill', enabled: true }))
    if (mode !== 'clean') {
      expect(await ctx.agentPresets.resolve('agent-resource-skill')).toEqual({ id: 'agent-resource-skill' })
    }
    const selectionResponse = await request('POST', '/select', { id: skillId, cwd: childHome })
    expect(selectionResponse.status).toBe(200)
    const selection = await selectionResponse.json()
    expect(selection).toEqual({ id: skillId, preset: 'agent-resource-skill', skill: 'sales-forecast-result-analysis' })
    const sourceBody = (await ctx.skills.get(selection.skill, { cwd: childHome }))!.content
    expect(sourceBody).toContain('预测')
    const old = await agentOn(ctx, 'old-minimal-session', 'minimal', await history(2), childHome)
    const oldHeader = old.session.header
    const oldHistory = old.session.snapshotEvents()
    const selected = await agentOn(ctx, 'selected-skill-session', selection.preset, undefined, childHome)
    const standard = await agentOn(ctx, 'standard-reference', 'standard', undefined, childHome)
    const tools = (agent: typeof selected) =>
      ctx.tools
        .schemas(agent)
        .map(row => row.name)
        .sort()
    expect(tools(selected)).toEqual(tools(standard))
    expect(ctx.commands.list(selected)).toEqual(ctx.commands.list(standard))
    expect(ctx.commands.list(selected).map(row => row.name)).toContain('compact')
    expect(ctx.agentPresets.serviceFor(selected, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
    expect(selected.session.header).toMatchObject({ cwd: childHome, agentPreset: 'agent-resource-skill' })
    const originalIndex = await readFile(index)
    await ctx.fiber.dispose()
    ctx = await harness.start()
    await completion(ctx)
    expect(await ctx.agentPresets.resolve('agent-resource-skill')).toEqual({ id: 'agent-resource-skill' })
    const restoredList = await request('GET', `?cwd=${encodeURIComponent(childHome)}`)
    expect(restoredList.status).toBe(200)
    expect(await restoredList.json()).toContainEqual(expect.objectContaining({ id: skillId, enabled: true }))
    expect((await ctx.skills.get(selection.skill, { cwd: childHome }))!.content).toBe(sourceBody)
    expect(await readFile(index)).toEqual(originalIndex)
    const saved = await ctx.sessionPersistence.open(old.id, 'read')
    try {
      expect(saved.header).toEqual({ ...oldHeader, delegationDepth: 0 })
      expect((await saved.read()).events).toEqual(oldHistory)
    } finally {
      await saved.close()
    }
    const recovered = await agentOn(ctx, 'restart-skill-session', selection.preset, undefined, childHome)
    expect(recovered.session.header).toMatchObject({ cwd: childHome, agentPreset: 'agent-resource-skill' })
    expect(ctx.commands.list(recovered).map(row => row.name)).toContain('compact')
    expect(ctx.agentPresets.serviceFor(recovered, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
    await writeFile(
      join(childHome, 'receipt.json'),
      JSON.stringify({
        mode,
        starts: 2,
        gates,
        restoredPreset: selection.preset,
        skill: selection.skill,
        cwd: childHome,
        tools: tools(recovered),
        compact: true,
        previousSessionPreserved: true,
        indexPreserved: true,
        startupMessages: harness.startupMessages
      })
    )
  })
}
