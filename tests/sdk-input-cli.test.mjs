import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import process from 'node:process'

let checkout
before(() => {
  checkout = mkdtempSync(join(tmpdir(), 'manage-sdk-input-'))
  const result = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', resolve('../../official-latest-standard'), checkout], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(spawnSync('git', ['checkout', '--quiet', '--detach', '5badb15009ae1756c3afe0ae0cef1faafc290ccc'], { cwd: checkout }).status, 0)
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
