import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020Default from 'ajv/dist/2020.js'
import type { McpServer, McpSuiteConfig } from '../model/types.js'
import { PLUGIN_ROOT_VARIABLES, PLUGIN_DATA_VARIABLES } from '../model/layouts.js'

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas', '1.0.0')

interface Ajv2020Like {
  addSchema(schema: unknown): unknown

  getSchema(id: string): { (document: unknown): unknown; errors?: Array<{ instancePath?: string; message?: string }> } | undefined
}

const Ajv2020Class = Ajv2020Default as unknown as { new (options?: Record<string, unknown>): Ajv2020Like }

export const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
export const USER_MCP_SCHEMA_ID = 'urn:dsh-agent-manage:user-mcp'
export const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'

let ajvPromise: Promise<Ajv2020Like> | undefined

async function ajv(): Promise<Ajv2020Like> {
  ajvPromise ??= (async () => {
    const instance = new Ajv2020Class({ strict: false })
    for (const name of ['plugin.schema.json', 'mcp.schema.json'] as const) {
      const schemaText = await readFile(join(SCHEMAS_DIR, name), 'utf8')
      const schema = JSON.parse(schemaText)
      instance.addSchema(schema)
      if (name === 'mcp.schema.json') {
        const userSchema = structuredClone(schema)
        userSchema.$id = USER_MCP_SCHEMA_ID
        for (const kind of ['stdioServer', 'streamableHttpServer', 'sseServer', 'oauth']) userSchema.$defs[kind].additionalProperties = true
        delete userSchema.$defs.stdioServer.properties.cwd.pattern
        instance.addSchema(userSchema)
      }
    }
    return instance
  })()
  return ajvPromise
}

export async function validateAgainstSchema(schemaId: string, document: unknown): Promise<string[]> {
  const instance = await ajv()
  const validate = instance.getSchema(schemaId)
  if (validate === undefined) return [`no bundled validator for ${schemaId}`]
  validate(document)
  return (validate.errors ?? []).map(error => `${error.instancePath === '' ? 'root' : error.instancePath} ${error.message ?? 'invalid'}`)
}

export function isRecognizedSchema(value: unknown): boolean {
  return value === PLUGIN_SCHEMA_ID || value === MCP_SCHEMA_ID
}

export async function pathContainmentError(pluginRoot: string, value: string): Promise<string | undefined> {
  const raw = value.replace(/^\$\{([A-Z_]+)\}(\/|$)/, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
  if (!raw.startsWith('./')) return `path "${value}" must begin with "./" (or ${'${PLUGIN_ROOT}'})`
  const candidate = resolve(pluginRoot, raw.slice(2))
  let rootResolved: string
  try {
    rootResolved = await realpath(pluginRoot)
  } catch {
    rootResolved = resolve(pluginRoot)
  }
  const rootPrefix = rootResolved.endsWith(sep) ? rootResolved : `${rootResolved}${sep}`
  let candidateResolved: string
  try {
    candidateResolved = await realpath(candidate)
  } catch {
    candidateResolved = candidate
  }
  if (candidateResolved !== rootResolved && !candidateResolved.startsWith(rootPrefix)) {
    return `path "${value}" resolves outside the plugin root`
  }
  return undefined
}

export async function validatePluginManifest(raw: unknown): Promise<string[]> {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) return ['manifest is not a JSON object']
  const record = raw as Record<string, unknown>
  if (!isRecognizedSchema(record['$schema'])) {
    errors.push(`unrecognized $schema ${JSON.stringify(record['$schema'])}; this manager supports agent-plugins 1.0.0 only`)
  }
  errors.push(...(await validateAgainstSchema(PLUGIN_SCHEMA_ID, raw)))
  return errors
}

const KNOWN_MCP_TRANSPORTS = new Set(['stdio', 'streamable-http', 'sse'])

export interface McpValidateOptions {
  pathMode?: 'plugin' | 'project'

  strict?: boolean
}

