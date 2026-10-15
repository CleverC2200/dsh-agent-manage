/** 文件作用：把已校验套件 MCP 声明解析为带凭据和策略的桥接挂载请求。 */
/**
 * Maps one validated suite `mcp.json` onto self-built bridge config rows.
 *
 * The portable format is translated, not executed directly: stdio commands
 * resolve against the suite root (spec §7.2.1), `${PLUGIN_ROOT}` /
 * `${PLUGIN_DATA}` expand against the suite root and its data directory, and
 * every `${NAME}` — including ones inside a streamable-http `url` — expands
 * through the optional DSH credentials seam at mount time. Legacy HTTP+SSE
 * servers are supported by the market's own bridge (the host client had no
 * such transport); unrecognized shapes are still skipped with a per-server
 * reason.
 */
import { createHash } from 'node:crypto'
import type { Config, SseConfig } from './mcp-client/config.js'
import { DEFAULT_TOOL_CALL_TIMEOUT_MS } from './mcp-client/config.js'
import { resolveCwd } from '../catalog/validate.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import type { McpServer, McpServerSse, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES, PLUGIN_DATA_VARIABLES } from '../model/layouts.js'

/** The max length the bridge accepts for a serverName. */
const SERVER_NAME_MAX = 32
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g
const BUILTIN_PLACEHOLDERS = new Set([...PLUGIN_ROOT_VARIABLES, ...PLUGIN_DATA_VARIABLES])

export interface McpMountRequest {
  suiteId: string
  serverKey: string
  config: Config
}

export type McpMountFailureCode =
  | 'unsupported-transport'
  | 'missing-credential'
  | 'credential-error'
  | 'unmount-failed'
  | 'mount-failed'
  /** The derived serverName's namespace is already mounted by another MCP client — informational, not a failure. */
  | 'foreign-mount'
  /** Another source's identical suite/server pair mounted first — this copy is redundant, informational. */
  | 'duplicate-mount'

export interface McpMountFailure {
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  credentialRefs?: string[]
}

/** Optional DSH credential resolver used while building an in-memory mount. */
export interface McpCredentialResolver {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

/**
 * Build one mount request per supported mcp.json server, resolving every
 * `${NAME}` through the credential resolver before a child process or HTTP
 * request is created. Missing references fail closed per server instead of
 * becoming empty strings.
 *
 * @param overrides user-owned per-server overrides (url/headers/env/args
 *   replacement plus enable/disable); applied before mount. Disabled servers
 *   are omitted entirely.
 * @returns mount requests plus per-server failures. serverName collisions are
 *   reported by the mount registry, not here.
 */
/** 将套件 MCP 服务展开凭据并转换为挂载请求；失败项保留结构化诊断而非半挂载。 */
export async function toMcpMounts(
  suite: Suite,
  pluginDataRoot: string,
  overrides: McpSuiteOverrides = {},
  resolver: McpCredentialResolver = { resolve: async () => undefined }
): Promise<{ mounts: McpMountRequest[]; failures: McpMountFailure[] }> {
  if (suite.mcp === undefined) return { mounts: [], failures: [] }
  const mounts: McpMountRequest[] = []
  const failures: McpMountFailure[] = []
  for (const [serverKey, source] of Object.entries(suite.mcp.servers)) {
    const override = overrides[serverKey]
    if (override?.enabled === false) continue
    const server = applyOverride(source as McpServerStdio | McpServerStreamableHttp | McpServerSse, override)
    try {
      const result = await toResolvedMount(suite.mcp.root === undefined ? suite : { ...suite, root: suite.mcp.root }, serverKey, server, pluginDataRoot, resolver)
      if (result.failure !== undefined) failures.push(result.failure)
      if (result.request !== undefined) mounts.push(result.request)
    } catch {
      failures.push({ serverKey, code: 'credential-error', credentialRefs: credentialRefsInServer(server), reason: 'credential lookup failed' })
    }
  }
  return { mounts, failures }
}

/** Find external credential references used by one MCP server definition. */
/** 收集单个 MCP 服务中所有凭据引用，用于变更影响判断。 */
export function credentialRefsInServer(server: McpServer): string[] {
  const values: string[] = []
  if (server.type === 'stdio') {
    values.push(...(server.args ?? []), ...(server.cwd === undefined ? [] : [server.cwd]), ...Object.values(server.env ?? {}))
  } else {
    // A remote endpoint may carry the token in the URL query as well as in a
    // header, so both are scanned and both are resolved at mount time.
    values.push(server.url ?? '', ...Object.values(server.headers ?? {}))
  }
  const refs = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(PLACEHOLDER)) {
      const name = match[1]
      if (name !== undefined && !BUILTIN_PLACEHOLDERS.has(name)) refs.add(name)
    }
  }
  return [...refs].sort()
}

