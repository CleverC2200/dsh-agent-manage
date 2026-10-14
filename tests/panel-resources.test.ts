import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { createPanelResources } from '../src/application/panel-resources.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'

describe('installed and user panel resources', () => {
  it('reads one installed resource without probing unrelated market checkouts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panel-read-'))
    const originalTrace = process.env.GIT_TRACE
    try {
      const installed = join(root, '.sources', 'active')
      await mkdir(installed, { recursive: true })
      await cp('tests/fixtures/v1-suite', installed, { recursive: true })
      await mkdir(join(installed, 'agents'), { recursive: true })
      await writeFile(join(installed, 'agents', 'reviewer.md'), 'Review carefully.')
      await writeFile(
        join(root, 'state.json'),
        JSON.stringify({
          version: 1,
          sources: [
            { id: 'active', url: installed, local: true },
            { id: 'unavailable', url: 'https://unavailable.invalid/market.git' }
          ],
          installed: { 'active/v1-suite': { enabled: false, installedAt: new Date(0).toISOString() } }
        })
      )
      const log = join(root, 'git-probes')
      await mkdir(join(root, '.sources', 'unavailable'))
      process.env.GIT_TRACE = log
      const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
      await catalog.load()
      const panels = createPanelResources(catalog, createUserPanelStores(root))
      expect(await panels.agents.get('["active","v1-suite","agents","reviewer"]')).toMatchObject({ content: 'Review carefully.', disabled: true })
      await expect(readFile(log, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      if (originalTrace === undefined) delete process.env.GIT_TRACE
      else process.env.GIT_TRACE = originalTrace
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes each successful resource change without a separate caller notification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panel-changes-'))
    try {
      let changes = 0
      const catalog = new Catalog({
        userRoot: root,
        dataRoot: join(root, 'data'),
        onChanged: () => {
          changes++
        }
      })
      await catalog.load()
      const panels = createPanelResources(catalog, createUserPanelStores(root))
      await panels.commands.create('review', 'Review the change')
      expect(changes).toBe(1)
      expect((await panels.commands.get('review'))?.content).toBe('Review the change')
      await panels.commands.update('review', 'Review the final change')
      expect(changes).toBe(2)
      expect((await panels.commands.get('review'))?.content).toBe('Review the final change')
      await expect(panels.commands.update('review', '---\nmodel: [\n---\ninvalid')).rejects.toThrow()
      expect(changes).toBe(2)
      await panels.commands.remove('review')
      expect(changes).toBe(3)
      expect(await panels.commands.get('review')).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('projects installed resources, preserves structured metadata and applies edits/deletion to the registered file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-panels-'))
    try {
      for (const id of ['active', 'unused']) {
        await mkdir(join(root, '.sources', id), { recursive: true })
        await cp('tests/fixtures/v1-suite', join(root, '.sources', id), { recursive: true })
        await mkdir(join(root, '.sources', id, 'agents'), { recursive: true })
        await writeFile(
          join(root, '.sources', id, 'agents', 'reviewer.md'),
          '---\ndescription: Review code\nmodel: vendor/model\ntools: [read, search]\nmetadata:\n  team: core\n---\nReview carefully.'
        )
      }
      await writeFile(
        join(root, 'state.json'),
        JSON.stringify({
          version: 1,
          sources: ['active', 'unused'].map(id => ({ id, url: join(root, '.sources', id), local: true })),
          installed: { 'active/v1-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
        })
      )
      const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
      await catalog.load()
      const users = createUserPanelStores(root)
      await users.agents.create('reviewer', '---\ndescription: My reviewer\n---\nMy instructions')
      const panels = createPanelResources(catalog, users)
      const rows = await panels.agents.list()
      expect(rows).toHaveLength(2)
      expect(rows.map(row => row.origin).sort()).toEqual(['plugin', 'user'])
      const plugin = rows.find(row => row.origin === 'plugin')!
      expect(plugin.metadata).toMatchObject({ tools: ['read', 'search'], metadata: { team: 'core' } })
      const changed = plugin.rawText.replace('vendor/model', 'vendor/new-model')
      await panels.agents.update(plugin.id!, changed)
      expect(await readFile(plugin.path, 'utf8')).toBe(changed)
      expect((await panels.agents.get(plugin.id!))?.metadata.model).toBe('vendor/new-model')
      await expect(panels.agents.update(plugin.id!, '---\nmodel: [\n---\ntext')).rejects.toThrow()
      expect(await readFile(plugin.path, 'utf8')).toBe(changed)
      await catalog.setSurface('active', 'v1-suite', 'agents', false)
      expect((await panels.agents.get(plugin.id!))?.disabled).toBe(true)
      await panels.agents.remove(plugin.id!)
      expect(await panels.agents.list()).toHaveLength(1)
      await expect(panels.agents.update('["../../etc"]', 'x')).rejects.toThrow('Unknown installed')
      expect((await panels.skills.list()).some(row => row.origin === 'plugin')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
