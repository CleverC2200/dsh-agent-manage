import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'

// Child-process completion is the CLI seam; real client/Host lanes run separately.
const files = {
  'standard-skill': { 'standard-preset': 11, 'skill-preset': 5, 'manage-cold-boot': 6, 'manage-settings': 1, 'bundled-sales-skills': 2, 'manage-bundle-default': 1 },
  client: { 'standard-preset-draft': 1, 'preset-catalog-client': 1, 'skill-preset-client': 1, 'base-preset-client': 1, 'sales-preset-client': 2, 'inventory-family-client': 3 },
  gea: { 'business-admission-gea': 4, 'standard-preset-gea': 11, 'skill-preset-gea': 1, 'sales-preset-gea': 11, 'inventory-family-preset': 13 }
}
function run(change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), 'preset-cli-'))
  try {
    const reports = Object.fromEntries(
      Object.entries(files).map(([phase, cases]) => [
        phase,
        {
          success: true,
          numPassedTests: Object.values(cases).reduce((a, b) => a + b, 0),
          numFailedTests: 0,
          numPendingTests: 0,
          testResults: Object.entries(cases).map(([file, count]) => ({
            name: resolve(`tests/${file}.test.ts`),
            status: 'passed',
            assertionResults: Array.from({ length: count }, (_, i) => ({ fullName: `${file} case ${i}`, status: 'passed' }))
          }))
        }
      ])
    )
    for (const [phase, report] of Object.entries(reports)) writeFileSync(join(root, `${phase}-vitest.json`), JSON.stringify(report))
    change(reports)
    const fixture = join(root, 'reports.json')
    writeFileSync(fixture, JSON.stringify(reports))
    const hook = join(root, 'child-boundary.mjs')
    writeFileSync(
      hook,
      `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; import { readFileSync, writeFileSync } from 'node:fs';
      cp.spawnSync = (_command, args) => {
        const report = args.find(arg => arg.startsWith('--outputFile.json=')).split('=').slice(1).join('=');
        const phase = report.split('/').at(-1).replace('-vitest.json', '');
        const value = JSON.parse(readFileSync(process.env.CAPABILITY_REPORT_FIXTURE, 'utf8'))[phase];
        if (!value.noReport) writeFileSync(report, JSON.stringify(value));
        return { status: 0, stdout: '', stderr: '' };
      }; syncBuiltinESMExports();`
    )
    const child = spawnSync(process.execPath, ['--import', hook, 'scripts/check-preset-capabilities.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, CAPABILITY_REPORT_FIXTURE: fixture, PRESET_EVIDENCE_DIR: root }
    })
    return { ...child, receipt: JSON.parse(readFileSync(join(root, 'capability-quality.json'), 'utf8')) }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('capability CLI accepts complete passed required files', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.receipt.passed, true)
})

test('capability CLI rejects a skipped required case even when Vitest reports success', () => {
  const result = run(reports => {
    reports.gea.testResults[0].assertionResults[0].status = 'pending'
    reports.gea.numPendingTests = 1
  })
  assert.equal(result.status, 1)
  assert.equal(result.receipt.passed, false)
})

test('capability CLI rejects a missing required file despite other passing files', () => {
  const result = run(reports => {
    reports.client.testResults.pop()
  })
  assert.equal(result.status, 1)
})

test('capability CLI rejects a missing required case inside a present file', () => {
  const result = run(reports => {
    reports['standard-skill'].testResults[0].assertionResults.pop()
  })
  assert.equal(result.status, 1)
})

test('capability CLI rejects a missing fresh report instead of accepting previous evidence', () => {
  const result = run(reports => {
    reports.gea = { noReport: true }
  })
  assert.equal(result.status, 1)
})
