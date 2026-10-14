/** Cache produced SDK bytes; source, locks, platform and consumer admission remain authoritative. */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, existsSync, lstatSync, realpathSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { createHash } from 'node:crypto'

const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const receipt = core => resolve(core, '.git/dsh-sdk-artifacts.json')
function inventory(core) {
  core = realpathSync(core)
  const artifacts = {}
  const manifests = execFileSync('git', ['-C', core, 'ls-files', '*package.json'], { encoding: 'utf8' }).trim().split('\n')
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) artifacts[relative(core, file).replaceAll('\\', '/')] = hash(file)
      else throw new Error('SDK_CACHE_ARTIFACT_TYPE')
    }
  }
  for (const manifest of manifests) {
    if (!/^(?:packages|vendor|apps)\//.test(manifest)) continue
    const lib = resolve(core, dirname(manifest), 'lib')
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
