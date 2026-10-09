import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Expectations are the admitted official input, not supplied by a PR's manifest.
const coreCommit = '5badb15009ae1756c3afe0ae0cef1faafc290ccc'
const coreLock = '2893d71a9ef07d2d72d47b2199e581b9e8d90638a15ee151908eebf69dfc637c'
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
function refuse(code, detail) {
  throw new Error(`${code}: ${detail}`)
}
function run(command, args, cwd, capture = false) {
  const windows = process.platform === 'win32' && ['corepack', 'git'].includes(command)
  const result = spawnSync(windows && command === 'corepack' ? 'corepack.cmd' : command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: windows && command === 'corepack'
  })
  if (result.error || result.status !== 0) refuse('SDK_COMMAND_FAILED', `${command} ${args.join(' ')}: ${result.error?.message ?? result.stderr ?? result.status}`)
  return capture ? result.stdout.trim() : undefined
}

function source(core, writing) {
  if (!existsSync(resolve(core, '.git'))) refuse('SDK_SOURCE_REQUIRED', core)
  if (writing && realpathSync(core) !== resolve(core)) refuse('SDK_PRIVATE_CHECKOUT_REQUIRED', core)
  if (run('git', ['rev-parse', 'HEAD'], core, true) !== coreCommit) refuse('SDK_CORE_MISMATCH', core)
  if (hash(resolve(core, 'pnpm-lock.yaml')) !== coreLock) refuse('SDK_LOCK_MISMATCH', core)
  if (run('git', ['status', '--porcelain', '--untracked-files=normal'], core, true)) refuse('SDK_DIRTY_SOURCE', core)
  if (json(resolve(core, 'package.json')).packageManager !== 'pnpm@11.7.0') refuse('SDK_TOOLCHAIN_MISMATCH', core)
  if (Number(process.versions.node.split('.')[0]) !== 24) refuse('SDK_TOOLCHAIN_MISMATCH', `Node ${process.versions.node}; expected 24`)
}

function ownedSource(core) {
  const owner = spawnSync('git', ['config', '--local', '--get', 'dsh.sdkPreparation'], { cwd: core, encoding: 'utf8' })
  if (owner.status !== 0 || owner.stdout.trim() !== 'independent-fixed-core')
    refuse('SDK_PRIVATE_CHECKOUT_REQUIRED', 'use --source with a new checkout; an existing shared SDK is read-only')
  source(core, true)
  if (run('corepack', ['pnpm', '--version'], core, true) !== '11.7.0') refuse('SDK_TOOLCHAIN_MISMATCH', 'pnpm')
}

const webScript = 'pnpm --filter @deepseek-ai/dsh-web-frontend run build'
const webSources = ['package.json', 'apps/web/package.json', 'apps/web/index.html', 'apps/web/vite.config.ts', 'apps/web/product-isolation.ts', 'scripts/client-build-environment.ts']
const webReceipt = core => resolve(run('git', ['rev-parse', '--absolute-git-dir'], core, true), 'dsh-sdk-web.json')

function webFile(core, path) {
  const dist = resolve(core, 'apps/web/dist')
  const file = resolve(core, path)
  if (!path.startsWith('apps/web/dist/') || relative(dist, file).startsWith('..') || !existsSync(file))
    refuse('SDK_WEB_MATERIAL_REQUIRED', path)
  if (!lstatSync(file).isFile() || realpathSync(file) !== resolve(realpathSync(core), path)) refuse('SDK_WEB_PATH_REJECTED', path)
  return file
}

