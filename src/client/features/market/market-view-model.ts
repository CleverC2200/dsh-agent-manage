/** Pure market filtering and count derivation. */
/** 文件作用：把概览数据转换成市场筛选后的卡片和工具栏统计，不产生副作用。 */
import type { OverviewData, SuiteCardData } from '../../api.js'

/** Market status filter. */
/** 中文：市场卡片按全部、已安装或未安装范围筛选。 */
export type MarketFilter = 'all' | 'installed' | 'uninstalled'
/** Market source scope. */
/** 中文：市场范围为全部来源，或指定 sourceId。 */
export type MarketCategory = 'all' | string

/** Derived market view data used by the screen and its toolbar. */
/** 中文：视图模型同时提供工具栏统计和最终可见套件卡片。 */
export interface MarketViewModel {
  scopeTotals: { all: number; installed: number; enabled: number }
  filtered: SuiteCardData[]
}

/** 缓存套件展示对象及其可搜索文本，供筛选过程复用。 */
interface SearchableSuite {
  suite: SuiteCardData
  haystack: string
}

const searchableCache = new WeakMap<OverviewData, SearchableSuite[]>()

/** Derive visible cards and scope counts in one pass over a normalized payload. */
/** 中文：在一次遍历中完成来源、安装状态和关键词筛选及计数。 */
export function deriveMarketViewModel(overview: OverviewData, search: string, filter: MarketFilter, category: MarketCategory): MarketViewModel {
  /** 按来源、安装状态和关键词筛选套件，同时计算当前来源范围的数量。 */
  const searchable = searchableFor(overview)
  const needle = search.trim().toLowerCase()
  let all = 0
  let installed = 0
  let enabled = 0
  const visible: SuiteCardData[] = []

  for (const entry of searchable) {
    const suite = entry.suite
    if (category !== 'all' && suite.sourceId !== category) continue
    all++
    if (suite.installed) installed++
    if (suite.enabled) enabled++
    if (filter === 'installed' && !suite.installed) continue
    if (filter === 'uninstalled' && suite.installed) continue
    if (needle !== '' && !entry.haystack.includes(needle)) continue
    visible.push(suite)
  }

  return { scopeTotals: { all, installed, enabled }, filtered: visible }
}

/** 为同一概览对象缓存可搜索文本，避免每次输入都重建关键词串。 */
function searchableFor(overview: OverviewData): SearchableSuite[] {
  const cached = searchableCache.get(overview)
  if (cached !== undefined) return cached
  const searchable = overview.suites.map(suite => ({
    suite,
    haystack: `${suite.name} ${suite.description ?? ''} ${suite.keywords.join(' ')}`.toLowerCase()
  }))
  searchableCache.set(overview, searchable)
  return searchable
}
