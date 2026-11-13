import type { ReconnectConfig } from './connection.js'
import type { McpServerPolicy } from '../../model/types.js'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.js'
export { RECONNECT_DEFAULTS } from './connection.js'

export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

export interface OAuthStorageConfig {
  callbackPort?: number
}

export interface OAuthConfig {
  enabled?: boolean

  scope?: string

  storage?: OAuthStorageConfig
}

export interface StdioConfig extends McpServerPolicy {
  transport: 'stdio'

  serverName: string

  command: string

  args: string[]

  env: Record<string, string>

  cwd: string

  toolCallTimeoutMs: number

  failOnStartupError: boolean

  reconnect?: ReconnectConfig
}

export interface StreamableHttpConfig extends McpServerPolicy {
  fetch?: typeof fetch

  transport: 'streamable-http'

  serverName: string

  url: string

  headers: Record<string, string>

  auth?: OAuthConfig

  toolCallTimeoutMs: number

  failOnStartupError: boolean

  reconnect?: ReconnectConfig
}

export interface SseConfig extends McpServerPolicy {
  transport: 'sse'

  serverName: string

  url: string

  headers: Record<string, string>

  auth?: OAuthConfig

  toolCallTimeoutMs: number

  failOnStartupError: boolean

  reconnect?: ReconnectConfig
}

export type Config = StdioConfig | StreamableHttpConfig | SseConfig

interface ConfigFields extends McpServerPolicy {
  serverName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect?: ReconnectConfig
}

export function validateConfig(config: Config): Config {
  const fields = config as ConfigFields
  for (const field of ['enabledTools', 'disabledTools'] as const) {
    if (fields[field] !== undefined && (!Array.isArray(fields[field]) || !fields[field]!.every(name => typeof name === 'string')))
      throw new Error(`bridge config ${field} must be an array of strings`)
  }
  if (fields.startupTimeoutMs !== undefined && (!Number.isFinite(fields.startupTimeoutMs) || fields.startupTimeoutMs <= 0 || fields.startupTimeoutMs > 2_147_483_647))
    throw new Error('bridge config startupTimeoutMs must be a positive finite timeout within the timer range')
  if (!SERVER_NAME_PATTERN.test(config.serverName)) {
    throw new Error(`bridge config serverName "${config.serverName}" must match ${String(SERVER_NAME_PATTERN)}`)
  }
  if (!Number.isFinite(fields.toolCallTimeoutMs) || fields.toolCallTimeoutMs <= 0) {
    throw new Error(`bridge config toolCallTimeoutMs must be a positive finite number`)
  }
  if (typeof fields.failOnStartupError !== 'boolean') {
    throw new Error('bridge config failOnStartupError must be a boolean')
  }
  if (config.transport === 'stdio' && (typeof config.command !== 'string' || config.command === '')) {
    throw new Error('bridge stdio config requires a command')
  }
  if (config.transport !== 'stdio' && (typeof config.url !== 'string' || config.url === '')) {
    throw new Error(`bridge ${config.transport} config requires a url`)
  }
  return config
}
