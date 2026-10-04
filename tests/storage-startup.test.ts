import { mkdtemp, mkdir, symlink, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { apply } from '../src/index.js'

afterEach(() => vi.unstubAllEnvs())

it.each(['userRoot', 'dataRoot'])('rejects the retired %s configuration before exposing providers or touching storage', async key => {
  const root = await mkdtemp(join(tmpdir(), 'manage-config-'))
  try {
    const previous = join(root, 'previous')
    await mkdir(previous)
    await writeFile(join(previous, 'state.json'), 'retain original bytes')
    const canonical = join(root, 'home')
    vi.stubEnv('DSH_HOME', canonical)
    const inject = vi.fn()
    const effect = vi.fn()
    await expect(apply({ inject, effect } as never, { [key]: previous } as never)).rejects.toThrow('MANAGE_STORAGE_UPGRADE_REQUIRED')
    expect(inject).not.toHaveBeenCalled()
    expect(effect).not.toHaveBeenCalled()
    expect(await readFile(join(previous, 'state.json'), 'utf8')).toBe('retain original bytes')
    expect(await readdir(root)).toEqual(['previous'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it.each(['', 'agent-plugins', 'agent-plugins/data', 'agent-plugins/user', 'agent-plugins/.sources'])(
  'refuses the canonical symbolic-link directory %s before any runtime mount',
  async suffix => {
    const root = await mkdtemp(join(tmpdir(), 'manage-storage-'))
    try {
      const home = join(root, 'home')
      const outside = join(root, 'outside')
      await mkdir(outside)
      await writeFile(join(outside, 'retained.txt'), 'original')
      const target = suffix === '' ? home : join(home, suffix)
      await mkdir(dirname(target), { recursive: true })
      await symlink(outside, target, 'dir')
      vi.stubEnv('DSH_HOME', home)
      const inject = vi.fn()
      const effect = vi.fn()
      await expect(apply({ inject, effect } as never, { geaMcp: false })).rejects.toThrow('symbolic-link directory')
      expect(inject).not.toHaveBeenCalled()
      expect(effect).not.toHaveBeenCalled()
      expect(await readdir(outside)).toEqual(['retained.txt'])
      expect(await readFile(join(outside, 'retained.txt'), 'utf8')).toBe('original')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
