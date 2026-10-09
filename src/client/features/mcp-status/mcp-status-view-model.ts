/** Pure MCP status filtering and count derivation. */
/** 文件作用：把 MCP 状态载荷转换为活动条目、筛选结果和状态统计，供状态面板直接渲染。 */
import type { McpStatusEntry, McpStatusPayload } from '../../api.js'

/** MCP status list filter. */
/** 中文：状态面板按全部、插件托管或直接配置来源筛选。 */
export type McpStatusFilter = 'all' | 'plugin' | 'direct'

/** Derived MCP list data used by the status screen. */
/** 中文：输出活动条目、筛选结果、来源计数和状态总览。 */
export interface McpStatusViewModel {
  activeEntries: McpStatusEntry[]
  filtered: McpStatusEntry[]
  filterCounts: { all: number; plugin: number; direct: number }
  /** Counted over the active (non-disabled-hidden) rows for the current view. */
  /** 中文：统计基于当前视图中的活动条目，隐藏禁用条目。 */
  visibleTotals: { all: number; connected: number; degraded: number; failed: number; needsCredentials: number; orphaned: number; disabled: number; foreign: number }
}

interface SearchableEntry {
  entry: McpStatusEntry
  haystack: string
}

const searchableCache = new WeakMap<McpStatusPayload, SearchableEntry[]>()

/** Derive active rows, filter counts, and visible rows in one pass. */
/** 中文：一次遍历完成活动行、来源计数、状态计数和搜索筛选。 */
/** 隐藏禁用条目后按归属、关键词筛选，并同步计算各状态计数。 */
export function deriveMcpStatusViewModel(payload: McpStatusPayload, filter: McpStatusFilter, search: string): McpStatusViewModel {
  /** 隐藏禁用条目后按归属、关键词筛选，并同步计算各状态计数。 */
  const searchable = searchableFor(payload)
  const activeEntries = searchable.map(item => item.entry)
  const filterCounts = { all: 0, plugin: 0, direct: 0 }
  const visibleTotals = { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 }
  const filtered: McpStatusEntry[] = []
  const needle = search.trim().toLowerCase()

  for (const item of searchable) {
    const entry = item.entry
    filterCounts.all++
    filterCounts[entry.kind]++
    visibleTotals.all++
    if (entry.state === 'connected') visibleTotals.connected++
    if (entry.state === 'degraded') visibleTotals.degraded++
    if (entry.state === 'failed') visibleTotals.failed++
    if (entry.state === 'needs-credentials') visibleTotals.needsCredentials++
    if (entry.state === 'orphaned') visibleTotals.orphaned++
    if (entry.state === 'disabled') visibleTotals.disabled++
    if (entry.state === 'foreign') visibleTotals.foreign++
    if (filter !== 'all' && entry.kind !== filter) continue
    if (needle !== '' && !item.haystack.includes(needle)) continue
    filtered.push(entry)
  }

  return {
    activeEntries,
    filtered,
    filterCounts,
    visibleTotals
  }
}

/** 为稳定的状态载荷缓存搜索字段，避免输入搜索词时重复拼接文本。 */
function searchableFor(payload: McpStatusPayload): SearchableEntry[] {
  const cached = searchableCache.get(payload)
  if (cached !== undefined) return cached
  const searchable = payload.entries
    .filter(entry => entry.state !== 'disabled')
    .map(entry => ({
      entry,
      haystack: `${entry.name} ${entry.source ?? ''} ${entry.endpoint ?? ''} ${entry.transport} ${entry.reason ?? ''} ${(entry.credentialRefs ?? []).join(' ')}`.toLowerCase()
    }))
  searchableCache.set(payload, searchable)
  return searchable
}
