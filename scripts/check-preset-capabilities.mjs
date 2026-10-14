/** Existing Vitest lanes, one public capability check; no installation or runtime switch. */
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { presetLanes } from './preset-test-lanes.mjs'

const persistent = process.env.PRESET_EVIDENCE_DIR
const evidence = persistent ? resolve(persistent) : mkdtempSync(join(tmpdir(), 'preset-quality-'))
mkdirSync(evidence, { recursive: true })
const phases = [
  ['standard-skill', Object.keys(presetLanes['standard-skill'])],
  ['client', ['--config', 'vitest.preset-client.config.ts']],
  ['gea', ['--config', 'vitest.preset-integration.config.ts']]
]
const results = await Promise.all(
  phases.map(async ([name, selections]) => {
    const report = join(evidence, `${name}-vitest.json`)
    rmSync(report, { force: true })
    const args = ['exec', 'vitest', 'run', ...selections, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`]
    const child = await new Promise(resolveChild => {
      execFile('corepack', ['pnpm', ...args], { cwd: process.cwd(), env: process.env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
        resolveChild({
          status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          signal: error?.signal,
          error: error && typeof error.code !== 'number' ? error : undefined,
          stdout,
          stderr
        })
      })
    })
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
    const requiredFiles = Object.entries(presetLanes[name]).map(([file, cases]) => {
      const matches = summary?.testResults?.filter(result => resolve(result.name) === resolve(file)) ?? []
      const assertions = matches[0]?.assertionResults ?? []
      return {
        file,
        requiredCases: cases,
        reportedCases: assertions.length,
        passed: matches.length === 1 && assertions.length === cases && assertions.every(result => result.status === 'passed'),
        nonPassing: assertions.filter(result => result.status !== 'passed').map(result => ({ name: result.fullName, status: result.status }))
      }
    })
    const passed =
      requiredFiles.every(file => file.passed) && child.status === 0 && !child.error && summary?.success === true && summary.numPassedTests > 0 && summary.numFailedTests === 0
    return {
      name,
      executable: 'corepack',
      args: ['pnpm', ...args],
      cwd: process.cwd(),
      exit: child.status,
      signal: child.signal,
      error: child.error?.message,
      passed,
      requiredFiles,
      tests: summary && { passed: summary.numPassedTests, failed: summary.numFailedTests, skipped: summary.numPendingTests, total: summary.numTotalTests }
    }
  })
)
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
