import fs from 'node:fs'
import os from 'node:os'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { resolve, join } from 'node:path'
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { pathToFileURL, URL } from 'node:url'
import { Buffer } from 'node:buffer'
import { verifyOfficialSource, verifyOfficialSDK, prepareOfficialSDK, prepareOfficialWeb } from '../scripts/prepare-official-sdk.mjs'

const supported = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/supported-cores.json', import.meta.url), 'utf8'))
const alpha = supported.find(core => core.version === '0.2.1-alpha.1')
const rc = supported.find(core => core.version === '0.2.0-rc.2')

let checkout, selected
before(() => {
  checkout = mkdtempSync(join(tmpdir(), 'manage-sdk-input-'))
  const source = resolve(process.env.DSH_CORE_CHECKOUT ?? '../../official-latest-standard')
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' })
  assert.equal(head.status, 0, head.stderr)
  selected = supported.find(core => core.head === head.stdout.trim())
  assert.ok(selected, 'selected source must be registered')
  const result = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', source, checkout], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', selected.head], { cwd: checkout }).status, 0)
})
after(() => rmSync(checkout, { recursive: true, force: true }))

test('unprepared fixed Core refuses SDK verification without creating outputs', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-official-sdk.mjs', '--core', checkout, '--consumer', process.cwd(), '--core-head', selected.head], {
    encoding: 'utf8'
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SDK_MATERIAL_REQUIRED/)
  assert.equal(existsSync(join(checkout, 'node_modules')), false)
})

test('preparation refuses an existing checkout owned by another SDK consumer', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-official-sdk.mjs', '--prepare', '--core', checkout, '--consumer', process.cwd()], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SDK_PRIVATE_CHECKOUT_REQUIRED/)
  assert.equal(existsSync(join(checkout, 'node_modules')), false)
})

test('web-only preparation refuses an unowned checkout without installing or generating HTML', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-official-sdk.mjs', '--prepare-web', '--core', checkout, '--consumer', process.cwd()], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SDK_PRIVATE_CHECKOUT_REQUIRED/)
  assert.equal(existsSync(join(checkout, 'node_modules')), false)
  assert.equal(existsSync(join(checkout, 'apps/web/dist/index.html')), false)
})

test('flock-only preparation refuses an unsupported host or unowned checkout without generating outputs', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-official-sdk.mjs', '--prepare-flock', '--core', checkout, '--consumer', process.cwd()], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, ['linux', 'darwin'].includes(process.platform) ? /SDK_PRIVATE_CHECKOUT_REQUIRED/ : /SDK_FLOCK_UNSUPPORTED_PLATFORM/)
  assert.equal(existsSync(join(checkout, 'node_modules')), false)
  assert.equal(existsSync(join(checkout, `native/system/packages/${process.platform}-${process.arch}/bin/system.node`)), false)
})

test('flock preparation rejects an unsupported host before the Core script can return success', () => {
  const script = resolve('scripts/prepare-official-sdk.mjs')
  const program = `Object.defineProperty(process, 'platform', { value: 'win32' }); process.argv = ['node', ${JSON.stringify(script)}, '--prepare-flock', '--core', ${JSON.stringify(checkout)}, '--consumer', ${JSON.stringify(process.cwd())}]; import(${JSON.stringify(pathToFileURL(script).href)});`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /SDK_FLOCK_UNSUPPORTED_PLATFORM/)
  assert.equal(existsSync(join(checkout, 'node_modules')), false)
})

test('registered rc.2 source is admitted only when the caller binds its matching Core head', () => {
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', rc.head], { cwd: checkout }).status, 0)
  try {
    const receipt = verifyOfficialSource(checkout, { coreHead: rc.head })
    assert.equal(receipt.commit, rc.head)
    assert.equal(receipt.packageManager, 'pnpm@11.7.0')
    assert.throws(() => verifyOfficialSource(checkout, { coreHead: alpha.head }), /SDK_CORE_MISMATCH/)
    assert.throws(() => verifyOfficialSource(checkout, { coreHead: '0'.repeat(40) }), /SDK_CORE_UNSUPPORTED/)
    assert.equal(existsSync(join(checkout, 'node_modules')), false)
  } finally {
    assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', selected.head], { cwd: checkout }).status, 0)
  }
})

