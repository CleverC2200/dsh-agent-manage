/** 文件作用：读取、校验并保存用户直接配置的 LSP 服务。 */
/**
 * Direct user configuration for LSP servers: a named table of `lspServers`
 * entries stored under the plugin data root, merged at runtime alongside the
 * suites' inline declarations.
 *
 * The file lives at `${dataRoot}/lsp-servers.json` and is the single source
 * for the `direct` kind on the LSP status surface. Parsing reuses the same
 * fail-closed `lsp-spec` rules as suite declarations; a broken file degrades
 * to no direct servers plus a diagnostic, never a thrown discovery.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseLspServers } from '../catalog/lsp-spec.js'
import type { LspServerSpec } from '../model/types.js'

/** The direct LSP server configuration file path. */
/** 根据数据根目录返回直接 LSP 配置文件路径，供读写和状态层共用。 */
export function lspServersPath(dataRoot: string): string {
  return join(dataRoot, 'lsp-servers.json')
}

/** Load the user-configured LSP servers; unreadable or invalid files yield an empty table. */
/** 读取并解析用户 LSP 表；缺失视为空配置，格式错误转为诊断而非阻断套件发现。 */
export async function loadLspServers(dataRoot: string): Promise<{ servers: Record<string, LspServerSpec>; errors: string[] }> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(lspServersPath(dataRoot), 'utf8'))
  } catch (error) {
    return { servers: {}, errors: (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : [`lsp-servers.json: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  if (table === undefined || table === null || Array.isArray(table) || typeof table !== 'object') return { servers: {}, errors: ['lsp-servers.json: lspServers must be an object'] }
  const servers = parseLspServers(table, errors)
  return { servers, errors: errors.map(error => `lsp-servers.json: ${error}`) }
}

/** Validate and persist the user-configured LSP servers; returns normalized specs. */
/** 校验并保存用户 LSP 配置，返回规范化后的服务表供后续挂载。 */
export async function saveLspServers(dataRoot: string, raw: unknown): Promise<{ servers: Record<string, LspServerSpec> }> {
  const errors: string[] = []
  const table = (raw as Record<string, unknown> | null)?.['lspServers']
  const servers = parseLspServers(table, errors)
  if (errors.length > 0) {
    throw new Error(`invalid lspServers: ${errors[0]}`)
  }
  const path = lspServersPath(dataRoot)
  await mkdir(dirname(path), { recursive: true })
  const persisted = Object.fromEntries(Object.entries(servers).map(([name, { key: _key, ...config }]) => [name, config]))
  await writeFile(path, `${JSON.stringify({ lspServers: persisted }, null, 2)}\n`, { mode: 0o600 })
  return { servers }
}
