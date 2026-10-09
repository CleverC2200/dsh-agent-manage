/** Existing Vitest lanes, one public capability check; no installation or runtime switch. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const persistent = process.env.PRESET_EVIDENCE_DIR
const evidence = persistent ? resolve(persistent) : mkdtempSync(join(tmpdir(), 'preset-quality-'))
mkdirSync(evidence, { recursive: true })
const phases = [
  [
    'standard-skill',
    [
      'tests/standard-preset.test.ts',
      'tests/skill-preset.test.ts',
      'tests/manage-cold-boot.test.ts',
      'tests/manage-settings.test.ts',
      'tests/bundled-sales-skills.test.ts',
      'tests/manage-bundle-default.test.ts'
    ]
  ],
  ['client', ['--config', 'vitest.preset-client.config.ts']],
  ['gea', ['--config', 'vitest.preset-integration.config.ts']]
]
const results = []
for (const [name, selections] of phases) {
  const report = join(evidence, `${name}-vitest.json`)
  const args = ['exec', 'vitest', 'run', ...selections, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`]
  const child = spawnSync('corepack', ['pnpm', ...args], { cwd: process.cwd(), env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  process.stdout.write(child.stdout ?? '')
  process.stderr.write(child.stderr ?? '')
  writeFileSync(join(evidence, `${name}.stdout.log`), child.stdout ?? '')
  writeFileSync(join(evidence, `${name}.stderr.log`), child.stderr ?? '')
  let summary
  try {
    summary = JSON.parse(readFileSync(report, 'utf8'))
  } catch {
    /* Missing report rejects this phase. */
  }
  const passed = child.status === 0 && !child.error && summary?.success === true && summary.numPassedTests > 0 && summary.numFailedTests === 0
  results.push({
    name,
    executable: 'corepack',
    args: ['pnpm', ...args],
    cwd: process.cwd(),
    exit: child.status,
    signal: child.signal,
    error: child.error?.message,
    passed,
    tests: summary && { passed: summary.numPassedTests, failed: summary.numFailedTests, skipped: summary.numPendingTests, total: summary.numTotalTests }
  })
}
const result = {
  at: new Date().toISOString(),
  stage: 'offline-capability',
  passed: results.every(phase => phase.passed),
  phases: results,
  native: 'not-run',
  model: 'local-completion-only',
  business: 'controlled-adapter-only'
}
writeFileSync(join(evidence, 'capability-quality.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
if (!persistent) rmSync(evidence, { recursive: true, force: true })
process.exitCode = result.passed ? 0 : 1
