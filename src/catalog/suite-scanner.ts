import type { Suite, SuiteDimension } from '../model/types.js'
import { scanSource } from './scan-resolvers.js'

export {
  repoName,
  listMdFiles,
  discoverLspEntries,
  scanSource,
  canonicalGitUrl,
  resolveMarketplaceEntry,
  defaultScanFilters,
  MarketplaceStrategy,
  RootedStrategy,
  FlatCollectionsStrategy
} from './scan-resolvers.js'
export type { MarketplaceEntry, EntryResolution, EntryHandler, SuiteHint } from './scan-resolvers.js'
export type { LspEntry } from './surfaces.js'
export { runScanChain } from './scan-pipeline.js'
export type { ScanContext, ScanFilter, ScanChain, ScanResolution, ScanAttempt, ScanResult } from './scan-pipeline.js'

export async function discoverSuitesInSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension, sourceUrl?: string): Promise<Suite[]> {
  return scanSource(checkoutDir, sourceId, dimension, sourceUrl).then(result => result.suites)
}
