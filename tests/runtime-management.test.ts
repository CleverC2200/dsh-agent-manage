import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { bindHostLocale } from '../src/runtime/host-locale.js'
import { addUserMcpServer } from '../src/runtime/mcp-direct-config.js'
import type { McpBackend } from '../src/runtime/mcp-backend.js'
import type { RuntimeHost } from '../src/application/runtime-management.js'

const roots: string[] = []
const runtimes: Array<Catalog['runtime']> = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(server: unknown, startup: () => Promise<void> = async () => {}, release: () => Promise<void> = async () => {}, withCommands = false) {
  const root = await mkdtemp(join(tmpdir(), 'manage-runtime-'))
  roots.push(root)
  if (withCommands) {
    const source = join(root, 'commands')
    await mkdir(join(source, '.claude-plugin'), { recursive: true })
    await mkdir(join(source, 'commands'))
    await writeFile(join(source, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'commands' }))
    await writeFile(join(source, 'commands/review.md'), '---\ndescription: Review fixture\n---\nReview $ARGUMENTS')
    await writeFile(
      join(root, 'state.json'),
      JSON.stringify({
        version: 1,
        sources: [{ id: 'local', url: source, local: true }],
        installed: { 'local/commands': { enabled: true, installedAt: new Date(0).toISOString() } }
      })
    )
  }
  const dataRoot = join(root, 'data')
  await addUserMcpServer(dataRoot, 'demo', server)
  const mounts: Array<{ config: Record<string, unknown>; disposed: boolean }> = []
  const events = new Map<string, (ref: string) => void>()
  const commands = new Set<string>()
  let backend: McpBackend = 'builtin'
  let credential = 'first-secret'
  const ctx = {
    commands: {
      register: ({ name }: { name: string }) => {
        commands.add(name)
        return () => commands.delete(name)
      }
    },
    on: (name: string, listener: (ref: string) => void) => {
      events.set(name, listener)
      return () => events.delete(name)
    },
    get: (name: string) => (name === 'credentials' ? { resolve: async () => ({ value: credential, source: 'fixture' }) } : undefined),
    plugin: (_plugin: unknown, config: Record<string, unknown>) => {
      const mounted = { config, disposed: false }
      mounts.push(mounted)
      return {
        await: startup,
        dispose: async () => {
          await release()
          mounted.disposed = true
        }
      }
    },
    logger: { warn: () => {} }
  }
  const host: RuntimeHost = {
    ctx: ctx as never,
    translate: bindHostLocale(undefined),
    backend: async () => backend,
    writeBackend: async value => {
      backend = value
    },
    tools: () => [],
    deleteGrantRecord: async () => {}
  }
  const catalog = new Catalog({ userRoot: root, dataRoot, onChanged: () => {}, runtime: host })
  await catalog.load()
  runtimes.push(catalog.runtime)
  return {
    catalog,
    mounts,
    events,
    commands,
    rotateCredential: () => {
      credential = 'second-secret'
    }
  }
}

describe('Catalog runtime management', () => {
  it('replaces an unchanged live server when switching backend and reports unsupported transports', async () => {
    const { catalog, mounts } = await setup({ type: 'sse', url: 'https://example.test/sse' })
    await catalog.runtime.reconcile()
    expect(mounts).toHaveLength(1)
    await catalog.runtime.setMcpBackend('host')
    expect(await catalog.runtime.mcpBackend()).toBe('host')
    expect(mounts[0]!.disposed).toBe(true)
    expect((await catalog.runtime.mcpStatus()).entries).toEqual([
      expect.objectContaining({ state: 'failed', reason: expect.stringContaining('does not support the legacy SSE'), canReauthorize: false })
    ])
    await catalog.runtime.setMcpBackend('builtin')
    expect(mounts).toHaveLength(2)
    expect((await catalog.runtime.mcpStatus()).entries[0]!.canReauthorize).toBe(true)
  })

  it('keeps a requested reauthorization pending when release fails so retry rebuilds the owned mount', async () => {
    let failRelease = true
    const { catalog, mounts } = await setup(
      { type: 'streamable-http', url: 'https://example.test/mcp' },
      async () => {},
      async () => {
        if (failRelease) {
          failRelease = false
          throw Error('release busy')
        }
      }
    )
    await catalog.runtime.reconcile()
    await catalog.runtime.reauthorizeMcpServer('user-mcp__demo')
    expect(mounts[0]!.disposed).toBe(false)
    expect((await catalog.runtime.mcpStatus()).entries[0]).toMatchObject({ state: 'failed', reason: 'unmount failed: release busy' })
    await catalog.runtime.retryMounts()
    expect(mounts[0]!.disposed).toBe(true)
    expect(mounts).toHaveLength(2)
    expect((await catalog.runtime.mcpStatus()).entries[0]!.state).not.toBe('failed')
  })

  it('coalesces credential bursts during a slow first mount into a fresh resolved configuration', async () => {
    let finishStartup!: () => void
    const startup = new Promise<void>(resolve => {
      finishStartup = resolve
    })
    const { catalog, mounts, events, rotateCredential } = await setup({ type: 'stdio', command: 'tool', env: { TOKEN: '${API_TOKEN}' } }, () => startup)
    const first = catalog.runtime.reconcile()
    await vi.waitFor(() => expect(mounts).toHaveLength(1))
    rotateCredential()
    for (let i = 0; i < 3; i++) events.get('credentials/reference-updated')?.('API_TOKEN')
    await new Promise(resolve => setTimeout(resolve, 180))
    finishStartup()
    await first
    expect(mounts).toHaveLength(2)
    expect(mounts[0]).toMatchObject({ disposed: true, config: { env: { TOKEN: 'first-secret' } } })
    expect(mounts[1]).toMatchObject({ disposed: false, config: { env: { TOKEN: 'second-secret' } } })
  })

  it('stops credential events and waits for an in-flight mount before completing release', async () => {
    let finishStartup!: () => void
    const startup = new Promise<void>(resolve => {
      finishStartup = resolve
    })
    const { catalog, mounts, events, commands } = await setup(
      { type: 'stdio', command: 'tool' },
      () => startup,
      async () => {},
      true
    )
    const first = catalog.runtime.reconcile()
    await vi.waitFor(() => expect(mounts).toHaveLength(1))
    events.get('credentials/reference-updated')?.('API_TOKEN')
    let released = false
    await vi.waitFor(() => expect(commands.has('review')).toBe(true))
    const release = catalog.runtime.dispose().then(() => {
      released = true
    })
    try {
      await vi.waitFor(() => expect(commands.size).toBe(0))
      expect(released).toBe(false)
      expect(events.size).toBe(0)
    } finally {
      finishStartup()
    }
    await Promise.all([first, release])
    expect(mounts).toHaveLength(1)
    expect(mounts[0]!.disposed).toBe(true)
    await catalog.runtime.reconcile()
    expect(mounts).toHaveLength(1)
  })
})
