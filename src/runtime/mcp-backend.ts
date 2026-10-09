/** 文件作用：选择内置或宿主 MCP 后端，并探测宿主兼容能力。 */
/**
 * MCP backend selection: whether suite MCP servers mount through the
 * market's self-built bridge (default — stdio, Streamable HTTP with OAuth,
 * and legacy SSE) or through the host's `@deepseek-ai/dsh-mcp-client`
 * (compatibility mode: no OAuth, no SSE, but the host-native implementation).
 *
 * The choice is a host settings namespace (`dsh-agent-plugins-market`,
 * `mcpEnhanced: boolean`, default true) registered by the plugin's node half:
 * the registration is what makes the host 插件配置 tab serve our card, the
 * client card binds it for state, and the node half watches it to remount
 * servers when the switch flips. Retired data-root settings are not read.
 *
 * @module runtime/mcp-backend
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import z from '@deepseek-ai/schemastery'

/** The MCP mount backend the market uses for suite servers. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export type McpBackend = 'builtin' | 'host'

export const MCP_BACKENDS: readonly McpBackend[] = ['builtin', 'host']

/** Settings namespace this plugin registers; the key the plugin-config tab pairs our card by. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const MCP_SETTINGS_NAMESPACE = 'dsh-agent-plugins-market'

/** Schema of the market settings namespace: the MCP enhancement switch, the download region, and the feedback tool switch. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const MarketSettingsSchema = z.object({
  /** ON (default) = the built-in bridge with OAuth and SSE; OFF = host client compat mode. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  mcpEnhanced: z.boolean().default(true),
  /** Read native Agent layouts under the project root; default preserves existing discovery. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  scanProjectLayouts: z.boolean().default(true),
  /** Download region for GitHub acquisition; `auto` follows the interface language. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  downloadRegion: z.union([z.const('auto'), z.const('global'), z.const('china')]).default('auto'),
  /** ON (default) = the `report_market_issue` model tool is registered; OFF = unregistered. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  feedbackEnabled: z.boolean().default(true)
})

/** What the host client probe reports: resolvability plus its version. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
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
