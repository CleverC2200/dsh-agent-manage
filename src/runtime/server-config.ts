/** 文件作用：校验、保存和合并单个 MCP/LSP 服务的用户覆盖配置。 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MCP_SCHEMA_ID, validateAgainstSchema, validateMcpJson } from '../catalog/validate.js'
import { parseLspServers } from '../catalog/lsp-spec.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { redactMcpConfig } from './mcp-redaction.js'
import type { LspServerSpec, Suite } from '../model/types.js'

/** Restore only unchanged redacted leaves, rejecting invented masked values. */
/** 将编辑回显中的原样脱敏叶恢复为原值，拒绝伪造或改写的掩码内容。 */
export function restoreRedactedConfig(input: unknown, original: unknown, redacted = redactMcpConfig(original)): unknown {
  if (typeof input === 'string' && input.includes('[redacted]')) {
    if (input !== redacted) throw new Error('masked values must remain unchanged or be replaced')
    return original
  }
  if (Array.isArray(input))
    return input.map((value, index) => restoreRedactedConfig(value, Array.isArray(original) ? original[index] : undefined, Array.isArray(redacted) ? redacted[index] : undefined))
  if (typeof input === 'object' && input !== null) {
    const source = typeof original === 'object' && original !== null ? (original as Record<string, unknown>) : {}
    const safe = typeof redacted === 'object' && redacted !== null ? (redacted as Record<string, unknown>) : {}
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, restoreRedactedConfig(value, source[key], safe[key])]))
  }
  return input
}

/** 用统一 Schema 和运行时解析器校验单个 MCP 服务，返回可挂载的规范配置。 */
export async function validateServerMcp(root: string, key: string, config: unknown) {
  const document = { $schema: MCP_SCHEMA_ID, mcpServers: { [key]: config } }
  const errors = await validateAgainstSchema(MCP_SCHEMA_ID, document)
  if (errors.length > 0) throw new Error(`invalid MCP configuration: ${errors.join('; ')}`)
  const result = await validateMcpJson(root, document)
  const server = result.config?.servers[key]
  if (server === undefined || result.errors.length > 0) throw new Error(`invalid MCP configuration: ${result.errors.join('; ')}`)
  if (server.type !== 'stdio' && !server.url.includes('${')) {
    const url = new URL(server.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw Error('INVALID_MCP_URL')
  }
  return server
}

/** 校验单个 LSP 服务并返回带派生 key 的规范声明，非法输入直接失败关闭。 */
export function validateServerLsp(key: string, config: unknown): LspServerSpec {
  const errors: string[] = []
  const server = parseLspServers({ [key]: config }, errors)[key]
  if (server === undefined || errors.length > 0) throw new Error(`invalid LSP configuration: ${errors.join('; ')}`)
  return server
}

/** Public configuration excludes the parser's derived identity. */
/** 移除内部 key 后生成可持久化、可编辑的公开配置。 */
export function lspConfig(spec: LspServerSpec): Record<string, unknown> {
  return Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'key'))
}

/** 读取并校验 LSP 覆盖表；缺失为空表，其他错误交给调用方呈现。 */
export async function loadLspOverrides(root: string): Promise<Record<string, LspServerSpec>> {
  try {
    const raw = JSON.parse(await readFile(join(root, 'lsp-overrides.json'), 'utf8')) as Record<string, unknown>
    return Object.fromEntries(Object.entries(raw).map(([id, config]) => [id, validateServerLsp(id.slice(id.lastIndexOf('/') + 1), config)]))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

/** 更新单个覆盖项并原子写回，保持其他套件的覆盖不变。 */
export async function saveLspOverride(root: string, id: string, config: LspServerSpec): Promise<void> {
  const overrides = await loadLspOverrides(root)
  overrides[id] = config
  await mkdir(root, { recursive: true })
  const path = join(root, 'lsp-overrides.json')
  await writeFile(`${path}.tmp`, JSON.stringify(Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, lspConfig(value)])), null, 2), { mode: 0o600 })
  await rename(`${path}.tmp`, path)
}

/** 将按限定套件 ID 存储的覆盖应用到快照，返回不改变原对象的套件数组。 */
export async function applyLspOverrides(root: string, suites: Suite[]): Promise<Suite[]> {
  const overrides = await loadLspOverrides(root)
  return suites.map(suite =>
    suite.lsp === undefined
      ? suite
      : {
          ...suite,
          lsp: {
            ...suite.lsp,
            servers: Object.fromEntries(Object.entries(suite.lsp.servers).map(([key, spec]) => [key, overrides[`${qualifiedSuiteId(suite.sourceId, suite.id)}/${key}`] ?? spec]))
          }
        }
  )
}
