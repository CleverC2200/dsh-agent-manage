import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isSensitiveKey } from './mcp-redaction.js'
import type { McpServerSse, McpServerStreamableHttp, McpServerStdio } from '../model/types.js'

import { USER_MCP_SOURCE, USER_MCP_SUITE } from './mcp-direct-config.js'

type McpServerHttp = McpServerStreamableHttp | McpServerSse

export type McpServerOverride = {
  config?: McpServerStdio | McpServerHttp

  enabled?: boolean

  url?: string

  headers?: Record<string, string>

  env?: Record<string, string>

  args?: string[]

  auth?: { enabled: boolean; scope?: string }
}

export type McpSuiteOverrides = Record<string, McpServerOverride>

export function effectiveSuiteOverrides(suiteId: string, stored: McpSuiteOverrides): McpSuiteOverrides {
  if (suiteId === `${USER_MCP_SOURCE}/${USER_MCP_SUITE}`) return stored
  return Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, value.enabled === undefined ? {} : { enabled: value.enabled }]))
}

export function overridesDir(dataRoot: string): string {
  return join(dataRoot, 'overrides')
}

export function suiteOverridePath(dataRoot: string, suiteId: string): string {
  return join(overridesDir(dataRoot), `${sanitizeFileName(suiteId)}.json`)
}

export async function loadSuiteOverrides(dataRoot: string, suiteId: string): Promise<McpSuiteOverrides> {
  try {
    const raw: unknown = JSON.parse(await readFile(suiteOverridePath(dataRoot, suiteId), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const parsed = sanitizeOverrides(raw)
    return parsed
  } catch {
    return {}
  }
}

export async function saveSuiteOverrides(dataRoot: string, suiteId: string, overrides: McpSuiteOverrides): Promise<void> {
  const path = suiteOverridePath(dataRoot, suiteId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 })
}

export function sanitizeOverrides(raw: unknown): McpSuiteOverrides {
  if (typeof raw !== 'object' || raw === null) return {}
  const result: McpSuiteOverrides = {}
  for (const [serverKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue
    const record = value as Record<string, unknown>
    const override: McpServerOverride = {}
    if (typeof record['config'] === 'object' && record['config'] !== null) override.config = record['config'] as McpServerStdio | McpServerHttp
    if (typeof record['enabled'] === 'boolean') override.enabled = record['enabled']
    if (typeof record['url'] === 'string' && record['url'] !== '') override.url = record['url']
    const headers = stringMap(record['headers'])
    if (headers !== undefined) override.headers = headers
    const auth = sanitizeAuth(record['auth'])
    if (auth !== undefined) override.auth = auth
    const env = stringMap(record['env'])
    if (env !== undefined) override.env = env
    if (Array.isArray(record['args']) && record['args'].every(entry => typeof entry === 'string')) {
      override.args = record['args'] as string[]
    }
    if (Object.keys(override).length > 0) result[serverKey] = override
  }
  return result
}

function sanitizeAuth(raw: unknown): { enabled: boolean; scope?: string } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const record = raw as Record<string, unknown>
  if (typeof record['enabled'] !== 'boolean') return undefined
  return {
    enabled: record['enabled'],
    ...(typeof record['scope'] === 'string' && record['scope'] !== '' ? { scope: record['scope'] } : {})
  }
}

export function sanitizeOverridePatch(patch: unknown): McpServerOverride | undefined {
  if (typeof patch === 'object' && patch !== null && 'config' in patch) return undefined
  if (containsLiteralSensitiveValue(patch)) return undefined
  return sanitizeOverrides({ server: patch })['server']
}

export function mergeOverridePatch(existing: McpServerOverride, patch: McpServerOverride): McpServerOverride {
  const headers = mergeStringMap(existing.headers, patch.headers)
  const env = mergeStringMap(existing.env, patch.env)
  return {
    ...(existing.config === undefined ? {} : { config: existing.config }),
    enabled: patch.enabled ?? existing.enabled ?? true,
    ...(patch.url !== undefined ? { url: patch.url } : existing.url === undefined ? {} : { url: existing.url }),
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
    ...(patch.args !== undefined ? { args: patch.args } : existing.args === undefined ? {} : { args: existing.args }),
    ...(patch.auth !== undefined ? { auth: patch.auth } : existing.auth === undefined ? {} : { auth: existing.auth })
  }
}

function mergeStringMap(existing: Record<string, string> | undefined, patch: Record<string, string> | undefined): Record<string, string> | undefined {
  if (existing === undefined && patch === undefined) return undefined
  const merged = { ...(existing ?? {}) }
  for (const [key, value] of Object.entries(patch ?? {})) merged[key] = value
  return Object.keys(merged).length > 0 ? merged : undefined
}

function containsLiteralSensitiveValue(value: unknown, key = ''): boolean {
  if (isSensitiveKey(key) && typeof value === 'string') return !value.includes('${')
  if (Array.isArray(value)) return value.some(item => containsLiteralSensitiveValue(item, key))
  if (typeof value === 'object' && value !== null)
    return Object.entries(value as Record<string, unknown>).some(([childKey, childValue]) => containsLiteralSensitiveValue(childValue, childKey))
  return false
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'string') continue
    result[key] = entry
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export function applyOverride(server: McpServerStdio | McpServerHttp, override: McpServerOverride | undefined): McpServerStdio | McpServerHttp {
  if (override === undefined) return server
  if (override.config !== undefined) server = override.config
  if (server.type === 'stdio') {
    return {
      ...server,
      ...(override.args !== undefined ? { args: override.args } : {}),
      ...(override.env !== undefined ? { env: override.env } : {})
    }
  }
  return {
    ...server,
    ...(override.url !== undefined ? { url: override.url } : {}),
    ...(override.headers !== undefined ? { headers: override.headers } : {}),
    ...(override.auth !== undefined ? { auth: override.auth } : {})
  }
}

function sanitizeFileName(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '_')
}
