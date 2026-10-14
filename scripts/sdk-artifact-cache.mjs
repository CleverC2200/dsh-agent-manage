/** Cache produced SDK bytes; source, locks, platform and consumer admission remain authoritative. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const receipt = core => resolve(core, '.git/dsh-sdk-artifacts.json')
function artifactRoots(core) {
  return execFileSync('git', ['-C', core, 'ls-files', '*package.json'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(file => /^(?:packages|vendor|apps|native)\//.test(file) && !file.includes('/node_modules/'))
    .map(file => resolve(core, dirname(file), 'lib'))
}
/** Concrete roots avoid glob traversal of the installed dependency graph during cache upload. */
export function sdkCachePaths(core) {
  const paths = [...artifactRoots(core), ...['artifacts', 'web', 'flock'].map(name => resolve(core, `.git/dsh-sdk-${name}.json`)), resolve(core, 'apps/web/dist')]
  const native = resolve(core, `native/system/packages/${process.platform}-${process.arch}`)
  const metadata = resolve(native, 'prebuilds.json')
  if (existsSync(metadata))
    for (const binary of JSON.parse(readFileSync(metadata, 'utf8')).binaries ?? []) {
      if (typeof binary.path !== 'string' || !binary.path.endsWith('.node')) continue
      const target = resolve(native, binary.path)
      if (relative(native, target).startsWith('..')) throw new Error('SDK_CACHE_PATH_REJECTED')
      paths.push(target)
    }
  return [...new Set(paths)].sort()
}
function inventory(core) {
  core = realpathSync(core)
  const artifacts = {}
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) artifacts[relative(core, file).replaceAll('\\', '/')] = hash(file)
      else throw new Error('SDK_CACHE_ARTIFACT_TYPE')
    }
  }
  for (const lib of artifactRoots(core)) {
    if (existsSync(lib)) {
      if (!lstatSync(lib).isDirectory() || realpathSync(lib) !== lib) throw new Error('SDK_CACHE_ARTIFACT_TYPE')
      visit(lib)
    }
  }
  if (!Object.keys(artifacts).length) throw new Error('SDK_CACHE_ARTIFACTS_REQUIRED')
  return Object.fromEntries(Object.entries(artifacts).sort())
}
export function writeSDKArtifacts(core, identity) {
  const record = { identity, artifacts: inventory(core) }
  writeFileSync(receipt(core), JSON.stringify(record, null, 2) + '\n')
  return record
}
export function verifySDKArtifacts(core, identity) {
  if (!existsSync(receipt(core))) return false
  const record = JSON.parse(readFileSync(receipt(core), 'utf8'))
  if (JSON.stringify(record.identity) !== JSON.stringify(identity)) throw new Error('SDK_CACHE_IDENTITY_MISMATCH')
  if (JSON.stringify(record.artifacts) !== JSON.stringify(inventory(core))) throw new Error('SDK_CACHE_ARTIFACT_CHANGED')
  return true
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--github-paths' || !process.argv[3] || !process.env.GITHUB_OUTPUT) throw new Error('SDK_CACHE_OUTPUT_REQUIRED')
  appendFileSync(process.env.GITHUB_OUTPUT, `paths<<SDK_PATHS\n${sdkCachePaths(resolve(process.argv[3])).join('\n')}\nSDK_PATHS\n`)
}
