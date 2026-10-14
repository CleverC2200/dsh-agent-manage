import test from 'node:test'
import process from 'node:process'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifySDKArtifacts, writeSDKArtifacts, sdkCachePaths } from '../scripts/sdk-artifact-cache.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sdk-cache-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  mkdirSync(join(root, 'packages/host/lib'), { recursive: true })
  writeFileSync(join(root, 'packages/host/package.json'), '{"name":"@fixture/host"}')
  execFileSync('git', ['-C', root, 'add', 'packages/host/package.json'])
  const file = join(root, 'packages/host/lib/index.js')
  writeFileSync(file, 'export const value = 1;')
  return {
    root,
    file,
    identity: { coreCommit: 'a'.repeat(40), coreLock: 'b'.repeat(64), platform: process.platform, arch: process.arch, node: process.version, builder: 'c'.repeat(64) }
  }
}
test('a cache miss requests preparation and a verified byte inventory admits reuse', t => {
  const f = fixture(t)
  assert.equal(verifySDKArtifacts(f.root, f.identity), false)
  writeSDKArtifacts(f.root, f.identity)
  assert.equal(verifySDKArtifacts(f.root, f.identity), true)
})
test('changed, missing and additional artifacts cannot receive a cached pass', t => {
  const f = fixture(t)
  writeSDKArtifacts(f.root, f.identity)
  writeFileSync(f.file, 'changed')
  assert.throws(() => verifySDKArtifacts(f.root, f.identity), /SDK_CACHE_ARTIFACT_CHANGED/)
  unlinkSync(f.file)
  assert.throws(() => verifySDKArtifacts(f.root, f.identity), /SDK_CACHE_ARTIFACTS_REQUIRED/)
  writeFileSync(f.file, 'export const value = 1;')
  writeFileSync(join(f.root, 'packages/host/lib/extra.js'), 'extra')
  assert.throws(() => verifySDKArtifacts(f.root, f.identity), /SDK_CACHE_ARTIFACT_CHANGED/)
})
test('different Core, lock, Node, architecture and builder refuse reuse', t => {
  const f = fixture(t)
  writeSDKArtifacts(f.root, f.identity)
  for (const key of Object.keys(f.identity)) assert.throws(() => verifySDKArtifacts(f.root, { ...f.identity, [key]: 'changed' }), /SDK_CACHE_IDENTITY_MISMATCH/)
})
test('dependency links are not accepted as produced SDK artifact bytes', t => {
  const f = fixture(t)
  symlinkSync(f.file, join(f.root, 'packages/host/lib/link.js'))
  assert.throws(() => writeSDKArtifacts(f.root, f.identity), /SDK_CACHE_ARTIFACT_TYPE/)
})
test('cache paths name only tracked package outputs without dependency traversal or globs', t => {
  const f = fixture(t)
  mkdirSync(join(f.root, 'packages/host/node_modules/unrelated'), { recursive: true })
  writeFileSync(join(f.root, 'packages/host/node_modules/unrelated/package.json'), '{}')
  execFileSync('git', ['-C', f.root, 'add', 'packages/host/node_modules/unrelated/package.json'])
  const paths = sdkCachePaths(f.root)
  assert.ok(paths.includes(join(f.root, 'packages/host/lib')))
  assert.ok(paths.includes(join(f.root, '.git/dsh-sdk-artifacts.json')))
  assert.ok(paths.every(path => !path.includes('node_modules') && !path.includes('*')))
})
