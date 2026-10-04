import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { apply } from '../src/index.js'
import { BusinessResources } from '../src/runtime/business-resources.js'

const roots: string[] = []
const cleanup: Array<() => unknown> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function route() {
  const root = await mkdtemp(join(tmpdir(), 'resource-route-'))
  roots.push(root)
  vi.stubEnv('DSH_HOME', root)
  const routes = new Map<string, ConnectionFetchRoute>()
  const pending: Promise<unknown>[] = []
  const select = vi.spyOn(BusinessResources.prototype, 'select').mockResolvedValue({ id: 'existing', preset: 'original' })
  const context = {
    skills: { registerProvider: () => () => {} },
    agentPresets: { register: async () => async () => {}, resolve: async (id: string) => ({ id }) },
    connection: {
      fetch: {
        register: (entry: ConnectionFetchRoute) => {
          routes.set(entry.path, entry)
          return () => {}
        }
      }
    },
    effect: (operation: () => unknown) => {
      const result = operation()
      if (typeof result === 'function') cleanup.push(result as () => unknown)
      return () => {}
    },
    provide() {},
    logger: { warn() {} },
    inject: (names: string[], callback: (ctx: unknown) => unknown) => {
      if (names.includes('connection')) pending.push(Promise.resolve(callback(context)))
    }
  }
  await apply(context as never, { geaMcp: false })
  await Promise.all(pending)
  return { route: routes.get('/api/agent-manage/resources/select')!, select }
}

it.each(['buffered', 'chunked'])('rejects oversized valid selection JSON before selecting a resource (%s)', async mode => {
  const mounted = await route()
  const payload = JSON.stringify({ id: 'existing' }) + ' '.repeat(65536)
  let body: string | ReadableStream<Uint8Array> = payload
  if (mode === 'chunked')
    body = new ReadableStream({
      start(controller) {
        for (let index = 0; index < payload.length; index += 4096) controller.enqueue(new TextEncoder().encode(payload.slice(index, index + 4096)))
        controller.close()
      }
    })
  const request = new Request('https://host.example/api/agent-manage/resources/select', { method: 'POST', body, duplex: 'half' } as RequestInit)
  const response = await mounted.route.fetch(request)
  expect(response.status).toBe(413)
  expect(mounted.select).not.toHaveBeenCalled()
})

it('accepts valid JSON exactly at the local 64KiB bound', async () => {
  const mounted = await route()
  const prefix = JSON.stringify({ id: 'existing' })
  const response = await mounted.route.fetch(
    new Request('https://host.example/api/agent-manage/resources/select', { method: 'POST', body: prefix + ' '.repeat(65536 - prefix.length) })
  )
  expect(response.status).toBe(200)
  expect(mounted.select).toHaveBeenCalledOnce()
})
