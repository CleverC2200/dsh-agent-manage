import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { applyOverride, loadSuiteOverrides, suiteOverridePath } from '../src/runtime/mcp-overrides.js'
import { restoreRedactedConfig } from '../src/runtime/server-config.js'
import { loadLspServers } from '../src/runtime/lsp-direct-config.js'

const roots: string[] = []
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'server-config-'))
  roots.push(root)
  const catalog = new Catalog({ userRoot: root, dataRoot: root, onChanged: () => {} })
  await catalog.load()
  return { root, catalog }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('service configuration editing', () => {
  it('creates LSP servers independently, rejects duplicates and preserves corrupt existing data', async () => {
    const { root, catalog } = await setup()
    await catalog.runtime.addLspServer('one', { command: 'one', extensionToLanguage: { '.one': 'one' } })
    await catalog.runtime.addLspServer('two', { command: 'two', extensionToLanguage: { '.two': 'two' } })
    expect(Object.keys((await loadLspServers(root)).servers)).toEqual(['one', 'two'])
    await expect(catalog.runtime.addLspServer('one', { command: 'new', extensionToLanguage: { '.one': 'one' } })).rejects.toThrow('already exists')
    const path = join(root, 'lsp-servers.json')
    await writeFile(path, 'corrupt')
    await expect(catalog.runtime.addLspServer('three', { command: 'three', extensionToLanguage: { '.three': 'three' } })).rejects.toThrow('lsp-servers.json')
    expect(await readFile(path, 'utf8')).toBe('corrupt')
  })
  it('persists plugin LSP edits outside the checkout and projects them into runtime discovery', async () => {
    const { root, catalog } = await setup()
    const checkout = join(root, '.sources', 'demo')
    await mkdir(checkout, { recursive: true })
    await cp(new URL('./fixtures/cc-marketplace/', import.meta.url), checkout, { recursive: true })
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    await catalog.install('demo', 'typescript-lsp')
    const manifest = join(checkout, '.claude-plugin', 'marketplace.json')
    const before = await readFile(manifest, 'utf8')
    const id = 'demo/typescript-lsp/typescript'
    const detail = await catalog.runtime.serverConfig('lsp', id)
    await catalog.runtime.saveServerConfig('lsp', id, { ...detail.config, command: 'replacement' })
    expect((await catalog.runtime.serverConfig('lsp', id)).config.command).toBe('replacement')
    expect((await catalog.enabledUserSuites()).find(suite => suite.id === 'typescript-lsp')!.lsp!.servers.typescript!.command).toBe('replacement')
    expect((await catalog.runtime.lspStatus()).entries.find(entry => entry.id === id)!.command).toBe('replacement')
    expect(await readFile(manifest, 'utf8')).toBe(before)
  })

  it('rejects direct plugin MCP edits and accepts only its enabled override', async () => {
    const { root, catalog } = await setup()
    const checkout = join(root, '.sources', 'demo')
    await mkdir(checkout, { recursive: true })
    await cp(new URL('./fixtures/cc-marketplace/', import.meta.url), checkout, { recursive: true })
    const mcp = join(checkout, 'skills/demo-one/.mcp.json')
    await writeFile(mcp, JSON.stringify({ mcpServers: { managed: { type: 'streamable-http', url: 'https://example.test/mcp' } } }))
    await catalog.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    await catalog.install('demo', 'demo-one')
    const detail = await catalog.runtime.serverConfig('mcp', 'plugin:demo/demo-one/managed')
    expect(detail.editable).toBe(false)
    await expect(catalog.runtime.saveServerConfig('mcp', detail.id, { ...detail.config, url: 'https://attacker.test/' })).rejects.toThrow('PLUGIN_MCP_EDIT_FORBIDDEN')
    await expect(catalog.runtime.setMcpOverride('demo', 'demo-one', 'managed', { url: 'https://attacker.test/' })).rejects.toThrow('PLUGIN_MCP_EDIT_FORBIDDEN')
    await catalog.runtime.setMcpOverride('demo', 'demo-one', 'managed', { enabled: false })
    expect((await loadSuiteOverrides(root, 'demo/demo-one')).managed).toMatchObject({ enabled: false })
  })

  it('roundtrips masked MCP secrets and replaces transport with validated configuration', async () => {
    const { root, catalog } = await setup()
    await catalog.runtime.addMcpServer('demo', { type: 'streamable-http', url: 'https://example.test/mcp', headers: { Authorization: 'Bearer private' } })
    const id = 'plugin:@user-mcp/user-mcp/demo'
    const detail = await catalog.runtime.serverConfig('mcp', id)
    expect(detail.config.headers).toEqual({ Authorization: '[redacted]' })
    await catalog.runtime.saveServerConfig('mcp', id, { ...detail.config, url: 'https://example.test/new' })
    const overrides = await loadSuiteOverrides(root, '@user-mcp/user-mcp')
    expect(overrides.demo?.config).toMatchObject({ headers: { Authorization: 'Bearer private' } })
    const path = suiteOverridePath(root, '@user-mcp/user-mcp')
    const before = await readFile(path, 'utf8')
    await expect(catalog.runtime.saveServerConfig('mcp', id, { type: 'stdio', command: 123 })).rejects.toThrow('invalid MCP')
    expect(await readFile(path, 'utf8')).toBe(before)
    await catalog.runtime.saveServerConfig('mcp', id, { type: 'stdio', command: 'node', args: ['--version'], env: {} })
    const replacement = (await loadSuiteOverrides(root, '@user-mcp/user-mcp')).demo
    expect(applyOverride({ type: 'streamable-http', url: 'https://example.test' }, replacement)).toEqual({ type: 'stdio', command: 'node', args: ['--version'], env: {} })
  })

  it('saves complete direct LSP config without parser identity, preserves nested secrets and rejects malformed edits', async () => {
    const { root, catalog } = await setup()
    await catalog.runtime.setLspServers({
      lspServers: { demo: { command: 'old', extensionToLanguage: { '.ts': 'typescript' }, configuration: { apiKey: 'secret', deep: [1, true] } } }
    })
    const detail = await catalog.runtime.serverConfig('lsp', 'direct/demo')
    expect(detail.config.configuration).toEqual({ apiKey: '[redacted]', deep: [1, true] })
    await catalog.runtime.saveServerConfig('lsp', 'direct/demo', { ...detail.config, command: 'new' })
    expect((await loadLspServers(root)).servers.demo).toMatchObject({ command: 'new', configuration: { apiKey: 'secret', deep: [1, true] } })
    const before = await readFile(join(root, 'lsp-servers.json'), 'utf8')
    await expect(catalog.runtime.saveServerConfig('lsp', 'direct/demo', { command: 'broken', extensionToLanguage: {} })).rejects.toThrow('invalid LSP')
    expect(await readFile(join(root, 'lsp-servers.json'), 'utf8')).toBe(before)
  })

  it('rejects newly introduced masks and preserves redacted args and URL exactly', () => {
    expect(() => restoreRedactedConfig({ env: { API_KEY: '[redacted]' } }, {})).toThrow('masked values')
    const original = { args: ['--token', 'secret'], url: 'https://example.test?token=secret' }
    expect(restoreRedactedConfig({ args: ['--token', '[redacted]'], url: 'https://example.test?token=[redacted]' }, original)).toEqual(original)
  })
})

it('preserves user MCP extension fields and separate absolute process configuration across edits', async () => {
  const { root, catalog } = await setup()
  await catalog.runtime.addMcpServer('personal', { type: 'stdio', command: process.execPath, args: ['argument with spaces'], cwd: root, env: { TOKEN: 'private' }, custom: { nested: [true, 2] } })
  const id = 'plugin:@user-mcp/user-mcp/personal'
  const detail = await catalog.runtime.serverConfig('mcp', id)
  expect(detail.config).toMatchObject({ command: process.execPath, args: ['argument with spaces'], cwd: root, env: { TOKEN: '[redacted]' }, custom: { nested: [true, 2] } })
  await catalog.runtime.saveServerConfig('mcp', id, { ...detail.config, args: ['new argument'] })
  expect((await catalog.runtime.serverConfig('mcp', id)).config).toMatchObject({ args: ['new argument'], custom: { nested: [true, 2] } })
})
