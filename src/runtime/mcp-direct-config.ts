/** 文件作用：维护用户直接配置的 MCP 服务，并转换为虚拟用户 suite。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { MCP_SCHEMA_ID, USER_MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../catalog/validate.js'
import type { McpSuiteConfig, Suite } from '../model/types.js'

export const USER_MCP_SOURCE = '@user-mcp'
export const USER_MCP_SUITE = 'user-mcp'

/** User-created services reuse the owned bridge lifecycle without changing host configuration. */
/** 读取用户 MCP 文件并包装成虚拟套件；坏配置保留错误但不影响其他套件。 */
export async function loadUserMcpSuite(dataRoot: string): Promise<Suite> {
  const path = join(dataRoot, 'mcp-servers.json')
  let mcp: McpSuiteConfig = { schema: MCP_SCHEMA_ID, servers: {} }
  const errors: string[] = []
  try {
    mcp = await validateUserMcp(dataRoot, JSON.parse(await readFile(path, 'utf8')), await loadServerRoots(dataRoot))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(`mcp-servers.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  return {
    sourceId: USER_MCP_SOURCE,
    id: USER_MCP_SUITE,
    root: dataRoot,
    manifest: { layout: 'agent-plugin-v1', path, id: USER_MCP_SUITE, name: USER_MCP_SUITE },
    skills: [],
    mcp,
    surfaces: { skills: 0, mcp: Object.keys(mcp.servers).length, commands: 0, agents: 0, hooks: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    installedAt: 'user',
    errors
  }
}

/** 先过 JSON Schema，再复用 MCP 目录校验器，确保用户配置失败关闭。 */
async function validateUserMcp(dataRoot: string, raw: unknown, roots: Record<string, string> = {}): Promise<McpSuiteConfig> {
  const errors = await validateAgainstSchema(USER_MCP_SCHEMA_ID, raw)
  if (errors.length > 0) throw new Error(`invalid MCP configuration: ${errors.join('; ')}`)
  const document = raw as { mcpServers: Record<string, unknown> }
  const servers: McpSuiteConfig['servers'] = {}
  for (const [key, config] of Object.entries(document.mcpServers)) {
    const result = await validateMcpJson(roots[key] ?? dataRoot, { $schema: MCP_SCHEMA_ID, mcpServers: { [key]: config } }, { strict: false, pathMode: 'project' })
    if (result.config === undefined || result.errors.length > 0) throw new Error(result.errors.join('; '))
    Object.assign(servers, result.config.servers)
  }
  return { schema: MCP_SCHEMA_ID, servers, serverRoots: roots }
}

/** Add one service atomically; reject collisions and malformed config before writing. */
/** 校验新增服务并原子写入用户 MCP 文件，拒绝非法名称和重复键。 */
export async function addUserMcpServer(dataRoot: string, name: string, server: unknown, sourceRoot?: string): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error('invalid MCP server name')
  const suite = await loadUserMcpSuite(dataRoot)
  if (suite.errors.length > 0) throw new Error(suite.errors.join('; '))
  if (Object.hasOwn(suite.mcp!.servers, name)) throw new Error(`MCP server "${name}" already exists`)
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { ...suite.mcp!.servers, [name]: server } }
  const roots = { ...suite.mcp?.serverRoots }
  if (sourceRoot) roots[name] = sourceRoot
  else delete roots[name]
  await validateUserMcp(dataRoot, document, roots)
  await mkdir(dataRoot, { recursive: true })
  if (sourceRoot || suite.mcp?.serverRoots?.[name]) {
    const rootsFile = join(dataRoot, 'mcp-server-roots.json')
    await writeFile(`${rootsFile}.tmp`, JSON.stringify(roots), { mode: 0o600 })
    await rename(`${rootsFile}.tmp`, rootsFile)
  }
  const path = join(dataRoot, 'mcp-servers.json')
  await writeFile(`${path}.tmp`, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

/** Roots come only from Host import resolution, outside editable server configuration. */
async function loadServerRoots(dataRoot: string): Promise<Record<string, string>> {
  try {
    return z.record(z.string(), z.string().min(1)).parse(JSON.parse(await readFile(join(dataRoot, 'mcp-server-roots.json'), 'utf8')))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    throw error
  }
}
