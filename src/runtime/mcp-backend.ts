/** 文件作用：选择内置或宿主 MCP 后端，并探测宿主兼容能力。 */
/**
 * MCP backend selection: whether suite MCP servers mount through the
 * market's self-built bridge (default — stdio, Streamable HTTP with OAuth,
 * and legacy SSE) or through the host's `@deepseek-ai/dsh-mcp-client`
 * (compatibility mode: no OAuth, no SSE, but the host-native implementation).
 *
 * The native SettingsForms namespace is the shipped `dsh-agent-manage`
 * Loader entry. Its volatile Config fields drive the custom client card and
 * host reconciler; no separate settings store or namespace is registered.
 *
 * @module runtime/mcp-backend
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'

/** The MCP mount backend the market uses for suite servers. */
export type McpBackend = 'builtin' | 'host'

export const MCP_BACKENDS: readonly McpBackend[] = ['builtin', 'host']

/** Shipped Loader entry id used by the native plugin-config card. */
export const MCP_SETTINGS_NAMESPACE = 'dsh-agent-manage'

/** Schema of the market settings namespace: the MCP enhancement switch, the download region, and the feedback tool switch. */
const MarketSettingsFields = {
  /** ON (default) = the built-in bridge with OAuth and SSE; OFF = host client compat mode. */
  mcpEnhanced: z.boolean().default(true),
  /** Read native Agent layouts under the project root; default preserves existing discovery. */
  scanProjectLayouts: z.boolean().default(true),
  /** Download region for GitHub acquisition; `auto` follows the interface language. */
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default('auto'),
  /** ON (default) = the `report_market_issue` model tool is registered; OFF = unregistered. */
  feedbackEnabled: z.boolean().default(true)
}

export const MarketSettingsSchema = z.object(MarketSettingsFields)

/** What the host client probe reports: resolvability plus its version. */
export interface HostMcpClientProbe {
  available: boolean
  version?: string
}

/**
 * Probe whether the host's `dsh-mcp-client` is resolvable from this plugin's
 * module context, and at which version. Best effort: any failure reads as
 * "unavailable", which the mount path surfaces as a per-server diagnostic
 * when the host backend is selected.
 */
/** 探测宿主 MCP 客户端是否可解析及版本；任何失败均返回 unavailable，不抛出发现异常。 */
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

/** Reuse the same field rules as live Loader Config without changing plain validation. */
export const ManageConfigSchema = z.object({
  mcpEnhanced: MarketSettingsFields.mcpEnhanced.volatile(),
  scanProjectLayouts: MarketSettingsFields.scanProjectLayouts.volatile(),
  downloadRegion: MarketSettingsFields.downloadRegion.volatile(),
  feedbackEnabled: MarketSettingsFields.feedbackEnabled.volatile()
})
