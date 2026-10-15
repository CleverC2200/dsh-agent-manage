import { mkdtemp, rename, rm } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { listenLoopback } from './helpers/http-fixture.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename) }
})

afterEach(() => vi.mocked(rename).mockRestore())

const payload = zipSync({ 'wrapper/plugin.json': Buffer.from(JSON.stringify({ name: 'renamed-source' })) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-operation-'))
  const requested = Promise.withResolvers<ServerResponse>()
  const server = createServer((_request, response) => requested.resolve(response))
  await listenLoopback(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected loopback address')
  const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {}, git: { allowHttpArchives: true } })
  await catalog.load()
  return {
    catalog,
    requested: requested.promise,
    url: `http://127.0.0.1:${address.port}/incoming.zip`,
    async close() {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      await rm(root, { recursive: true, force: true })
    }
  }
}

describe('source operation progress', () => {
  it('reports acquisition and reading through addSource and clears progress after registration', async () => {
    const test = await fixture()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    const reading = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to).endsWith('/.sources/renamed-source')) {
        reading.resolve()
        await release.promise
      }
      return actual.rename(from, to)
    })
    try {
      expect(test.catalog.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
      const operation = test.catalog.addSource({ url: test.url, kind: 'archive' })
      const response = await test.requested
      expect(test.catalog.sourceProgress()).toEqual({ active: true, sourceId: 'incoming', step: 'downloading' })
      expect((await test.catalog.readUserCatalog()).sources).toEqual([])
      response.end(payload)
      await reading.promise
      expect(test.catalog.sourceProgress()).toEqual({ active: true, sourceId: 'incoming', step: 'reading' })
      expect((await test.catalog.readUserCatalog()).sources).toEqual([])
      release.resolve()
      const source = await operation
      expect(source.id).toBe('renamed-source')
      expect(test.catalog.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
      expect((await test.catalog.overview()).sources).toMatchObject([{ id: 'renamed-source', cloned: true }])
    } finally {
      release.resolve()
      await test.close()
    }
  })

  it('clears progress when acquisition fails and leaves the catalog unchanged', async () => {
    const test = await fixture()
    try {
      const operation = test.catalog.addSource({ url: test.url, kind: 'archive' })
      const rejected = expect(operation).rejects.toThrow(/503/)
      const response = await test.requested
      expect(test.catalog.sourceProgress().active).toBe(true)
      response.writeHead(503)
      response.end('fixture unavailable')
      await rejected
      expect(test.catalog.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
      expect((await test.catalog.readUserCatalog()).sources).toEqual([])
    } finally {
      await test.close()
    }
  })

  it('clears progress when acquisition succeeds but checkout rename fails before registration', async () => {
    const test = await fixture()
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to).endsWith('/.sources/renamed-source')) throw new Error('fixture rename denied')
      return actual.rename(from, to)
    })
    try {
      const operation = test.catalog.addSource({ url: test.url, kind: 'archive' })
      const rejected = expect(operation).rejects.toThrow('fixture rename denied')
      const response = await test.requested
      expect(test.catalog.sourceProgress()).toEqual({ active: true, sourceId: 'incoming', step: 'downloading' })
      response.end(payload)
      await rejected
      expect(test.catalog.sourceProgress()).toEqual({ active: false, sourceId: '', step: '' })
      expect((await test.catalog.readUserCatalog()).sources).toEqual([])
    } finally {
      await test.close()
    }
  })
})
