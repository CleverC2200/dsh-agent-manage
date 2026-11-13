import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

export type McpBackend = 'builtin' | 'host'

export const MCP_BACKENDS: readonly McpBackend[] = ['builtin', 'host']

export const MCP_SETTINGS_NAMESPACE = 'dsh-agent-manage'

export interface HostMcpClientProbe {
  available: boolean
  version?: string
}

export async function probeHostMcpClient(): Promise<HostMcpClientProbe> {
  try {
    const require = createRequire(import.meta.url)
    const manifestPath = require.resolve('@deepseek-ai/dsh-mcp-client/package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string }
    return { available: true, ...(manifest.version === undefined ? {} : { version: manifest.version }) }
  } catch {
    return { available: false }
  }
}
