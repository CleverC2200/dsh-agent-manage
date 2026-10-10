import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const call = (phase, env) => spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', phase], { encoding: 'utf8', env: { ...process.env, ...env } })
test('fork scope is rejected before preparation', () => {
  const result = call('scope', { QUALITY_SCOPE_ALLOWED: 'false' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CANDIDATE_SCOPE_REQUIRED/)
})

test('final quality aggregate rejects failure, missing, skipped and cancelled quality jobs', () => {
  for (const state of ['failure', 'cancelled', 'skipped', '']) {
    const result = call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: state, QUALITY_AUDIT_RESULT: 'success' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /QUALITY_REQUIRED/)
  }
  assert.equal(call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success', QUALITY_AUDIT_RESULT: 'success' }).status, 0)
})

test('quality result does not claim dependency audit coverage', () => {
  assert.equal(call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success', QUALITY_AUDIT_RESULT: 'failure' }).status, 0)
})

test('CI input binds the event and registered Core and refuses missing or unregistered Core heads', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ci-input-'))
  try {
    const matrix = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--matrix'], { encoding: 'utf8' })
    assert.equal(matrix.status, 0, matrix.stderr)
    const lanes = JSON.parse(matrix.stdout).include
    assert.deepEqual([...new Set(lanes.map(lane => lane.coreVersion))].sort(), ['0.2.0-rc.2', '0.2.1-alpha.1'])
    assert.equal(lanes.filter(lane => lane.phase === 'quality' && lane.os === 'ubuntu-latest').length, 2)
    assert.equal(lanes.filter(lane => lane.phase === 'archives' && lane.os === 'windows-latest').length, 2)
    const args = ['scripts/write-ci-input.mjs', '--root', root, '--sha', 'a'.repeat(40)]
    for (const tail of [[], ['--core-head', '0'.repeat(40)]]) {
      const bad = spawnSync(process.execPath, [...args, ...tail], { encoding: 'utf8' })
      assert.notEqual(bad.status, 0)
      assert.match(bad.stderr, /CANDIDATE_CORE_REQUIRED/)
      assert.equal(existsSync(join(root, 'candidate-input.json')), false)
    }
    const good = spawnSync(process.execPath, [...args, '--core-head', lanes[0].coreHead], { encoding: 'utf8' })
    assert.equal(good.status, 0, good.stderr)
    const input = JSON.parse(readFileSync(join(root, 'candidate-input.json'), 'utf8'))
    assert.equal(input.core, lanes[0].coreHead)
    assert.equal(input.repositories.find(repo => repo.repo === 'dsh-agent-manage').head, 'a'.repeat(40))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
