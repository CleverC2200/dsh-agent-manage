import { beforeEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { presetHarness } from './core-preset-harness.js'

const filesystem = vi.hoisted(() => ({
  mode: 'conflict' as 'conflict' | 'denied' | 'corrupt',
  conflicts: 0,
  nativeConflicts: 0,
  publications: new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
}))

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    async rename(...args: Parameters<typeof fs.rename>) {
      if (String(args[0]).includes('.staging-') && filesystem.mode === 'denied') throw Object.assign(new Error('EPERM: permission denied, rename'), { code: 'EPERM' })
      if (String(args[0]).includes('.staging-')) {
        const destination = String(args[1])
        let publication = filesystem.publications.get(destination)
        if (publication) publication.resolve()
        else {
          publication = Promise.withResolvers<void>()
          filesystem.publications.set(destination, publication)
        }
        await publication.promise
      }
      try {
        await fs.rename(...args)
      } catch (error) {
        if (error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String(error.code))) {
          filesystem.conflicts++
          if (process.platform === 'win32' && error.code === 'EPERM') filesystem.nativeConflicts++
          if (filesystem.mode === 'corrupt') await fs.writeFile(join(String(args[1]), 'tree', 'corrupted.txt'), 'CORRUPTED')
          if (process.platform === 'win32') throw error
          throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
        }
        throw error
      }
    }
  }
})

beforeEach(() => {
  filesystem.mode = 'conflict'
  filesystem.conflicts = 0
  filesystem.nativeConflicts = 0
  filesystem.publications.clear()
})

it('publishes intelligent orchestration when concurrent Skill snapshots encounter Windows directory rename conflicts', async () => {
  const { ctx, home } = await presetHarness()
  expect(filesystem.conflicts).toBeGreaterThan(0)
  if (process.platform === 'win32') expect(filesystem.nativeConflicts).toBeGreaterThan(0)
  expect(await ctx.sessionController.create({ cwd: home, agentPreset: 'auto-negotiation' })).toMatchObject({ agentPreset: 'auto-negotiation' })
  expect(await ctx.agentPresets.resolve('auto-negotiation')).toEqual({ id: 'auto-negotiation' })
})

it.each(['denied', 'corrupt'] as const)('does not publish orchestration when snapshot publication is %s', async mode => {
  filesystem.mode = mode
  const { ctx, home } = await presetHarness()
  const entry = (await ctx.agentResources.list()).find(resource => resource.id === 'auto-negotiation')
  expect(entry).toMatchObject({ enabled: false, error: expect.stringContaining(mode === 'denied' ? 'EPERM' : 'SKILL_SNAPSHOT_CORRUPTED') })
  await expect(ctx.sessionController.create({ cwd: home, agentPreset: 'auto-negotiation' })).rejects.toThrow('Unknown agent preset: auto-negotiation')
})
