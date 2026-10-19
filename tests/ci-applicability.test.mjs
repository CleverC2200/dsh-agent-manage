import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

function select(t, { applicability = 'source', changes = [], files = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'manage-ci-applicability-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const plan = join(root, 'plan.json')
  const output = join(root, 'output')
  writeFileSync(plan, JSON.stringify({ schemaVersion: 1, repo: 'dsh-agent-manage', applicability, changes, files }))
  const child = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--matrix', '--plan', plan], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } })
  assert.equal(child.status, 0, child.stderr)
  return { matrix: JSON.parse(child.stdout), output: readFileSync(output, 'utf8') }
}

test('documentation plans retain one source-check job without Windows or dependency security jobs', t => {
  const { matrix, output } = select(t, { applicability: 'docs', changes: [{ repo: 'dsh-agent-manage', file: 'README.md' }] })
  assert.deepEqual(
    matrix.include.map(entry => entry.phase),
    ['quality']
  )
  assert.match(output, /audit-applicable=false/)
  assert.match(output, /dependency-review-applicable=false/)
  assert.match(output, /codeql-applicable=false/)
})

test('ordinary CSS and business prompt changes do not rerun dependency or Windows checks', t => {
  for (const file of ['src/client/market.module.css', 'business-resources/orchestration/prompt.md']) {
    const { matrix, output } = select(t, { changes: [{ repo: 'dsh-agent-manage', file }] })
    assert.deepEqual(
      matrix.include.map(entry => entry.phase),
      ['quality']
    )
    assert.match(output, /applicability=source/)
    assert.match(output, /audit-applicable=false/)
    assert.match(output, /dependency-review-applicable=false/)
  }
})

test('affected archive consumers and SDK inputs retain the Windows lane', t => {
  for (const change of [
    { files: ['tests/private-archive.test.ts'] },
    { changes: [{ repo: 'dsh-agent-manage', file: 'scripts/prepare-official-sdk.mjs' }] },
    { changes: [{ repo: 'dsh-gea-plugin', file: 'scripts/supported-cores.json' }] }
  ])
    assert.deepEqual(
      select(t, change).matrix.include.map(entry => entry.phase),
      ['quality', 'archives']
    )
})

test('dependency inputs and audit implementation activate only their applicable security jobs', t => {
  const own = select(t, { changes: [{ repo: 'dsh-agent-manage', file: 'pnpm-lock.yaml' }] })
  assert.match(own.output, /audit-applicable=true/)
  assert.match(own.output, /dependency-review-applicable=true/)
  const peer = select(t, { changes: [{ repo: 'dsh-agent-workbench', file: 'package-lock.json' }] })
  assert.match(peer.output, /audit-applicable=true/)
  assert.match(peer.output, /dependency-review-applicable=false/)
  const audit = select(t, { changes: [{ repo: 'dsh-agent-manage', file: 'scripts/run-quality-ci.mjs' }] })
  assert.match(audit.output, /audit-applicable=true/)
  assert.match(audit.output, /dependency-review-applicable=false/)
})

test('CodeQL follows own executable or scanner inputs and ignores pure resources and peer source', t => {
  for (const [repo, file, expected] of [
    ['dsh-agent-manage', 'src/client/index.ts', true],
    ['dsh-agent-manage', '.github/workflows/codeql.yml', true],
    ['dsh-agent-manage', 'src/client/market.module.css', false],
    ['dsh-agent-manage', 'business-resources/orchestration/prompt.md', false],
    ['dsh-gea-plugin', 'src/index.ts', false]
  ])
    assert.match(select(t, { changes: [{ repo, file }] }).output, new RegExp(`codeql-applicable=${expected}`))
})