test('changed original lock is refused before consumer installation or SDK preparation', () => {
  const lock = join(checkout, 'pnpm-lock.yaml')
  const original = readFileSync(lock)
  try {
    writeFileSync(lock, Buffer.concat([original, Buffer.from('\n# unauthorized lock change\n')]))
    assert.throws(() => verifyOfficialSource(checkout, { coreHead: selected.head }), /SDK_LOCK_MISMATCH/)
    assert.equal(existsSync(join(checkout, 'node_modules')), false)
  } finally {
    writeFileSync(lock, original)
  }
})

test('SDK applicability follows selected Core package identity while existing packages still require outputs', () => {
  const consumer = join(checkout, '.git', 'consumer-fixture')
  mkdirSync(consumer)
  const alias = '@deepseek-ai/dsh-tool-schedule'
  const target = '../../official-latest-standard/packages/schedule/tool-schedule/lib/types/index.d.ts'
  const presentAlias = selected.version === '0.2.1-alpha.1' ? alias : '@deepseek-ai/cordis'
  const presentTarget = selected.version === '0.2.1-alpha.1' ? target : '../../official-latest-standard/vendor/cordis/lib/types/index.d.ts'
  writeFileSync(join(consumer, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: { [presentAlias]: [presentTarget] } } }))
  assert.throws(() => verifyOfficialSDK({ core: checkout, consumer, coreHead: selected.head }), /SDK_MATERIAL_REQUIRED/)
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', rc.head], { cwd: checkout }).status, 0)
  try {
    writeFileSync(join(consumer, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: { [alias]: [target] } } }))
    const receipt = verifyOfficialSDK({ core: checkout, consumer, coreHead: rc.head })
    assert.deepEqual(receipt.notApplicable, [{ alias, path: target, reason: 'package absent from the selected fixed Core Git source' }])
    assert.equal(receipt.artifacts.length, 0)
    writeFileSync(join(consumer, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: { '@deepseek-ai/dsh-schedule': [target] } } }))
    assert.throws(() => verifyOfficialSDK({ core: checkout, consumer, coreHead: rc.head }), /SDK_PACKAGE_PATH_MISMATCH/)
  } finally {
    assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', selected.head], { cwd: checkout }).status, 0)
  }
})

test('checkout line-ending conversion is refused rather than normalizing the original lock', () => {
  const lock = join(checkout, 'pnpm-lock.yaml')
  const original = readFileSync(lock)
  try {
    writeFileSync(lock, original.toString().replace(/\n/g, '\r\n'))
    assert.throws(() => verifyOfficialSource(checkout, { coreHead: selected.head }), /SDK_LOCK_MISMATCH/)
  } finally {
    writeFileSync(lock, original)
  }
})

