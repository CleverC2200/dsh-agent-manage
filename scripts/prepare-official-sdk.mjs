import { URL } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { createHash } from 'node:crypto'
const acquireBuild = options => createRequire(import.meta.url)('../../dsh-gea-plugin/scripts/build-admission.mjs').acquireBuild(options)
import { existsSync, readFileSync, realpathSync, writeFileSync, mkdirSync, readdirSync, lstatSync } from 'node:fs'
import { dirname, resolve, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { verifySDKArtifacts, writeSDKArtifacts } from './sdk-artifact-cache.mjs'

// GEA owns the registered Core source, original lock and toolchain authority.
function supportedCore(coreHead) {
  const registry = json(new URL('../../dsh-gea-plugin/scripts/supported-cores.json', import.meta.url))
  const selectedHead = coreHead === undefined ? json(new URL('../../dsh-gea-plugin/scripts/current-core.json', import.meta.url)).adaptation : coreHead
  const selected = registry.find(entry => entry.head === selectedHead)
  if (!selected) refuse('SDK_CORE_UNSUPPORTED', selectedHead ?? 'registered current adaptation required')
  if (
    !/^[a-f0-9]{40}$/.test(selected.head) ||
    !/^[a-f0-9]{64}$/.test(selected.lockSha256) ||
    !['pnpm@11.7.0', 'pnpm@11.11.0'].includes(selected.packageManager) ||
    selected.nodeMajor !== 24
  )
    refuse('SDK_AUTHORITY_REQUIRED', 'registered head, original lock and exact toolchain')
  return { coreCommit: selected.head, coreLock: selected.lockSha256, packageManager: selected.packageManager, nodeMajor: selected.nodeMajor }
}
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

function source(core, writing, coreHead) {
  const baseline = supportedCore(coreHead)
  const { coreCommit, coreLock, packageManager, nodeMajor } = baseline
  if (!existsSync(resolve(core, '.git'))) refuse('SDK_SOURCE_REQUIRED', core)
  if (writing && realpathSync(core) !== resolve(core)) refuse('SDK_PRIVATE_CHECKOUT_REQUIRED', core)
  if (run('git', ['rev-parse', 'HEAD'], core, true) !== coreCommit) refuse('SDK_CORE_MISMATCH', core)
  if (hash(resolve(core, 'pnpm-lock.yaml')) !== coreLock) refuse('SDK_LOCK_MISMATCH', core)
  if (run('git', ['status', '--porcelain', '--untracked-files=normal'], core, true)) refuse('SDK_DIRTY_SOURCE', core)
  if (json(resolve(core, 'package.json')).packageManager !== packageManager) refuse('SDK_TOOLCHAIN_MISMATCH', core)
  if (Number(process.versions.node.split('.')[0]) !== nodeMajor) refuse('SDK_TOOLCHAIN_MISMATCH', `Node ${process.versions.node}; expected ${nodeMajor}`)
  return baseline
}

/** Verify fixed Git source and original lock without requiring or preparing SDK outputs. */
export function verifyOfficialSource(core, { coreHead } = {}) {
  const { coreCommit, coreLock, packageManager } = source(core, false, coreHead)
  return { root: realpathSync(core), commit: coreCommit, lockSha256: coreLock, packageManager }
}

function ownedSource(core, coreHead) {
  const owner = spawnSync('git', ['config', '--local', '--get', 'dsh.sdkPreparation'], { cwd: core, encoding: 'utf8' })
  if (owner.status !== 0 || owner.stdout.trim() !== 'independent-fixed-core')
    refuse('SDK_PRIVATE_CHECKOUT_REQUIRED', 'use --source with a new checkout; an existing shared SDK is read-only')
  const { packageManager } = source(core, true, coreHead)
  if (run('corepack', ['pnpm', '--version'], core, true) !== packageManager.slice('pnpm@'.length)) refuse('SDK_TOOLCHAIN_MISMATCH', 'pnpm')
}

const webScript = 'pnpm --filter @deepseek-ai/dsh-web-frontend run build'
const webSources = [
  'package.json',
  'apps/web/package.json',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'apps/web/product-isolation.ts',
  'scripts/client-build-environment.ts'
]
const webReceipt = core => resolve(run('git', ['rev-parse', '--absolute-git-dir'], core, true), 'dsh-sdk-web.json')

function webFile(core, path) {
  const dist = resolve(core, 'apps/web/dist')
  const file = resolve(core, path)
  if (!path.startsWith('apps/web/dist/') || relative(dist, file).startsWith('..') || !existsSync(file)) refuse('SDK_WEB_MATERIAL_REQUIRED', path)
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

function verifyWeb(core, coreHead) {
  const { coreCommit, coreLock } = supportedCore(coreHead)
  webIndex(core)
  const receipt = webReceipt(core)
  if (!existsSync(receipt)) refuse('SDK_WEB_RECEIPT_REQUIRED', 'run --prepare-web in the owned prepared checkout')
  const record = json(receipt)
  if (
    record.coreCommit !== coreCommit ||
    record.coreLock !== coreLock ||
    record.command !== 'corepack pnpm run build:web' ||
    json(resolve(core, 'package.json')).scripts['build:web'] !== webScript
  )
    refuse('SDK_WEB_SOURCE_MISMATCH', receipt)
  for (const path of webSources) if (record.sourceHashes?.find(entry => entry.path === path)?.sha256 !== hash(resolve(core, path))) refuse('SDK_WEB_SOURCE_MISMATCH', path)
  if (
    !Array.isArray(record.artifacts) ||
    record.artifacts.length < 2 ||
    !record.artifacts.some(entry => entry.path === 'apps/web/dist/index.html') ||
    new Set(record.artifacts.map(entry => entry.path)).size !== record.artifacts.length
  )
    refuse('SDK_WEB_RECEIPT_REQUIRED', 'complete produced artifact inventory required')
  for (const entry of record.artifacts) if (hash(webFile(core, entry.path)) !== entry.sha256) refuse('SDK_WEB_ARTIFACT_CHANGED', entry.path)
  return { ...record, status: 'prepared' }
}

const flockScript = 'tsx native/system/scripts/build.ts --host-addon-only'
const flockReceipt = core => resolve(run('git', ['rev-parse', '--absolute-git-dir'], core, true), 'dsh-sdk-flock.json')

function flockTarget(core) {
  if (!['linux', 'darwin'].includes(process.platform)) refuse('SDK_FLOCK_UNSUPPORTED_PLATFORM', `${process.platform}-${process.arch}`)
  const platform = `${process.platform}-${process.arch}`
  const libc = process.platform === 'linux' ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined
  const metadata = `native/system/packages/${platform}/prebuilds.json`
  if (!existsSync(resolve(core, metadata))) refuse('SDK_FLOCK_TARGET_REQUIRED', platform)
  const spec = json(resolve(core, metadata))
  const binaries = spec.binaries?.filter(binary => binary.tool === 'flock' && binary.kind === 'node-api' && binary.napi === 8 && binary.libc === libc)
  if (spec.platform !== platform || binaries?.length !== 1 || Number(process.versions.napi) < 8) refuse('SDK_FLOCK_TARGET_REQUIRED', `${platform}/${libc ?? 'node-api'}/napi8`)
  const path = `native/system/packages/${platform}/${binaries[0].path}`
  if (!path.endsWith('.node') || relative(resolve(core, `native/system/packages/${platform}`), resolve(core, path)).startsWith('..')) refuse('SDK_FLOCK_TARGET_REQUIRED', path)
  return {
    platform,
    ...(libc ? { libc } : {}),
    napi: 8,
    path,
    sourcePaths: ['package.json', 'native/system/scripts/build.ts', 'native/system/packages/entry/src/flock.c', metadata]
  }
}

function verifyFlock(core, coreHead) {
  const { coreCommit, coreLock } = supportedCore(coreHead)
  const target = flockTarget(core)
  const file = resolve(core, target.path)
  if (!existsSync(file)) refuse('SDK_FLOCK_MATERIAL_REQUIRED', target.path)
  if (!lstatSync(file).isFile() || realpathSync(file) !== resolve(realpathSync(core), target.path)) refuse('SDK_FLOCK_PATH_REJECTED', target.path)
  const receipt = flockReceipt(core)
  if (!existsSync(receipt)) refuse('SDK_FLOCK_RECEIPT_REQUIRED', 'run --prepare-flock in the owned prepared checkout')
  const record = json(receipt)
  if (
    record.coreCommit !== coreCommit ||
    record.coreLock !== coreLock ||
    record.command !== 'corepack pnpm run build:native-system' ||
    record.artifact?.path !== target.path ||
    record.platform !== target.platform ||
    record.libc !== target.libc ||
    record.napi !== target.napi ||
    json(resolve(core, 'package.json')).scripts['build:native-system'] !== flockScript
  )
    refuse('SDK_FLOCK_SOURCE_MISMATCH', receipt)
  for (const path of target.sourcePaths)
    if (record.sourceHashes?.find(entry => entry.path === path)?.sha256 !== hash(resolve(core, path))) refuse('SDK_FLOCK_SOURCE_MISMATCH', path)
  if (hash(file) !== record.artifact.sha256) refuse('SDK_FLOCK_ARTIFACT_CHANGED', target.path)
  try {
    if (typeof createRequire(import.meta.url)(file).tryLock !== 'function') refuse('SDK_FLOCK_LOAD_REQUIRED', 'tryLock export')
  } catch (error) {
    refuse('SDK_FLOCK_LOAD_REQUIRED', error.message)
  }
  return { ...record, status: 'prepared', loadable: true }
}

function sdkArtifactIdentity(coreHead) {
  return { ...supportedCore(coreHead), node: process.version, platform: process.platform, arch: process.arch, builder: hash(fileURLToPath(import.meta.url)) }
}

export function verifyOfficialSDK({ core, consumer, coreHead, withWeb = false, withFlock = false, withArtifactReceipt = false }) {
  core = resolve(core)
  consumer = resolve(consumer)
  const { coreCommit, coreLock, packageManager } = source(core, false, coreHead)
  const configuration = existsSync(resolve(consumer, 'tsconfig.official-paths.json')) ? 'tsconfig.official-paths.json' : 'tsconfig.official.json'
  const paths = json(resolve(consumer, configuration)).compilerOptions.paths
  const artifacts = new Set()
  const notApplicable = []
  // Consumer maps cover the full alpha SDK; applicability comes from the selected Git source.
  const registeredPackages = new Map()
  for (const file of run('git', ['ls-files', '*package.json'], core, true).split('\n')) {
    if (!file || !(file.startsWith('packages/') || file.startsWith('vendor/') || file.startsWith('apps/'))) continue
    const manifest = json(resolve(core, file))
    if (manifest.name) registeredPackages.set(manifest.name, dirname(file))
  }
  for (const [alias, targets] of Object.entries(paths))
    for (const target of targets) {
      const prefix = '../../official-latest-standard/'
      if (/^\.\.\/dsh-agent-(workbench|manage)\//.test(target)) continue
      if (!target.startsWith(prefix)) refuse('SDK_PATH_REJECTED', target)
      const packageName = alias.startsWith('@') ? alias.split('/').slice(0, 2).join('/') : alias.split('/')[0]
      const registeredRoot = registeredPackages.get(packageName)
      const local = target.slice(prefix.length)
      if (registeredRoot === undefined) {
        const manifestPath = resolve(core, local.split('/lib/')[0], 'package.json')
        if (existsSync(manifestPath)) refuse('SDK_PACKAGE_PATH_MISMATCH', `${alias}: target belongs to ${json(manifestPath).name}`)
        notApplicable.push({ alias, path: target, reason: 'package absent from the selected fixed Core Git source' })
        continue
      }
      if (!local.startsWith(`${registeredRoot}/lib/`)) refuse('SDK_PACKAGE_PATH_MISMATCH', `${alias}: ${target}; registered ${registeredRoot}`)
      artifacts.add(resolve(core, local))
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
  if (withArtifactReceipt && !verifySDKArtifacts(core, sdkArtifactIdentity(coreHead))) refuse('SDK_ARTIFACT_RECEIPT_REQUIRED', 'complete verified SDK inventory required')
  return {
    status: 'prepared',
    coreCommit,
    coreLock,
    core,
    consumer,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    packageManager,
    packages: packages.size,
    notApplicable,
    artifacts: [...artifacts].sort().map(file => ({ path: relative(core, file).split(sep).join('/'), sha256: hash(file) })),
    ...(withWeb ? { web: verifyWeb(core, coreHead) } : {}),
    ...(withFlock ? { flock: verifyFlock(core, coreHead) } : {})
  }
}

/** Build only the official static Web product in an already-owned, prepared SDK. */
export function prepareOfficialWeb(options) {
  const core = resolve(options.core)
  const coreHead = options.coreHead
  const { coreCommit, coreLock } = supportedCore(coreHead)
  ownedSource(core, coreHead)
  const before = verifyOfficialSDK({ ...options, withWeb: false })
  if (json(resolve(core, 'package.json')).scripts['build:web'] !== webScript) refuse('SDK_WEB_SOURCE_MISMATCH', 'official build:web script')
  run('corepack', ['pnpm', 'run', 'build:web'], core)
  source(core, true, coreHead)
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
  writeFileSync(
    webReceipt(core),
    JSON.stringify(
      {
        coreCommit,
        coreLock,
        command: 'corepack pnpm run build:web',
        sourceHashes: webSources.map(path => ({ path, sha256: hash(resolve(core, path)) })),
        artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path))
      },
      null,
      2
    ) + '\n'
  )
  return verifyOfficialSDK({ ...options, withWeb: true })
}

/** Compile only the declared host Node-API flock dependency for real writer-lock tests. */
export function prepareOfficialFlock(options) {
  const core = resolve(options.core)
  const coreHead = options.coreHead
  const { coreCommit, coreLock } = supportedCore(coreHead)
  const target = flockTarget(core)
  ownedSource(core, coreHead)
  const before = verifyOfficialSDK({ ...options, withFlock: false })
  const beforeWeb = existsSync(webReceipt(core)) ? verifyWeb(core, coreHead) : undefined
  if (json(resolve(core, 'package.json')).scripts['build:native-system'] !== flockScript) refuse('SDK_FLOCK_SOURCE_MISMATCH', 'official host-addon-only script')
  const headers = resolve(dirname(process.execPath), '../include/node')
  const headerPaths = ['node_api.h', 'node_api_types.h', 'js_native_api.h', 'js_native_api_types.h']
  for (const path of headerPaths) if (!existsSync(resolve(headers, path))) refuse('SDK_FLOCK_HEADERS_REQUIRED', resolve(headers, path))
  const compiler = target.libc === 'musl' ? 'musl-gcc' : 'cc'
  const tool = spawnSync(compiler, ['--version'], { encoding: 'utf8' })
  if (tool.error || tool.status !== 0) refuse('SDK_FLOCK_COMPILER_REQUIRED', `${compiler}: ${tool.error?.message ?? tool.stderr ?? tool.status}`)
  run('corepack', ['pnpm', 'run', 'build:native-system'], core)
  source(core, true, coreHead)
  const after = verifyOfficialSDK({ ...options, withFlock: false })
  if (JSON.stringify(before.artifacts) !== JSON.stringify(after.artifacts)) refuse('SDK_FLOCK_CHANGED_SDK', 'flock preparation changed SDK targets')
  if (beforeWeb && JSON.stringify(beforeWeb) !== JSON.stringify(verifyWeb(core, coreHead))) refuse('SDK_FLOCK_CHANGED_WEB', 'flock preparation changed static Web targets')
  if (!existsSync(resolve(core, target.path))) refuse('SDK_FLOCK_MATERIAL_REQUIRED', target.path)
  writeFileSync(
    flockReceipt(core),
    JSON.stringify(
      {
        coreCommit,
        coreLock,
        command: 'corepack pnpm run build:native-system',
        platform: target.platform,
        ...(target.libc ? { libc: target.libc } : {}),
        napi: target.napi,
        compiler: { command: compiler, version: tool.stdout.trim() },
        headers: headerPaths.map(path => ({ path: resolve(headers, path), sha256: hash(resolve(headers, path)) })),
        sourceHashes: target.sourcePaths.map(path => ({ path, sha256: hash(resolve(core, path)) })),
        artifact: { path: target.path, sha256: hash(resolve(core, target.path)) }
      },
      null,
      2
    ) + '\n'
  )
  return verifyOfficialSDK({ ...options, withFlock: true })
}

export function prepareOfficialSource(options) {
  const core = resolve(options.core)
  const coreHead = options.coreHead
  const { coreCommit } = supportedCore(coreHead)
  if (!existsSync(resolve(core, '.git'))) {
    if (!options.source) refuse('SDK_SOURCE_REQUIRED', 'supply --source for a new independent checkout')
    const release = acquireBuild({ operation: 'prepare', cwd: dirname(core), output: core })
    try {
      mkdirSync(dirname(core), { recursive: true })
      run('git', ['clone', '--config', 'core.autocrlf=false', '--no-checkout', '--no-hardlinks', options.source, core], dirname(core))
      run('git', ['checkout', '--detach', coreCommit], core)
      run('git', ['config', '--local', 'dsh.sdkPreparation', 'independent-fixed-core'], core)
    } finally {
      release()
    }
  }
  ownedSource(core, coreHead)
  return verifyOfficialSource(core, { coreHead })
}

export function prepareOfficialSDK(options) {
  const core = resolve(options.core)
  const coreHead = options.coreHead
  prepareOfficialSource(options)
  if (options.withFlock) flockTarget(core)
  const identity = sdkArtifactIdentity(coreHead)
  const reused = options.reusePrepared === true && verifySDKArtifacts(core, identity)
  const needsPreparation = !reused || (options.withWeb && !existsSync(webReceipt(core))) || (options.withFlock && !existsSync(flockReceipt(core)))
  const release = needsPreparation ? acquireBuild({ operation: 'sdk', cwd: core }) : () => {}
  try {
    if (needsPreparation) run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline'], core)
    if (!reused) {
      const tsc = resolve(core, 'node_modules/typescript/bin/tsc')
      run(process.execPath, ['--max-old-space-size=4096', tsc, '-b', 'tsconfig.host.json'], core)
      run('corepack', ['pnpm', 'exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE', 'host'], core)
      run(process.execPath, [tsc, '-b', 'tsconfig.client.json'], core)
      run('corepack', ['pnpm', 'exec', 'tsdown', '--config-loader', 'native', '--env.DSH_BUILD_FACE', 'client'], core)
      writeSDKArtifacts(core, identity)
    }
    if (options.withWeb) {
      if (reused && existsSync(webReceipt(core))) verifyWeb(core, coreHead)
      else prepareOfficialWeb({ ...options, withFlock: false })
    }
    if (options.withFlock) {
      if (reused && existsSync(flockReceipt(core))) verifyFlock(core, coreHead)
      else prepareOfficialFlock(options)
    }
    console.log(JSON.stringify({ stage: 'sdk-preparation', reused, core: coreHead }))
    return verifyOfficialSDK(options)
  } finally {
    release()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const value = name => {
      const i = args.indexOf(name)
      return i < 0 ? undefined : args[i + 1]
    }
    if (['--prepare', '--prepare-source', '--prepare-web', '--prepare-flock'].filter(mode => args.includes(mode)).length > 1)
      refuse('SDK_PREPARATION_MODE_CONFLICT', 'choose cold, web-only or flock-only preparation')
    const options = {
      core: value('--core') ?? '../../official-latest-standard',
      consumer: value('--consumer') ?? process.cwd(),
      source: value('--source'),
      coreHead: value('--core-head'),
      withWeb: args.includes('--with-web'),
      withFlock: args.includes('--with-flock'),
      reusePrepared: args.includes('--reuse-prepared')
    }
    const result = args.includes('--prepare-flock')
      ? prepareOfficialFlock(options)
      : args.includes('--prepare-web')
        ? prepareOfficialWeb(options)
        : args.includes('--prepare-source')
          ? prepareOfficialSource(options)
          : args.includes('--prepare')
            ? prepareOfficialSDK(options)
            : verifyOfficialSDK(options)
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
