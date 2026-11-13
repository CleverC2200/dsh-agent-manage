import { createHash } from 'node:crypto'
import type { Config, SseConfig } from './mcp-client/config.js'
import { DEFAULT_TOOL_CALL_TIMEOUT_MS } from './mcp-client/config.js'
import { resolveCwd } from '../catalog/validate.js'
import { qualifiedSuiteId } from '../catalog/paths.js'
import { applyOverride, type McpSuiteOverrides } from './mcp-overrides.js'
import type { McpServer, McpServerSse, McpServerStdio, McpServerStreamableHttp, Suite } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES, PLUGIN_DATA_VARIABLES } from '../model/layouts.js'

const SERVER_NAME_MAX = 32
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g
const BUILTIN_PLACEHOLDERS = new Set([...PLUGIN_ROOT_VARIABLES, ...PLUGIN_DATA_VARIABLES])

export interface McpMountRequest {
  suiteId: string
  serverKey: string
  config: Config
}

export type McpMountFailureCode = 'unsupported-transport' | 'missing-credential' | 'credential-error' | 'unmount-failed' | 'mount-failed' | 'foreign-mount' | 'duplicate-mount'

export interface McpMountFailure {
  serverKey: string
  reason: string
  code?: McpMountFailureCode
  credentialRefs?: string[]
}

export interface McpCredentialResolver {
  resolve(ref: string): Promise<{ value: string; source?: string } | undefined>
}

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
      const root = suite.mcp.serverRoots?.[serverKey] ?? suite.mcp.root ?? suite.root
      const result = await toResolvedMount({ ...suite, root }, serverKey, server, pluginDataRoot, resolver)
      if (result.failure !== undefined) failures.push(result.failure)
      if (result.request !== undefined) mounts.push(result.request)
    } catch {
      failures.push({ serverKey, code: 'credential-error', credentialRefs: credentialRefsInServer(server), reason: 'credential lookup failed' })
    }
  }
  return { mounts, failures }
}

export function credentialRefsInServer(server: McpServer): string[] {
  const values: string[] = []
  if (server.type === 'stdio') {
    values.push(...(server.args ?? []), ...(server.cwd === undefined ? [] : [server.cwd]), ...Object.values(server.env ?? {}))
  } else {
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

async function toResolvedMount(
  suite: Suite,
  serverKey: string,
  server: McpServer,
  pluginDataRoot: string,
  resolver: McpCredentialResolver
): Promise<{ request?: McpMountRequest; failure?: McpMountFailure }> {
  if (server.type === 'sse') {
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

function mapAuth(auth: { enabled: boolean; scope?: string }): { enabled: boolean; scope?: string } {
  return {
    enabled: auth.enabled !== false,
    ...(auth.scope === undefined ? {} : { scope: auth.scope })
  }
}

function bridgePolicy(server: McpServer) {
  return {
    toolCallTimeoutMs: server.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS,
    ...(server.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: server.startupTimeoutMs }),
    ...(server.enabledTools === undefined ? {} : { enabledTools: server.enabledTools }),
    ...(server.disabledTools === undefined ? {} : { disabledTools: server.disabledTools })
  }
}

function expander(suite: Suite, pluginData: string, resolver: McpCredentialResolver) {
  const inflight = new Map<string, Promise<{ value: string; source?: string } | undefined>>()

  const lookup = (name: string): Promise<{ value: string; source?: string } | undefined> => {
    const pending = inflight.get(name)
    if (pending !== undefined) return pending
    const created = Promise.resolve(resolver.resolve(name))
    inflight.set(name, created)
    return created
  }

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

    async all(values: string[]): Promise<{ values: string[]; missing: string[] }> {
      const expanded = await Promise.all(values.map(one))
      return { values: expanded.map(item => item.value), missing: expanded.flatMap(item => item.missing) }
    },

    async map(values: Record<string, string>): Promise<{ values: Record<string, string>; missing: string[] }> {
      const entries = await Promise.all(Object.entries(values).map(async ([key, value]) => [key, await one(value)] as const))
      return {
        values: Object.fromEntries(entries.map(([key, result]) => [key, result.value])),
        missing: entries.flatMap(([, result]) => result.missing)
      }
    }
  }
}

function missingFailure(serverKey: string, refs: string[]): McpMountFailure {
  const uniqueRefs = unique(refs)
  return {
    serverKey,
    code: 'missing-credential',
    credentialRefs: uniqueRefs,
    reason: uniqueRefs.map(ref => `missing credential reference ${ref}`).join('; ')
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function joinInside(root: string, segment: string): string {
  return `${root.replace(/[\\/]$/, '')}/${segment}`
}

function sanitizeToken(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned === '' ? 'server' : cleaned
}

export function deriveServerName(suiteId: string, serverKey: string): string {
  const candidate = `${sanitizeToken(suiteId)}__${sanitizeToken(serverKey)}`
  if (candidate.length <= SERVER_NAME_MAX) return candidate
  const hash = createHash('sha256').update(`${suiteId}\u0000${serverKey}`).digest('hex').slice(0, 12)
  return `${candidate.slice(0, SERVER_NAME_MAX - 13)}-${hash}`
}
