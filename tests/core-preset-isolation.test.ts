import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { presetHarness } from './core-preset-harness.js'

it('rejects a full Manage harness without an explicit isolated environment before touching its home', async () => {
  vi.stubEnv('DSH_HOME', '')
  vi.stubEnv('DSH_AGENTS_HOME', '')
  try {
    await expect(presetHarness({ fullManage: true, home: join(tmpdir(), `missing-isolation-${randomUUID()}`, 'home') })).rejects.toThrow('ISOLATED_MANAGE_HOME_REQUIRED')
  } finally {
    vi.unstubAllEnvs()
  }
})

it('rejects mismatched Manage and Agent roots without initializing user storage', async () => {
  const home = await mkdtemp(join(tmpdir(), 'manage-isolation-guard-'))
  await mkdir(join(home, 'one'))
  await mkdir(join(home, 'two'))
  vi.stubEnv('DSH_HOME', join(home, 'one'))
  vi.stubEnv('DSH_AGENTS_HOME', join(home, 'wrong-agents'))
  try {
    await expect(presetHarness({ fullManage: true, home: join(home, 'one') })).rejects.toThrow('ISOLATED_MANAGE_HOME_REQUIRED')
    vi.stubEnv('DSH_AGENTS_HOME', join(home, 'one', 'agents'))
    await expect(presetHarness({ fullManage: true, home: join(home, 'two') })).rejects.toThrow('ISOLATED_MANAGE_HOME_REQUIRED')
    expect(await stat(join(home, 'one', 'agent-plugins')).catch(() => undefined)).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
})
