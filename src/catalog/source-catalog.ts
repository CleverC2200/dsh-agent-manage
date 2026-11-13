import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { expandHome, isDirectory, sourcesDir } from './paths.js'
import type { SourceRef, Suite, SuiteDimension } from '../model/types.js'
import { scanSource as scanSourceWithNotes } from './suite-scanner.js'
import { discoverNativeProjectSuites } from './native-project.js'

export async function discoverSourceList(sources: SourceRef[], dimension: SuiteDimension, dimensionRoot: string): Promise<Suite[]> {
  return (await discoverSourceListWithNotes(sources, dimension, dimensionRoot)).suites
}

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

    sourceUrl: source.url
  }))
  if (dimension === 'project') {
    try {
      for (const entry of await readdir(checkoutRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || listed.has(entry.name)) continue
        checkouts.push({ sourceId: entry.name, checkout: join(checkoutRoot, entry.name), sourceUrl: undefined })
      }
    } catch {}
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
