/** 文件作用：根据 MCP 条目归属和状态计算详情页可执行的重试、重新授权动作。 */
import type { McpStatusEntry } from '../../../contracts/mcp-status.js'

/** Actions describe different effects: retry preserves credentials; OAuth reset is explicit. */
/** 中文：重试不改凭据；OAuth 重新授权必须由用户显式触发。 */
export function mcpDetailActions(entry: McpStatusEntry) {
  /** 输入一条状态投影，输出不改变凭据的重试和显式 OAuth 重授权能力。 */
  const owned = entry.kind === 'plugin' || entry.managed === true
  return {
    retry: owned && (entry.state === 'failed' || entry.state === 'orphaned') && entry.code !== 'unsupported-transport',
    reauthorize: owned && entry.canReauthorize === true && !['disabled', 'foreign', 'orphaned', 'needs-credentials'].includes(entry.state)
  }
}
