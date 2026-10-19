import test from 'node:test'
import process from 'node:process'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inspectDownloadCache, downloadCachePaths } from '../scripts/download-cache.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manage-download-cache-')))
  t.after(() => rmSync(root, { force: true, recursive: true }))
  mkdirSync(join(root, 'store'))
  writeFileSync(join(root, 'store/package'), 'download')
  return root
}

test('download caches are admitted only within both byte and traversal budgets', t => {
  const root = fixture(t)
  assert.equal(inspectDownloadCache([root]).ready, true)
  assert.equal(inspectDownloadCache([root, root]).bytes, 8)
  assert.equal(inspectDownloadCache([root], { maxBytes: 7 }).reason, 'byte-budget')
  assert.equal(inspectDownloadCache([root], { maxEntries: 2 }).reason, 'entry-budget')
  assert.equal(inspectDownloadCache([join(root, 'absent')]).ready, false)
})

test('a linked entry or root cannot expand the download archive beyond its inspected paths', t => {
  const root = fixture(t)
  symlinkSync(join(root, 'store'), join(root, 'linked'), 'junction')
  assert.equal(inspectDownloadCache([join(root, 'linked')]).ready, false)
  assert.equal(inspectDownloadCache([root]).reason, 'unsupported-file-type')
  symlinkSync(join(root, 'absent'), join(root, 'dangling'), 'junction')
  assert.equal(inspectDownloadCache([join(root, 'dangling')]).reason, 'linked-root')
})

test('the fixed download set excludes project and execution trees and skips the whole save when over budget', t => {
  const root = fixture(t)
  const store = join(root, 'pnpm')
  mkdirSync(join(store, 'files'), { recursive: true })
  mkdirSync(join(root, '.npm/_cacache'), { recursive: true })
  writeFileSync(join(store, 'files/package'), '12345678')
  writeFileSync(join(store, 'index.db'), '12')
  writeFileSync(join(root, '.npm/_cacache/package'), '1234567')
  symlinkSync(join(root, 'store'), join(store, 'projects'), 'junction')
  const paths = downloadCachePaths(root, store)
  assert.ok(paths.every(path => !path.endsWith('projects') && !path.endsWith('_npx')))
  const admitted = inspectDownloadCache(paths, { maxBytes: 17, maxEntries: 20 })
  assert.equal(admitted.ready, true)
  assert.equal(admitted.bytes, 17)
  assert.deepEqual(admitted.paths, paths)
  const overBudget = inspectDownloadCache(paths, { maxBytes: 16, maxEntries: 20 })
  assert.equal(overBudget.ready, false)
  assert.equal(overBudget.reason, 'byte-budget')
  assert.deepEqual(overBudget.paths, [])
  const overEntries = inspectDownloadCache(paths, { maxEntries: 3 })
  assert.equal(overEntries.ready, false)
  assert.equal(overEntries.entries, 3)
})

test('the path command retains absent roots and produces the same cache identity before and after installs', t => {
  const root = fixture(t)
  const store = join(root, 'pnpm')
  const command = output => {
    execFileSync(process.execPath, [resolve('scripts/download-cache.mjs'), '--github-paths'], {
      env: { ...process.env, PNPM_STORE_PATH: store, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge' },
      stdio: 'pipe'
    })
    return readFileSync(output, 'utf8')
  }
  const before = command(join(root, 'before-output'))
  mkdirSync(join(store, 'files'), { recursive: true })
  writeFileSync(join(store, 'files/package'), 'download')
  writeFileSync(join(store, 'index.db'), 'index')
  assert.equal(command(join(root, 'after-output')), before)
  assert.equal(before, `store=${store}\npaths<<DOWNLOAD_PATHS\n${downloadCachePaths(homedir(), store).join('\n')}\nDOWNLOAD_PATHS\n`)
})

test('the download producer refuses pull requests and non-main refs before reading caches', () => {
  for (const [event, ref] of [
    ['pull_request', 'refs/pull/1/merge'],
    ['push', 'refs/heads/feature'],
    ['workflow_dispatch', 'refs/heads/main']
  ]) {
    assert.throws(
      () => execFileSync(process.execPath, [resolve('scripts/download-cache.mjs')], { env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref }, stdio: 'pipe' }),
      /DOWNLOAD_CACHE_MAIN_PUSH_REQUIRED/
    )
  }
})
