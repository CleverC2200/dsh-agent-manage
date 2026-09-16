/** 文件作用：定义 MCP/LSP 配置表单的类型、JSON 解析、传输切换和兼容性校验规则。 */
export type ServerKind = 'mcp' | 'lsp'
export type ServerConfig = Record<string, unknown>

/** 将编辑器文本解析为 JSON 对象，并拒绝 null、数组和标量根值。 */
export function parseServerConfig(text: string): ServerConfig {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object')
  return value as ServerConfig
}

/** Switching transport removes only transport-specific fields; all unrelated keys survive edits. */
/** 切换 MCP 传输时删除互斥字段，保留所有与传输无关的配置。 */
export function changeTransport(config: ServerConfig, type: string): ServerConfig {
  const next: ServerConfig = { ...config, type }
  if (type === 'stdio') {
    delete next['url']
    delete next['headers']
    delete next['auth']
  } else {
    delete next['command']
    delete next['args']
    delete next['env']
    delete next['cwd']
  }
  return next
}

/** 判断配置是否能安全映射到结构化表单；复杂或未知结构留给 JSON 模式编辑。 */
export function serverFormCompatible(config: ServerConfig, kind: ServerKind): boolean {
  /** 判断可选的键值字段是否为表单能够安全编辑的字符串映射。 */
  const isMap = (value: unknown): boolean =>
    // 表单键值映射只接受字符串值；缺失字段视为合法可选项。
    value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(v => typeof v === 'string'))
  if (!['command', 'url', 'cwd'].every(key => config[key] === undefined || typeof config[key] === 'string')) return false
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some(value => typeof value !== 'string'))) return false
  if (!isMap(config.env) || !isMap(config.headers) || !isMap(config.extensionToLanguage)) return false
  if (kind === 'mcp' && config.type !== undefined && !['stdio', 'streamable-http', 'sse'].includes(String(config.type))) return false
  if (config.auth !== undefined && (config.auth === null || typeof config.auth !== 'object' || Array.isArray(config.auth))) return false
  const auth = config.auth as Record<string, unknown> | undefined
  if (auth?.enabled !== undefined && typeof auth.enabled !== 'boolean') return false
  if (auth?.scope !== undefined && typeof auth.scope !== 'string') return false
  return true
}
