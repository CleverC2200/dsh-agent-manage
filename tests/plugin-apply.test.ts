import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../src/index.js'
import { MARKET_ROUTES } from '../src/contracts/market.js'
import type { WebServerService } from '../src/routes.js'
import { LoopbackOAuthClientProvider } from '../src/runtime/mcp-client/oauth.js'
import { addUserMcpServer } from '../src/runtime/mcp-direct-config.js'

interface RegisteredTool {
  name: string
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dsh-agent-plugins-market host entry', () => {
  it('reauthorizes the saved OAuth record and rebuilds only its owned mount', async () => {
    const root = await mkdtemp(join(tmpdir(), 'market-oauth-reauthorize-'))
    vi.stubEnv('DSH_HOME', root)
    const dataRoot = join(root, 'agent-plugins', 'data')
    await addUserMcpServer(dataRoot, 'Cloud_API', { type: 'streamable-http', url: 'https://cloud.example/mcp' })
    await addUserMcpServer(dataRoot, 'Other', { type: 'streamable-http', url: 'https://other.example/mcp' })
    const tokens = { access_token: 'saved-access', refresh_token: 'saved-refresh', token_type: 'Bearer', issuer: 'https://auth.example/' }
    const client = { client_id: 'saved-client', client_secret: 'saved-secret', issuer: 'https://auth.example/' }
    const records = new Map<string, unknown>([['mcp-auth/user-mcp-cloud-api', { kind: 'grant', payload: { clientInformation: client, tokens } }]])
    const store = {
      describeRecord: async (key: string) => ({ configured: records.has(key), writable: true }),
      readRecord: async (key: string) => records.get(key),
      modifyRecord: async (key: string, mutate: (record: unknown) => Promise<unknown>) => records.set(key, await mutate(records.get(key))),
      deleteRecord: async (key: string) => {
        records.delete(key)
      }
    }
    let credentials: typeof store | undefined
    const routes = new Map<string, Parameters<WebServerService['register']>[0]['handler']>()
    const mounts: Array<{ serverName: string; disposed: boolean }> = []
    const cleanups: Array<() => void> = []
    const effect = (run: () => () => void) => cleanups.push(run())
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.includes('webServer'))
          callback({
            effect,
            webServer: {
              register: (route: Parameters<WebServerService['register']>[0]) => {
                routes.set(route.path, route.handler)
                return () => routes.delete(route.path)
              }
            }
          })
      },
      get: (name: string) => (name === 'credentials' ? credentials : undefined),
      plugin: (_plugin: unknown, config: { serverName: string }) => {
        const mount = { serverName: config.serverName, disposed: false }
        mounts.push(mount)
        return {
          await: async () => {},
          dispose: async () => {
            mount.disposed = true
          }
        }
      },
      skills: { registerProvider: () => () => {} },
      effect,
      on: () => () => {},
      logger: { warn: () => {} }
    }
    const provider = (serverName: string) =>
      new LoopbackOAuthClientProvider(
        serverName,
        {},
        undefined,
        () => {},
        store,
        async () => {}
      )
    const reauthorize = async (serverName: string): Promise<{ ok: boolean; error?: string }> => {
      const handler = routes.get(MARKET_ROUTES.mcpReauthorize)
      if (!handler) throw Error('reauthorize route not mounted')
      return new Promise((resolve, reject) => {
        const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ serverName }))]), {
          method: 'POST',
          url: MARKET_ROUTES.mcpReauthorize,
          headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' }
        })
        void Promise.resolve(handler(request as never, { writeHead: () => {}, end: (body: string) => resolve(JSON.parse(body)) } as never)).catch(reject)
      })
    }
    try {
      await apply(context as never)
      await vi.waitFor(() => expect(mounts).toHaveLength(2))
      const original = mounts.find(mount => mount.serverName === 'user-mcp__Cloud_API')!
      const other = mounts.find(mount => mount.serverName === 'user-mcp__Other')!
      const cloud = provider(original.serverName)
      await expect(cloud.clientInformation()).resolves.toEqual(client)
      await expect(cloud.tokens()).resolves.toEqual(tokens)
      await provider(other.serverName).saveTokens({ ...tokens, access_token: 'other-access' })

      await expect(reauthorize(original.serverName)).resolves.toEqual({ ok: false, error: 'credentials service is not mounted' })
      await expect(cloud.tokens()).resolves.toEqual(tokens)
      expect(original.disposed).toBe(false)

      // The service may provision after Manage applies; resolve it at action time.
      credentials = store
      await expect(reauthorize(original.serverName)).resolves.toEqual({ ok: true })
      const reauthorized = provider(original.serverName)
      await expect(reauthorized.clientInformation()).resolves.toBeUndefined()
      await expect(reauthorized.tokens()).resolves.toBeUndefined()
      expect(original.disposed).toBe(true)
      expect(mounts.filter(mount => mount.serverName === original.serverName)).toHaveLength(2)
      expect(other.disposed).toBe(false)
      await expect(provider(other.serverName).tokens()).resolves.toMatchObject({ access_token: 'other-access' })

      await expect(reauthorize('unknown__server')).resolves.toEqual({ ok: true })
      expect(mounts).toHaveLength(3)
    } finally {
      cleanups.reverse().forEach(cleanup => cleanup())
      await vi.waitFor(() => expect(mounts.every(mount => mount.disposed)).toBe(true))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not register a redundant agent_plugins model tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    const registrations: RegisteredTool[] = []
    const cleanups: Array<() => void> = []
    const tools = {
      register: (definition: RegisteredTool) => {
        registrations.push(definition)
        return () => {}
      }
    }
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.length === 1 && services.includes('tools')) callback({ tools, effect: (effect: () => () => void) => cleanups.push(effect()) })
        if (services.includes('webServer')) callback({ effect: () => {} })
      },
      skills: {
        registerProvider: (create: (control: { signal: AbortSignal; invalidate: () => void }) => unknown) => {
          create({ signal: new AbortController().signal, invalidate: () => {} })
          return () => {}
        }
      },
      effect: (effect: () => () => void) => cleanups.push(effect()),
      on: () => () => {},
      logger: { warn: () => {} }
    }

    await apply(context as never)

    expect(registrations.map(tool => tool.name)).not.toContain('agent_plugins')
    // Dispose the instance: a live plugin keeps reconciling and would leak
    // calls into the next test's RuntimeReconciler spy.
    cleanups.forEach(cleanup => cleanup())
  })
})
