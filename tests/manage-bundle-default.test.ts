import { execFile } from 'node:child_process'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'
import { load, dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PresetHarnessOptions } from './core-preset-harness.js'

it('uses the ordinary bundle default and preserves explicit official choices without changing user settings', async () => {
  const isolatedHome = process.env.MANAGE_DEFAULT_HOME
  if (!isolatedHome) {
    const home = await mkdtemp(join(tmpdir(), 'manage-default-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const output = await promisify(execFile)(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/manage-bundle-default.test.ts'], {
      cwd: resolve('.'),
      env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), MANAGE_DEFAULT_HOME: home },
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    })
    expect(output.stdout).toContain('1 passed')
    return
  }
  const { presetHarness } = await import('./core-preset-harness.js')
  for (const selectedDefault of [null, 'standard', 'minimal', 'auto-negotiation']) {
    const home = await mkdtemp(join(isolatedHome, 'profile-'))
    const input: PresetHarnessOptions = { companyBundle: 'manage', fullManage: true, selectedDefault, home }
    const fixture = await presetHarness(input)
    const before = await readFile(fixture.profile.patchPath, 'utf8')
    expect(fixture.ctx.agentPresets.defaultId).toBe(selectedDefault ?? 'auto-negotiation')
    expect(await fixture.ctx.agentPresets.resolve()).toEqual({ id: selectedDefault ?? 'auto-negotiation' })
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(before)
    await fixture.ctx.fiber.dispose()
    const restarted = await fixture.start()
    expect(await restarted.agentPresets.resolve()).toEqual({ id: selectedDefault ?? 'auto-negotiation' })
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(before)
    await restarted.fiber.dispose()
    const bundlePath = join(fixture.profile.dir, 'node_modules/test-bundle/cordis.patch.yml')
    const layers = load(await readFile(bundlePath, 'utf8'), { schema: entryListSchema }) as unknown[]
    // Remove the shipped Manage layer; the first layer is the unchanged Core declaration.
    await writeFile(bundlePath, dump(layers.slice(0, 1), { schema: entryListSchema }))
    input.waitForResources = false
    const removed = await fixture.start()
    expect(removed.agentPresets.defaultId).toBe(selectedDefault ?? 'standard')
    if (selectedDefault === 'auto-negotiation') await expect(removed.agentPresets.resolve()).rejects.toThrow('Unknown agent preset: auto-negotiation')
    else expect(await removed.agentPresets.resolve()).toEqual({ id: selectedDefault ?? 'standard' })
    expect(await readFile(fixture.profile.patchPath, 'utf8')).toBe(before)
    await removed.fiber.dispose()
  }
  const coreHome = await mkdtemp(join(isolatedHome, 'core-only-'))
  const core = await presetHarness({ companyBundle: 'absent', selectedDefault: null, home: coreHome })
  expect(core.ctx.agentPresets.defaultId).toBe('standard')
  expect(await core.ctx.agentPresets.resolve()).toEqual({ id: 'standard' })
  expect((await core.ctx.agentPresets.list()).some(preset => preset.id === 'auto-negotiation')).toBe(false)
}, 60_000)