export async function validateMcpJson(pluginRoot: string, raw: unknown, options?: McpValidateOptions): Promise<{ config?: McpSuiteConfig; errors: string[] }> {
  if (typeof raw !== 'object' || raw === null) return { errors: ['mcp.json is not a JSON object'] }
  const record = raw as Record<string, unknown>
  const errors: string[] = []
  const strict = options?.strict !== false
  if (strict) {
    if (!isRecognizedSchema(record['$schema'])) {
      return { errors: [`unrecognized mcp.json $schema ${JSON.stringify(record['$schema'])}; this manager supports agent-plugins 1.0.0 only`] }
    }
    const schemaErrors = await validateAgainstSchema(MCP_SCHEMA_ID, raw)
    if (schemaErrors.length > 0) return { errors: schemaErrors }
  }

  let servers = record['mcpServers']
  if (typeof servers !== 'object' || servers === null) {
    if (strict || record['$schema'] !== undefined || !Object.values(record).every(value => typeof value === 'object' && value !== null)) {
      return { errors: ['mcp.json is missing mcpServers'] }
    }
    servers = record
  }
  const valid: Record<string, McpServer> = Object.create(null) as Record<string, McpServer>
  for (const [name, value] of Object.entries(servers as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) {
      errors.push(`server "${name}": not an object`)
      continue
    }
    const server = value as { type?: unknown; command?: unknown; cwd?: unknown }

    let type = typeof server.type === 'string' ? server.type : server.command !== undefined ? 'stdio' : !strict && 'url' in server ? 'streamable-http' : undefined
    if (type === 'local') type = 'stdio'
    if (type === 'http') type = 'streamable-http'
    if (type === undefined || !KNOWN_MCP_TRANSPORTS.has(type)) {
      errors.push(`server "${name}": unsupported transport ${JSON.stringify(server.type)} (supported: stdio, streamable-http, sse)`)
      continue
    }
    if (type !== 'stdio') {
      valid[name] = { ...server, type } as McpServer
      continue
    }
    const stdioServer = server as { command: string; cwd?: string }
    const problems: string[] = []
    if (typeof stdioServer.command !== 'string') {
      errors.push(`server "${name}": stdio servers require a command`)
      continue
    }
    const command = stdioServer.command.replace(/^\$\{([A-Z_]+)\}\//, (match, name: string) => (PLUGIN_ROOT_VARIABLES.has(name) ? './' : match))
    if (options?.pathMode !== 'project' && command.includes('/')) {
      if (!command.startsWith('./')) {
        problems.push(`command "${command}" must be a bare executable name or a plugin-relative path beginning with "./"`)
      } else {
        const reason = await pathContainmentError(pluginRoot, command)
        if (reason !== undefined) problems.push(reason)
      }
    }
    if (stdioServer.cwd !== undefined && typeof stdioServer.cwd !== 'string') {
      problems.push('cwd must be a string')
    } else if (options?.pathMode !== 'project' && stdioServer.cwd !== undefined && ![...PLUGIN_DATA_VARIABLES].some(name => stdioServer.cwd!.startsWith(`\${${name}}`))) {
      const cwd = stdioServer.cwd === '.' ? './' : stdioServer.cwd
      const reason = await pathContainmentError(pluginRoot, cwd)
      if (reason !== undefined) problems.push(reason)
    }
    if (problems.length > 0) {
      errors.push(...problems.map(problem => `server "${name}": ${problem}`))
    } else {
      valid[name] = { ...server, command, type: 'stdio' } as McpServer
    }
  }
  return { config: { schema: typeof record['$schema'] === 'string' ? record['$schema'] : 'native-client', servers: valid }, errors }
}

export function expandPlaceholders(value: string, pluginRoot: string, pluginData: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (match, name: string, fallback?: string) => {
    if (PLUGIN_ROOT_VARIABLES.has(name)) return pluginRoot
    if (PLUGIN_DATA_VARIABLES.has(name)) return pluginData
    return env[name] || fallback || ''
  })
}

export function resolveCwd(value: string, pluginRoot: string, pluginData: string): string {
  if (value.startsWith('${PLUGIN_DATA}')) return resolve(pluginData, value.slice('${PLUGIN_DATA}'.length).replace(/^\/+/, ''))
  if (value.startsWith('${PLUGIN_ROOT}')) return resolve(pluginRoot, value.slice('${PLUGIN_ROOT}'.length).replace(/^\/+/, ''))
  return resolve(pluginRoot, value.replace(/^\.\//, ''))
}

export function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}
