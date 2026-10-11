import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { Buffer } from 'node:buffer'

const call = (phase, env) => spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', phase], { encoding: 'utf8', env: { ...process.env, ...env } })
test('fork scope is rejected before preparation', () => {
  const result = call('scope', { QUALITY_SCOPE_ALLOWED: 'false' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CANDIDATE_SCOPE_REQUIRED/)
})

test('final aggregate rejects skipped and cancelled jobs', () => {
  for (const state of ['failure', 'cancelled', 'skipped', '']) {
    const result = call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: state, QUALITY_AUDIT_RESULT: 'success' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /QUALITY_REQUIRED/)
  }
  assert.equal(call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success', QUALITY_AUDIT_RESULT: 'success' }).status, 0)
})

// Execute the runner's actual command boundary with a real successful child that changes the input.
test('a successful final child cannot change frozen input unnoticed', async t => {
  const fs = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { runInNewContext } = await import('node:vm')
  const root = fs.mkdtempSync(join(tmpdir(), 'quality-final-child-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const input = join(root, 'group.json')
  const bytes = Buffer.from('{"frozen":true}\n')
  fs.writeFileSync(input, bytes)
  const source = fs.readFileSync('scripts/run-quality-ci.mjs', 'utf8')
  const commands = source.slice(source.indexOf('function refuse('), source.indexOf('\ntry {'))
  const finalGroup = {
    verifyUnchanged() {
      if (!bytes.equals(fs.readFileSync(input))) throw Error('CANDIDATE_INPUT_CHANGED')
    }
  }
  const invoke = "run(process.execPath, ['-e', \"require('node:fs').appendFileSync(process.argv[1], 'changed')\", input]);"
  assert.throws(() => runInNewContext(commands + '\n' + invoke, { process, spawnSync, finalGroup, input }), /CANDIDATE_INPUT_CHANGED/)
  assert.notDeepEqual(fs.readFileSync(input), bytes, 'the real child must have changed the bytes')
})
