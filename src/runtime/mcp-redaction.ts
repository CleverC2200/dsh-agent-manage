/** 文件作用：在状态、日志和编辑回显边界脱敏 MCP 敏感配置。 */
/** Redact secret-shaped MCP configuration before it crosses a status/detail boundary. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */

/**
 * Secret-shaped key matcher. This is a heuristic, not a security boundary: it
 * exists so a token cannot leak into a status response, a detail preview, or a
 * log line. Placeholder-bearing values (`${NAME}`) are always preserved because
 * they name a credential reference rather than carry one.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const SENSITIVE_KEY =
  /(authorization|auth|bearer|token|secret|password|passwd|credential|api[-_]?key|access[-_]?key|private[-_]?key|session|cookie|signature|sig\b|^key$|[-_]key$)/i

/**
 * Structure keys that merely *name* an auth block (`auth`, and containers like
 * `headers` handled below) rather than carry a secret: redacting the whole
 * block would erase the OAuth opt-in flag before it reaches the mount, so the
 * walk descends into it and the per-value checks apply instead.
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
const STRUCTURE_KEY = /^auth$/i

const PLACEHOLDER = /\$\{[^}]+\}/g

/** 递归脱敏单份 MCP 配置，保留占位符以便编辑后恢复原凭据。 */
export function redactMcpConfig(value: unknown): unknown {
  return redactValue(value)
}

/** 递归脱敏覆盖配置集合，输出仍保持按服务器分组的对象形状。 */
export function redactMcpOverrides(value: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return redactValue(value) as Record<string, Record<string, unknown>>
}

/** Whether one map key is treated as secret-shaped. */
/** 判断键名是否具有凭据语义，供配置、参数和 URL 脱敏共用。 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

/** Redact credential-bearing query values from an endpoint URL. */
/** 仅遮蔽 URL 查询参数中的敏感值，保留可诊断的主机和非敏感参数。 */
export function redactUrl(raw: string): string {
  const text = raw.trim()
  if (text === '') return text
  const [base, query = ''] = splitOnce(text, '?')
  if (query === '') return text
  const safeQuery = query
    .split('&')
    .filter(part => part !== '')
    .map(part => {
      const [name = '', value = ''] = splitOnce(part, '=')
      if (PLACEHOLDER.test(value)) return `${name}=${value}`
      return isSensitiveKey(name) ? `${name}=[redacted]` : `${name}=${value}`
    })
    .join('&')
  return safeQuery === '' ? base : `${base}?${safeQuery}`
}

/** 按首次分隔符拆分字符串，供 URL 和命令参数解析使用。 */
function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator)
  if (index === -1) return [value, '']
  return [value.slice(0, index), value.slice(index + 1)]
}

/** 处理命令参数中的 `--token value` 与 `--token=value` 两种敏感形态。 */
function redactArgs(values: unknown[]): unknown[] {
  let redactNext = false
  return values.map(value => {
    if (redactNext) {
      redactNext = false
      return '[redacted]'
    }
    if (typeof value !== 'string') return value
    const equals = value.indexOf('=')
    const flag = (equals === -1 ? value : value.slice(0, equals)).replace(/^-+/, '')
    if (!isSensitiveKey(flag)) return value
    if (equals === -1) {
      redactNext = true
      return value
    }
    return `${value.slice(0, equals + 1)}[redacted]`
  })
}

/** 递归遍历对象、数组和标量，并按父键语义执行最小必要脱敏。 */
function redactValue(value: unknown, key = ''): unknown {
  if (STRUCTURE_KEY.test(key) && typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  if (isSensitiveKey(key)) {
    if (typeof value === 'string' && PLACEHOLDER.test(value)) return value.replace(PLACEHOLDER, match => match)
    return '[redacted]'
  }
  if (key === 'url' && typeof value === 'string') return redactUrl(value)
  if (key === 'args' && Array.isArray(value)) return redactArgs(value)
  if (Array.isArray(value)) return value.map(item => redactValue(item))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]))
  }
  return value
}