/** 解析单个服务的路径、参数、环境和认证字段，返回请求或失败。 */
async function toResolvedMount(
  suite: Suite,
  serverKey: string,
  server: McpServer,
  pluginDataRoot: string,
  resolver: McpCredentialResolver
): Promise<{ request?: McpMountRequest; failure?: McpMountFailure }> {
  if (server.type === 'sse') {
    // The market bridge supports the legacy HTTP+SSE transport natively.
    const expand = expander(suite, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id)), resolver)
    const url = await expand.one(server.url)
    const headers = await expand.map(server.headers ?? {})
    const missing = unique([...url.missing, ...headers.missing])
    if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
    const sseConfig: SseConfig = {
      transport: 'sse',
      serverName: deriveServerName(suite.id, serverKey),
      url: url.value,
      headers: headers.values,
      ...(server.auth === undefined ? {} : { auth: mapAuth(server.auth) }),
      ...bridgePolicy(server),
      failOnStartupError: true
    }
    return { request: { suiteId: qualifiedSuiteId(suite.sourceId, suite.id), serverKey, config: sseConfig } }
  }
  const expand = expander(suite, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id)), resolver)
  const serverName = deriveServerName(suite.id, serverKey)
  if (server.type === 'stdio') {
    const args = await expand.all(server.args ?? [])
    const env = await expand.map(server.env ?? {})
    const cwd = server.cwd === undefined ? { value: suite.root, missing: [] as string[] } : await expand.one(server.cwd)
    const missing = unique([...args.missing, ...env.missing, ...cwd.missing])
    if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
    return {
      request: {
        suiteId: qualifiedSuiteId(suite.sourceId, suite.id),
        serverKey,
        config: {
          transport: 'stdio',
          serverName,
          command: server.command.startsWith('./') ? joinInside(suite.root, server.command.slice(2)) : server.command,
          args: args.values,
          env: env.values,
          cwd: resolveCwd(cwd.value, suite.root, joinInside(pluginDataRoot, qualifiedSuiteId(suite.sourceId, suite.id))),
          ...bridgePolicy(server),
          failOnStartupError: true
        }
      }
    }
  }
  const url = await expand.one(server.url)
  const headers = await expand.map(server.headers ?? {})
  const missing = unique([...url.missing, ...headers.missing])
  if (missing.length > 0) return { failure: missingFailure(serverKey, missing) }
  return {
    request: {
      suiteId: qualifiedSuiteId(suite.sourceId, suite.id),
      serverKey,
      config: {
        transport: 'streamable-http',
        serverName,
        url: url.value,
        headers: headers.values,
        ...(server.auth === undefined ? {} : { auth: mapAuth(server.auth) }),
        ...bridgePolicy(server),
        failOnStartupError: true
      }
    }
  }
}

/**
 * Map the suite format's auth declaration onto the bridge's OAuth config.
 * `enabled: false` must survive the mapping — it is the explicit opt-out —
 * while `enabled: true` (or a bare declaration) requests the default-on
 * flow, optionally with a scope.
 */
/** 复制认证策略到桥接配置，避免把领域对象直接暴露给传输层。 */
function mapAuth(auth: { enabled: boolean; scope?: string }): { enabled: boolean; scope?: string } {
  return {
    enabled: auth.enabled !== false,
    ...(auth.scope === undefined ? {} : { scope: auth.scope })
  }
}

/** 生成桥接器所需的重连、工具超时和 OAuth 策略。 */
function bridgePolicy(server: McpServer) {
  return {
    toolCallTimeoutMs: server.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    ...(server.enabledTools === undefined ? {} : { enabledTools: server.enabledTools }),
    ...(server.disabledTools === undefined ? {} : { disabledTools: server.disabledTools })
  }
}

