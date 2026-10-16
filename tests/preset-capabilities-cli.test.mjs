import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { presetHostOwners } from '../scripts/preset-test-lanes.mjs'

// Child-process completion is the CLI seam; real client/Host lanes run separately.
const files = {
  'standard-skill': { 'standard-preset': 11, 'skill-preset': 5, 'manage-cold-boot': 6, 'manage-settings': 1, 'bundled-sales-skills': 2, 'manage-bundle-default': 1 },
  client: {
    'user-agent-retirement-draft': 1,
    'agent-source-sync-draft': 1,
    'standard-preset-draft': 1,
    'preset-catalog-client': 1,
    'skill-preset-client': 1,
    'base-preset-client': 1,
    'sales-preset-client': 2,
    'inventory-family-client': 3
  },
  gea: {
    'sales-agent-import-gea': 1,
    'user-agent-cube-gea': 2,
    'business-admission-gea': 4,
    'standard-preset-gea': 11,
    'skill-preset-gea': 1,
    'sales-preset-gea': 11,
    'inventory-family-preset': 13
  }
}
function run(change = () => {}, plan, missingFile) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'preset-cli-')))
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
            name: resolve(root, `tests/${file}.test.ts`),
            status: 'passed',
            assertionResults: Array.from({ length: count }, (_, i) => ({ fullName: `${file} case ${i}`, status: 'passed' }))
          }))
        }
      ])
    )
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'tests/routes.test.ts'), '')
    for (const file of Object.keys(presetHostOwners)) writeFileSync(join(root, file), '')
    for (const phase of Object.values(files)) for (const name of Object.keys(phase)) writeFileSync(join(root, `tests/${name}.test.ts`), '')
    if (missingFile) unlinkSync(join(root, missingFile))
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
        const selected = args.filter(arg => arg.startsWith('tests/'));
        if (selected.length && value.testResults) value.testResults = value.testResults.filter(result => selected.some(file => result.name.endsWith('/' + file)));
        if (value.extraResult) value.testResults.push(value.extraResult);
        if (value.testResults) { value.numPassedTests = value.testResults.flatMap(result => result.assertionResults).filter(result => result.status === 'passed').length; }
        if (!value.noReport) writeFileSync(report, JSON.stringify(value));
        return { status: 0, stdout: '', stderr: '' };
      }; syncBuiltinESMExports();`
    )
    const planFile = join(root, 'plan.json')
    if (plan) writeFileSync(planFile, JSON.stringify(plan))
    const child = spawnSync(process.execPath, ['--import', hook, resolve('scripts/check-preset-capabilities.mjs'), ...(plan ? ['--plan', planFile] : [])], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, CAPABILITY_REPORT_FIXTURE: fixture, PRESET_EVIDENCE_DIR: root }
    })
    return { ...child, receipt: existsSync(join(root, 'capability-quality.json')) ? JSON.parse(readFileSync(join(root, 'capability-quality.json'), 'utf8')) : undefined }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('capability CLI accepts complete passed required files', () => {
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.receipt.passed, true)
  assert.equal(result.receipt.mode, 'complete')
  assert.deepEqual(
    result.receipt.phases.map(phase => phase.requiredFiles.length),
    [6, 8, 7]
  )
  assert.deepEqual(
    result.receipt.phases.map(phase => phase.requiredFiles.reduce((count, file) => count + file.requiredCases, 0)),
    [26, 11, 43]
  )
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

test('affected capability CLI runs only the selected client and GEA files in their existing lanes', () => {
  const result = run(() => {}, {
    schemaVersion: 1,
    mode: 'required-and-affected',
    repo: 'dsh-agent-manage',
    files: ['tests/routes.test.ts', 'tests/standard-preset-draft.test.ts', 'tests/user-agent-cube-gea.test.ts']
  })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(
    result.receipt.phases.map(phase => phase.name),
    ['client', 'gea']
  )
  assert.deepEqual(
    result.receipt.phases.flatMap(phase => phase.requiredFiles.map(file => file.file)),
    ['tests/standard-preset-draft.test.ts', 'tests/user-agent-cube-gea.test.ts']
  )
  for (const phase of result.receipt.phases) assert.ok(phase.args.includes('--config'))
})

test('affected capability CLI refuses malformed, duplicate or unknown planned files before running children', () => {
  for (const change of [
    { schemaVersion: 2 },
    { mode: 'unknown' },
    { repo: 'dsh-gea-plugin' },
    { files: ['../tests/routes.test.ts'] },
    { files: ['tests/unknown.test.ts'] },
    { files: ['tests/routes.test.ts', 'tests/routes.test.ts'] },
    { files: [] },
    { files: [null] }
  ]) {
    const result = run(() => {}, { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/routes.test.ts'], ...change })
    assert.notEqual(result.status, 0, JSON.stringify(change))
    assert.match(result.stderr, /CAPABILITY_PLAN_REQUIRED/)
    assert.equal(result.receipt, undefined)
  }
})

test('unrelated affected plan records non-applicability without starting a capability phase', () => {
  const result = run(() => {}, { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/routes.test.ts'] })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(result.receipt.phases, [])
  assert.equal(result.receipt.status, 'not-applicable')
  assert.deepEqual(result.receipt.selection.files, ['tests/routes.test.ts'])
})

test('affected capability report rejects failure, skipped, unknown, extra and missing cases', () => {
  const plan = { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/standard-preset-draft.test.ts'] }
  for (const status of ['failed', 'pending', 'unknown']) {
    const result = run(reports => {
      reports.client.testResults.find(file => file.name.endsWith('/standard-preset-draft.test.ts')).assertionResults[0].status = status
    }, plan)
    assert.equal(result.status, 1, status)
  }
  for (const change of [report => report.assertionResults.pop(), report => report.assertionResults.push({ fullName: 'unexpected new case', status: 'passed' })]) {
    const result = run(reports => change(reports.client.testResults.find(file => file.name.endsWith('/standard-preset-draft.test.ts'))), plan)
    assert.equal(result.status, 1)
  }
})

test('affected capability CLI rejects an extra unplanned suite in a successful report', () => {
  const result = run(
    reports => {
      reports.client.extraResult = { name: resolve('tests/skill-preset-client.test.ts'), assertionResults: [{ fullName: 'unexpected duplicate batch', status: 'passed' }] }
    },
    { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/standard-preset-draft.test.ts'] }
  )
  assert.equal(result.status, 1)
})

test('affected capability selection refuses a missing registered test instead of declaring it inapplicable', () => {
  const result = run(
    () => {},
    { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/standard-preset-draft.test.ts'] },
    'tests/standard-preset.test.ts'
  )
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CAPABILITY_FILE_REQUIRED/)
})

test('capability CLI refuses a Host helper left in the direct plan instead of reporting it inapplicable', () => {
  const result = run(() => {}, { schemaVersion: 1, mode: 'required-and-affected', repo: 'dsh-agent-manage', files: ['tests/base-resource-host.test.ts'] })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /CAPABILITY_PLAN_UNOWNED_HOST/)
})
