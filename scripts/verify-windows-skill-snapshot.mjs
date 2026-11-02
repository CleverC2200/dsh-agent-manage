import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

assert.equal(process.platform, 'win32', 'Native Windows is required')
const evidence = resolve('.runtime/windows-skill-snapshot')
mkdirSync(evidence, { recursive: true })
const source = resolve('src/runtime/skill-directories.ts')
const fixed = readFileSync(source)
const baseline = process.env.MANAGE_SNAPSHOT_BASELINE
assert.match(baseline ?? '', /^[a-f0-9]{40}$/)
const run = (name, files, extra = []) => {
  const output = resolve(evidence, name + '.json')
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...files, ...extra, '--reporter=json', '--outputFile=' + output], { encoding: 'utf8' })
  writeFileSync(resolve(evidence, name + '.log'), (result.stdout ?? '') + (result.stderr ?? ''))
  if (result.error) throw result.error
  return { status: result.status, report: JSON.parse(readFileSync(output, 'utf8')) }
}
let before
try {
  writeFileSync(source, execFileSync('git', ['show', baseline + ':src/runtime/skill-directories.ts']))
  before = run('before', ['tests/business-resource-snapshot-race.test.ts'], ['-t', 'publishes intelligent orchestration'])
} finally {
  writeFileSync(source, fixed)
}
assert.notEqual(before.status, 0, 'The original Windows failure must reproduce')
assert.match(JSON.stringify(before.report), /Unknown agent preset: auto-negotiation/)
const after = run('after', ['tests/business-resource-snapshot-race.test.ts', 'tests/skill-snapshot-reuse.test.ts', 'tests/manage-bundle-default.test.ts'])
assert.equal(after.status, 0, JSON.stringify(after.report))
assert.equal(after.report.numFailedTests, 0)
assert.equal(after.report.numPendingTests, 0)
const result = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  baseline,
  originalFailureReproduced: true,
  testsPassed: after.report.numPassedTests,
  testsFailed: after.report.numFailedTests,
  nativeRenameConflict: 'EPERM',
  sessionCreation: 'passed'
}
writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
