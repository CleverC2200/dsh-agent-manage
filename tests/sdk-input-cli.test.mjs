import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { pathToFileURL, URL } from 'node:url'
import { Buffer } from 'node:buffer'
import { verifyOfficialSource } from '../scripts/prepare-official-sdk.mjs'

const supported = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/supported-cores.json', import.meta.url), 'utf8'))
const alpha = supported.find(core => core.version === '0.2.1-alpha.1')
const rc = supported.find(core => core.version === '0.2.0-rc.2')

let checkout
before(() => {
  checkout = mkdtempSync(join(tmpdir(), 'manage-sdk-input-'))
  const result = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', resolve(process.env.DSH_CORE_CHECKOUT ?? '../../official-latest-standard'), checkout], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', alpha.head], { cwd: checkout }).status, 0)
})
after(() => rmSync(checkout, { recursive: true, force: true }))

test('unprepared fixed Core refuses SDK verification without creating outputs', () => {
  const result = spawnSync(process.execPath, ['scripts/prepare-official-sdk.mjs', '--core', checkout, '--consumer', process.cwd()], { encoding: 'utf8' })
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
    assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', alpha.head], { cwd: checkout }).status, 0)
  }
})

test('changed original lock is refused before consumer installation or SDK preparation', () => {
  const lock = join(checkout, 'pnpm-lock.yaml')
  const original = readFileSync(lock)
  try {
    writeFileSync(lock, Buffer.concat([original, Buffer.from('\n# unauthorized lock change\n')]))
    assert.throws(() => verifyOfficialSource(checkout, { coreHead: alpha.head }), /SDK_LOCK_MISMATCH/)
    assert.equal(existsSync(join(checkout, 'node_modules')), false)
  } finally {
    writeFileSync(lock, original)
  }
})
