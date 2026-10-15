/** 文件作用：按用户/项目维度选择来源 checkout，并汇总扫描诊断和原生项目套件。 */
/**
 * Select source checkouts for a catalog dimension.
 *
 * User catalogs include only configured sources. Project catalogs additionally
 * retain unmanaged checkout ids because project install state can authorize
 * them without duplicating source configuration, and discover the project's
 * native agent directories (`.claude/`, `.agents/`) in place so repositories
 * migrating from other coding agents need no file copying.
 */
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expandHome, isDirectory, sourcesDir } from './paths.js'
import type { SourceRef, Suite, SuiteDimension } from '../model/types.js'
import { scanSource as scanSourceWithNotes } from './suite-scanner.js'
import { discoverNativeProjectSuites } from './native-project.js'

/** Discover suites from the selected configured or project checkouts. */
/** 扫描指定维度的来源 checkout，并返回不带 notes 的兼容套件列表。 */
export async function discoverSourceList(sources: SourceRef[], dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
  return (await discoverSourceListWithNotes(sources, dimension, dimensionRoot)).suites
}

/** Discover suites plus per-source scan diagnostics for one dimension. */
/** 扫描来源并保留 checkout 级 notes，供 SourceOverview 和状态面展示。 */
export async function discoverSourceListWithNotes(
  sources: SourceRef[],
  dimension: SuiteDimension,
  dimensionRoot: string,
  scanProjectLayouts = true
): Promise<{ suites: Suite[]; scanNotes: Record<string, string[]> }> {
  const checkoutRoot = sourcesDir(dimensionRoot)
  const listed = new Set(sources.map(source => source.id))
  const checkouts: Array<{ sourceId: string; checkout: string; sourceUrl?: string }> = sources.map(source => ({
    sourceId: source.id,
    checkout: source.local === true ? expandHome(source.url) : join(checkoutRoot, source.id),
    // The configured URL drives marketplace-entry self-reference resolution:
    // an entry pointing back at this very source (Claude Code ships
    // `{ source: 'github', repo: <own repo> }`) scans the local checkout.
    // 中文：用已配置 URL 识别指向自身的 marketplace entry，并复用本地 checkout。
    sourceUrl: source.url
  }))
  if (dimension === 'project') {
    try {
      for (const entry of await readdir(checkoutRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || listed.has(entry.name)) continue
        checkouts.push({ sourceId: entry.name, checkout: join(checkoutRoot, entry.name), sourceUrl: undefined })
      }
    } catch {
      // A missing project checkout root has no unmanaged project sources.
      // 中文：项目 checkout 根不存在时不虚构未管理来源，直接保持空集合。
    }
  }
  const discovered = await Promise.all(
    checkouts.map(async ({ sourceId, checkout, sourceUrl }) => {
      if (!(await isDirectory(checkout))) return { sourceId, suites: [] as Suite[], notes: [] as string[] }
      const result = await scanSourceWithNotes(checkout, sourceId, dimension, sourceUrl)
      return { sourceId, suites: result.suites, notes: result.notes }
    })
  )
  const suites = discovered.flatMap(entry => entry.suites)
  const scanNotes: Record<string, string[]> = {}
  for (const entry of discovered) {
    if (entry.notes.length > 0) scanNotes[entry.sourceId] = entry.notes
  }
  if (dimension === 'project' && scanProjectLayouts) {
    // Native project directories live two levels above the dimension root
    // (`<projectRoot>/.dsh/agent-plugins`); read them in place.
    // 中文：原生项目目录位于维度根上方两级，按只读方式原地发现。
    const native = await discoverNativeProjectSuites(dirname(dirname(dimensionRoot)), dimension)
    suites.push(...native)
    const errors = [...new Set(native.flatMap(suite => suite.errors))]
    if (errors.length > 0) scanNotes.native = errors
  }
  if (dimension === 'project') {
    for (const suite of suites) {
      if (suite.lsp === undefined) continue
      const note = `suite ${suite.id}: project LSP declarations are not mounted; the host LSP registry does not isolate projects`
      suite.errors.push(note)
      ;(scanNotes[suite.sourceId] ??= []).push(note)
    }
  }
  return { suites, scanNotes }
}