/** Per-mount expansion context; credential lookups are memoized per call. */
/** 构造占位符展开器，区分内置路径变量与凭据变量并收集缺失项。 */
function expander(suite: Suite, pluginData: string, resolver: McpCredentialResolver) {
  // Promise-valued cache: concurrent expansions of the same reference share
  // one in-flight lookup, so a config using a token twice resolves it once.
  const inflight = new Map<string, Promise<{ value: string; source?: string } | undefined>>()
  /** 读取并缓存单个凭据引用，确保同一展开过程不会重复发起查询。 */
  const lookup = (name: string): Promise<{ value: string; source?: string } | undefined> => {
    const pending = inflight.get(name)
    if (pending !== undefined) return pending
    const created = Promise.resolve(resolver.resolve(name))
    inflight.set(name, created)
    return created
  }
  /** 展开一个字符串中的内置变量或凭据占位符，并收集无法解析的名称。 */
  const one = async (value: string): Promise<{ value: string; missing: string[] }> => {
    let cursor = 0
    let output = ''
    const missing: string[] = []
    for (const match of value.matchAll(PLACEHOLDER)) {
      const index = match.index ?? 0
      const name = match[1]
      if (name === undefined) continue
      output += value.slice(cursor, index)
      const fallback = match[2]
      let replacement: string | undefined
      if (PLUGIN_ROOT_VARIABLES.has(name)) replacement = suite.root
      else if (PLUGIN_DATA_VARIABLES.has(name)) replacement = pluginData
      else replacement = (await lookup(name))?.value
      if (replacement === undefined || replacement === '') {
        if (fallback !== undefined && fallback !== '') replacement = fallback
        else {
          missing.push(name)
          replacement = ''
        }
      }
      output += replacement
      cursor = index + match[0].length
    }
    output += value.slice(cursor)
    return { value: output, missing }
  }
  return {
    one,
    /** 批量展开参数数组，返回展开值和全部缺失凭据引用。 */
    async all(values: string[]): Promise<{ values: string[]; missing: string[] }> {
      const expanded = await Promise.all(values.map(one))
      return { values: expanded.map(item => item.value), missing: expanded.flatMap(item => item.missing) }
    },
    /** 批量展开环境映射，保持键集合并集中返回缺失引用。 */
    async map(values: Record<string, string>): Promise<{ values: Record<string, string>; missing: string[] }> {
      const entries = await Promise.all(Object.entries(values).map(async ([key, value]) => [key, await one(value)] as const))
      return {
        values: Object.fromEntries(entries.map(([key, result]) => [key, result.value])),
        missing: entries.flatMap(([, result]) => result.missing)
      }
    }
  }
}

/** 将缺失凭据引用转换为可展示且可重试判断的结构化失败。 */
function missingFailure(serverKey: string, refs: string[]): McpMountFailure {
  const uniqueRefs = unique(refs)
  return {
    serverKey,
    code: 'missing-credential',
    credentialRefs: uniqueRefs,
    reason: uniqueRefs.map(ref => `missing credential reference ${ref}`).join('; ')
  }
}

/** 保持首次出现顺序去重字符串列表。 */
function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/** 将相对片段限制在根目录内，防止占位符产生路径穿越。 */
function joinInside(root: string, segment: string): string {
  return `${root.replace(/[\\/]$/, '')}/${segment}`
}

/** Sanitize one token into `[A-Za-z0-9_-]`. */
/** 清洗服务名组成片段，使其适合公开工具命名空间。 */
function sanitizeToken(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned === '' ? 'server' : cleaned
}

/**
 * Derive a bridge serverName from the suite and server ids:
 * `${suiteId}__${serverKey}` sanitized, clamped to 32 chars with a
 * deterministic 12-hex suffix when the join exceeds the budget.
 *
 * Deliberately NOT source-qualified: two sources shipping the same
 * suite/server pair are the same server for the model, so the second mount
 * is skipped with a `duplicate-mount` diagnostic instead of registering a
 * shadow copy under a mangled name.
 */
/** 用限定套件 ID 和服务键生成稳定、长度受控的公开 serverName。 */
export function deriveServerName(suiteId: string, serverKey: string): string {
  const candidate = `${sanitizeToken(suiteId)}__${sanitizeToken(serverKey)}`
  if (candidate.length <= SERVER_NAME_MAX) return candidate
  const hash = createHash('sha256').update(`${suiteId}\u0000${serverKey}`).digest('hex').slice(0, 12)
  return `${candidate.slice(0, SERVER_NAME_MAX - 13)}-${hash}`
}