function webIndex(core) {
  const html = readFileSync(webFile(core, 'apps/web/dist/index.html'), 'utf8')
  let localAssets = 0
  for (const [, target] of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) continue
    const path = target.split(/[?#]/)[0].replace(/^\//, '')
    webFile(core, `apps/web/dist/${path}`)
    localAssets++
  }
  if (!localAssets || !/<script\b[^>]*\btype=["']module["']/.test(html)) refuse('SDK_WEB_ENTRY_REQUIRED', 'built module entry and its local assets required')
}

function verifyWeb(core) {
  webIndex(core)
  const receipt = webReceipt(core)
  if (!existsSync(receipt)) refuse('SDK_WEB_RECEIPT_REQUIRED', 'run --prepare-web in the owned prepared checkout')
  const record = json(receipt)
  if (record.coreCommit !== coreCommit || record.coreLock !== coreLock || record.command !== 'corepack pnpm run build:web' || json(resolve(core, 'package.json')).scripts['build:web'] !== webScript)
    refuse('SDK_WEB_SOURCE_MISMATCH', receipt)
  for (const path of webSources)
    if (record.sourceHashes?.find(entry => entry.path === path)?.sha256 !== hash(resolve(core, path))) refuse('SDK_WEB_SOURCE_MISMATCH', path)
  if (!Array.isArray(record.artifacts) || record.artifacts.length < 2 || !record.artifacts.some(entry => entry.path === 'apps/web/dist/index.html') || new Set(record.artifacts.map(entry => entry.path)).size !== record.artifacts.length)
    refuse('SDK_WEB_RECEIPT_REQUIRED', 'complete produced artifact inventory required')
  for (const entry of record.artifacts)
    if (hash(webFile(core, entry.path)) !== entry.sha256) refuse('SDK_WEB_ARTIFACT_CHANGED', entry.path)
  return { ...record, status: 'prepared' }
}

export function verifyOfficialSDK({ core, consumer, withWeb = false }) {
  core = resolve(core)
  consumer = resolve(consumer)
  source(core, false)
  const configuration = existsSync(resolve(consumer, 'tsconfig.official-paths.json')) ? 'tsconfig.official-paths.json' : 'tsconfig.official.json'
  const paths = json(resolve(consumer, configuration)).compilerOptions.paths
  const artifacts = new Set()
  for (const targets of Object.values(paths))
    for (const target of targets) {
      const prefix = '../../official-latest-standard/'
      if (/^\.\.\/dsh-agent-(workbench|manage)\//.test(target)) continue
      if (!target.startsWith(prefix)) refuse('SDK_PATH_REJECTED', target)
      artifacts.add(resolve(core, target.slice(prefix.length)))
    }
  const packages = new Set()
  for (const file of artifacts) {
    const local = relative(core, file).split(sep)
    const lib = local.indexOf('lib')
    if (lib >= 0) packages.add(resolve(core, ...local.slice(0, lib)))
  }
  const collect = value => {
    if (typeof value === 'string') return [value]
    return Object.values(value ?? {}).flatMap(collect)
  }
  for (const root of packages) {
    const manifest = json(resolve(root, 'package.json'))
    for (const target of collect(manifest.exports)) {
      if (target.includes('*') || !target.startsWith('./lib/')) continue
      artifacts.add(resolve(root, target))
    }
    for (const target of [manifest.main, manifest.module, manifest.types]) if (target?.startsWith('lib/')) artifacts.add(resolve(root, target))
  }
  for (const file of artifacts) if (!existsSync(file)) refuse('SDK_MATERIAL_REQUIRED', relative(core, file))
  return {
    status: 'prepared',
    coreCommit,
    coreLock,
    core,
    consumer,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    packageManager: 'pnpm@11.7.0',
    packages: packages.size,
    artifacts: [...artifacts].sort().map(file => ({ path: relative(core, file).split(sep).join('/'), sha256: hash(file) })),
    ...(withWeb ? { web: verifyWeb(core) } : {})
  }
}

/** Build only the official static Web product in an already-owned, prepared SDK. */
export function prepareOfficialWeb(options) {
  const core = resolve(options.core)
  ownedSource(core)
  const before = verifyOfficialSDK({ ...options, withWeb: false })
  if (json(resolve(core, 'package.json')).scripts['build:web'] !== webScript) refuse('SDK_WEB_SOURCE_MISMATCH', 'official build:web script')
  run('corepack', ['pnpm', 'run', 'build:web'], core)
  source(core, true)
  const after = verifyOfficialSDK({ ...options, withWeb: false })
  if (JSON.stringify(before.artifacts) !== JSON.stringify(after.artifacts)) refuse('SDK_WEB_CHANGED_SDK', 'static Web preparation changed SDK targets')
  webIndex(core)
  const artifacts = []
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory() && realpathSync(file) === file) collect(file)
      else {
        const path = relative(core, file).split(sep).join('/')
        artifacts.push({ path, sha256: hash(webFile(core, path)) })
      }
    }
  }
  collect(resolve(core, 'apps/web/dist'))
  writeFileSync(webReceipt(core), JSON.stringify({
    coreCommit, coreLock, command: 'corepack pnpm run build:web',
    sourceHashes: webSources.map(path => ({ path, sha256: hash(resolve(core, path)) })),
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path))
  }, null, 2) + '\n')
  return verifyOfficialSDK({ ...options, withWeb: true })
}

export function prepareOfficialSDK(options) {
  const core = resolve(options.core)
  if (!existsSync(resolve(core, '.git'))) {
    if (!options.source) refuse('SDK_SOURCE_REQUIRED', 'supply --source for a new independent checkout')
    mkdirSync(dirname(core), { recursive: true })
    run('git', ['clone', '--no-checkout', '--no-hardlinks', options.source, core], dirname(core))
    run('git', ['checkout', '--detach', coreCommit], core)
    run('git', ['config', '--local', 'dsh.sdkPreparation', 'independent-fixed-core'], core)
  }
  ownedSource(core)
  // These are the official build:lib host/client SDK stages. The desktop
  // bundle, installer, native system build, upload and runtime are excluded.
  run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline'], core)
  const tsc = resolve(core, 'node_modules/typescript/bin/tsc')
  run(process.execPath, ['--max-old-space-size=4096', tsc, '-b', 'tsconfig.host.json'], core)
  run('corepack', ['pnpm', 'exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE', 'host'], core)
  run(process.execPath, [tsc, '-b', 'tsconfig.client.json'], core)
  run('corepack', ['pnpm', 'exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE', 'client'], core)
  return options.withWeb ? prepareOfficialWeb(options) : verifyOfficialSDK(options)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const value = name => {
      const i = args.indexOf(name)
      return i < 0 ? undefined : args[i + 1]
    }
    if (args.includes('--prepare') && args.includes('--prepare-web')) refuse('SDK_PREPARATION_MODE_CONFLICT', 'choose cold preparation or web-only preparation')
    const options = { core: value('--core') ?? '../../official-latest-standard', consumer: value('--consumer') ?? process.cwd(), source: value('--source'), withWeb: args.includes('--with-web') }
    const result = args.includes('--prepare-web') ? prepareOfficialWeb(options) : args.includes('--prepare') ? prepareOfficialSDK(options) : verifyOfficialSDK(options)
    const receipt = value('--receipt')
    if (receipt) {
      mkdirSync(dirname(resolve(receipt)), { recursive: true })
      writeFileSync(receipt, JSON.stringify(result, null, 2) + '\n')
    }
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
