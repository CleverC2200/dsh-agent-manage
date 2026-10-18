/** Main-branch download producers are optional, bounded, and never follow filesystem links. */
import process from 'node:process'
import console from 'node:console'
import { appendFileSync, lstatSync, opendirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const maxBytes = 512 * 1024 * 1024
const maxEntries = 50_000

export function inspectDownloadCache(paths, { maxBytes: byteBudget = maxBytes, maxEntries: entryBudget = maxEntries } = {}) {
  let bytes = 0
  let entries = 0
  const roots = [...new Set(paths.map(path => resolve(path)))]
  function visit(path) {
    if (entries >= entryBudget) throw Error('entry-budget')
    entries++
    const stat = lstatSync(path)
    if (stat.isFile()) {
      bytes += stat.size
      if (bytes > byteBudget) throw Error('byte-budget')
    } else if (stat.isDirectory()) {
      const directory = opendirSync(path)
      try {
        let entry
        while ((entry = directory.readSync())) visit(join(path, entry.name))
      } finally {
        directory.closeSync()
      }
    } else throw Error('unsupported-file-type')
  }
  try {
    for (const root of roots) {
      const stat = lstatSync(root, { throwIfNoEntry: false })
      if (!stat) continue
      if (stat.isSymbolicLink()) throw Error('linked-root')
      if (realpathSync(root) !== root) throw Error('linked-root')
      visit(root)
    }
    return { ready: bytes > 0, paths: roots, bytes, entries }
  } catch (error) {
    return { ready: false, paths: [], bytes, entries, reason: error.message }
  }
}

/** Fixed restore/save inputs include absent roots; project links and npm execution trees are excluded. */
export function downloadCachePaths(home, store) {
  return [join(home, '.cache/node/corepack'), join(store, 'files'), join(store, 'index'), join(store, 'index.db'), join(home, '.npm/_cacache')]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pathsOnly = process.argv[2] === '--github-paths'
  if (!pathsOnly && (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/main')) throw Error('DOWNLOAD_CACHE_MAIN_PUSH_REQUIRED')
  const store = process.env.PNPM_STORE_PATH
  if (!store || !isAbsolute(store) || !process.env.GITHUB_OUTPUT) throw Error('DOWNLOAD_CACHE_OUTPUT_REQUIRED')
  const paths = downloadCachePaths(homedir(), store)
  if (pathsOnly) appendFileSync(process.env.GITHUB_OUTPUT, `store=${store}\npaths<<DOWNLOAD_PATHS\n${paths.join('\n')}\nDOWNLOAD_PATHS\n`)
  else {
    const result = inspectDownloadCache(paths)
    console.log(JSON.stringify({ ready: result.ready, bytes: result.bytes, entries: result.entries, reason: result.reason }))
    if (result.ready) appendFileSync(process.env.GITHUB_OUTPUT, 'ready=true\n')
  }
}