test('cold SDK clone preserves lock bytes even when the runner defaults to CRLF', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'manage-sdk-line-endings-'))
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 100 * 1024 ** 3, bsize: 1 }))
  t.mock.method(os, 'tmpdir', () => fixture)
  const originalGlobalConfig = process.env.GIT_CONFIG_GLOBAL
  try {
    const upstream = join(fixture, 'upstream')
    const ordinary = join(fixture, 'ordinary')
    const owned = join(fixture, 'owned')
    const defaultOwned = join(fixture, 'default-owned')
    mkdirSync(upstream)
    const git = (args, cwd = upstream) => {
      const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      return result.stdout.trim()
    }
    git(['init', '--quiet'])
    writeFileSync(join(upstream, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
    git(['add', 'pnpm-lock.yaml'])
    git(['-c', 'user.name=SDK fixture', '-c', 'user.email=sdk-fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
    const head = git(['rev-parse', 'HEAD'])
    const globalConfig = join(fixture, 'global.gitconfig')
    writeFileSync(globalConfig, '[core]\n  autocrlf = true\n')
    process.env.GIT_CONFIG_GLOBAL = globalConfig
    git(['clone', '--quiet', upstream, ordinary], fixture)
    assert.equal(readFileSync(join(ordinary, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9.0\r\n')
    // An unregistered source must stop before installation; its clone still exposes the checkout policy.
    assert.throws(() => prepareOfficialSDK({ core: owned, consumer: process.cwd(), source: upstream, coreHead: selected.head }), /SDK_COMMAND_FAILED/)
    assert.equal(git(['config', '--local', '--get', 'core.autocrlf'], owned), 'false')
    git(['checkout', '--quiet', '--detach', head], owned)
    assert.equal(readFileSync(join(owned, 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9.0\n')
    assert.equal(existsSync(join(owned, 'node_modules')), false)
    const current = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/current-core.json', import.meta.url), 'utf8'))
    assert.throws(
      () => prepareOfficialSDK({ core: defaultOwned, consumer: process.cwd(), source: upstream }),
      error => error.message.includes(`SDK_COMMAND_FAILED: git checkout --detach ${current.adaptation}`)
    )
    assert.equal(existsSync(join(defaultOwned, 'node_modules')), false)
  } finally {
    if (originalGlobalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL
    else process.env.GIT_CONFIG_GLOBAL = originalGlobalConfig
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('registered private security candidate retains source admission without creating or accepting missing SDK inputs', () => {
  const privateCore = supported.find(core => core.id === 'private-core-high-20261011')
  assert.ok(privateCore, 'the private security source remains in the single Core authority')
  const missing = join(checkout, '.git', 'missing-private-core')
  assert.throws(() => verifyOfficialSource(missing, { coreHead: privateCore.head }), /SDK_SOURCE_REQUIRED/)
  assert.equal(existsSync(missing), false)
})

test('omitted Core head selects the registered current adaptation while explicit official axes remain admitted', () => {
  const current = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/current-core.json', import.meta.url), 'utf8'))
  const defaultCore = supported.find(core => core.head === current.adaptation)
  assert.ok(defaultCore, 'current adaptation must have a registered source and toolchain')
  assert.notEqual(defaultCore.head, selected.head)
  const observed = verifyOfficialSource(checkout, { coreHead: selected.head })
  assert.equal(observed.commit, selected.head)
  assert.equal(observed.packageManager, selected.packageManager)
  assert.throws(() => verifyOfficialSource(checkout), /SDK_CORE_MISMATCH/)
  assert.throws(() => verifyOfficialSDK({ core: checkout, consumer: process.cwd() }), /SDK_CORE_MISMATCH/)
  const owner = spawnSync('git', ['config', '--local', 'dsh.sdkPreparation', 'independent-fixed-core'], { cwd: checkout })
  assert.equal(owner.status, 0)
  try {
    assert.throws(() => prepareOfficialSDK({ core: realpathSync(checkout), consumer: process.cwd() }), /SDK_CORE_MISMATCH/)
    assert.equal(existsSync(join(checkout, 'node_modules')), false)
  } finally {
    assert.equal(spawnSync('git', ['config', '--local', '--unset', 'dsh.sdkPreparation'], { cwd: checkout }).status, 0)
  }
})

test('SDK artifact reuse installs cold dependencies and only reuses a matching installation receipt', t => {
  const fixture = mkdtempSync(join(tmpdir(), 'sdk-dependency-boundary-'))
  t.after(() => rmSync(fixture, { recursive: true, force: true }))
  const hook = join(fixture, 'commands.mjs')
  const calls = join(fixture, 'install-calls')
  const cache = new URL('../scripts/sdk-artifact-cache.mjs', import.meta.url).href
  writeFileSync(
    hook,
    `
    import fs from 'node:fs'; import os from 'node:os'; import cp from 'node:child_process';
    import { join, dirname } from 'node:path'; import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const core = ${JSON.stringify(checkout)};
    const manifest = JSON.parse(fs.readFileSync(join(core, 'package.json'), 'utf8'));
    fs.statfsSync = () => ({ bavail: 100 * 1024 ** 3, bsize: 1 });
    os.tmpdir = () => ${JSON.stringify(fixture)};
    const original = cp.spawnSync;
    cp.spawnSync = (command, args, options) => {
      if (!['corepack', 'corepack.cmd'].includes(command)) return original(command, args, options);
      if (args.includes('--version')) return { status: 0, stdout: manifest.packageManager.slice('pnpm@'.length) };
      if (!args.includes('install')) throw Error('UNEXPECTED_SDK_BUILD_COMMAND');
      fs.appendFileSync(${JSON.stringify(calls)}, 'install' + String.fromCharCode(10));
      fs.mkdirSync(join(core, 'node_modules'), { recursive: true });
      fs.writeFileSync(join(core, 'node_modules/.modules.yaml'), 'fixture');
      for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
        const file = join(core, 'node_modules', name, 'package.json');
        fs.mkdirSync(dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ name, version: '1.0.0' }));
      }
      return { status: 0 };
    };
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url !== ${JSON.stringify(cache)}) return next(url, context);
      return { format: 'module', shortCircuit: true, source: 'export const verifySDKArtifacts = () => true; export const writeSDKArtifacts = () => {};' };
    } });
  `
  )
  const own = spawnSync('git', ['config', '--local', 'dsh.sdkPreparation', 'independent-fixed-core'], { cwd: checkout, encoding: 'utf8' })
  assert.equal(own.status, 0, own.stderr)
  const run = () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        hook,
        'scripts/prepare-official-sdk.mjs',
        '--prepare',
        '--reuse-prepared',
        '--core',
        realpathSync(checkout),
        '--consumer',
        process.cwd(),
        '--core-head',
        selected.head
      ],
      { encoding: 'utf8' }
    )
    assert.match(result.stderr, /SDK_MATERIAL_REQUIRED/, result.stdout + result.stderr)
    return result.stdout
  }
  assert.match(run(), /"dependenciesReused":false/)
  assert.equal(readFileSync(calls, 'utf8'), 'install\n')
  assert.match(run(), /"dependenciesReused":true/)
  assert.equal(readFileSync(calls, 'utf8'), 'install\n')
  const manifest = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
  const dependency = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })[0]
  fs.unlinkSync(join(checkout, 'node_modules', dependency, 'package.json'))
  assert.match(run(), /"dependenciesReused":false/)
  assert.equal(readFileSync(calls, 'utf8'), 'install\ninstall\n')
})

test('Web preparation uses the Core official client environment and rejects a cached local build', t => {
  if (!JSON.parse(readFileSync(join(checkout, 'package.json'))).scripts['build:official']) return t.skip('selected Core has no named client build profile')
  const consumer = join(checkout, '.git', 'web-profile-consumer')
  mkdirSync(consumer)
  writeFileSync(join(consumer, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: {} } }))
  const own = spawnSync('git', ['config', '--local', 'dsh.sdkPreparation', 'independent-fixed-core'], { cwd: checkout, encoding: 'utf8' })
  assert.equal(own.status, 0, own.stderr)
  const originalSpawn = childProcess.spawnSync
  const previous = process.env.DSH_CLIENT_TITLE
  process.env.DSH_CLIENT_TITLE = 'Ambient local title'
  let buildEnvironment
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    if (String(command).endsWith(process.platform === 'win32' ? 'corepack.cmd' : 'corepack') && args.join(' ') === 'pnpm run build:web') {
      buildEnvironment = options.env
      const dist = join(checkout, 'apps/web/dist')
      mkdirSync(join(dist, 'assets'), { recursive: true })
      writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index.js"></script>')
      writeFileSync(join(dist, 'assets/index.js'), 'export const ready = true;')
      return { status: 0, stdout: '', stderr: '' }
    }
    return originalSpawn(command, args, options)
  })
  syncBuiltinESMExports()
  try {
    const options = { core: realpathSync(checkout), consumer, coreHead: selected.head }
    const result = prepareOfficialWeb(options)
    assert.equal(buildEnvironment?.DSH_CLIENT_BUILD_PROFILE, 'official')
    assert.equal(buildEnvironment?.DSH_CLIENT_TITLE, 'DeepSeek Harness')
    assert.equal(buildEnvironment?.DSH_CLIENT_COMMIT_HASH, selected.head.slice(0, 7))
    assert.equal(buildEnvironment?.DSH_CLIENT_VERSION, JSON.parse(readFileSync(join(checkout, 'package.json'))).version)
    assert.equal(buildEnvironment?.DSH_BUILD_CLIENT_PROFILE, undefined)
    assert.equal(result.web.clientEnvironment.DSH_CLIENT_BUILD_PROFILE, 'official')
    const receipt = join(checkout, '.git', 'dsh-sdk-web.json')
    const record = JSON.parse(readFileSync(receipt, 'utf8'))
    writeFileSync(receipt, JSON.stringify({ ...record, clientEnvironment: { ...record.clientEnvironment, DSH_CLIENT_BUILD_PROFILE: 'local' } }))
    assert.throws(() => verifyOfficialSDK({ ...options, withWeb: true }), /SDK_WEB_SOURCE_MISMATCH/)
    const legacy = { ...record }
    delete legacy.clientEnvironment
    writeFileSync(receipt, JSON.stringify(legacy))
    assert.throws(() => verifyOfficialSDK({ ...options, withWeb: true }), /SDK_WEB_SOURCE_MISMATCH/)
    writeFileSync(receipt, JSON.stringify(record))
    assert.equal(verifyOfficialSDK({ ...options, withWeb: true }).web.status, 'prepared')
  } finally {
    if (previous === undefined) delete process.env.DSH_CLIENT_TITLE
    else process.env.DSH_CLIENT_TITLE = previous
    t.mock.restoreAll()
    syncBuiltinESMExports()
  }
})
