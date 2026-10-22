/** Existing Vitest lanes, one public capability check; no installation or runtime switch. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { presetLanes, presetHostOwners } from './preset-test-lanes.mjs'

const { values } = parseArgs({ options: { plan: { type: 'string' } } })
const plan = values.plan !== undefined ? JSON.parse(readFileSync(resolve(values.plan), 'utf8')) : undefined
if (
  plan !== undefined &&
  (!plan ||
    plan.schemaVersion !== 1 ||
    !['required-and-affected', 'source-affected'].includes(plan.mode) ||
    plan.repo !== 'dsh-agent-manage' ||
    !Array.isArray(plan.files) ||
    !plan.files.length ||
    new Set(plan.files).size !== plan.files.length ||
    plan.files.some(file => typeof file !== 'string' || !/^tests\/[^/]+\.test\.(?:ts|mjs)$/.test(file) || !existsSync(resolve(file))))
)
  throw Error('CAPABILITY_PLAN_REQUIRED: expected the Manage affected test plan')
if (plan?.files.some(file => Object.hasOwn(presetHostOwners, file))) throw Error('CAPABILITY_PLAN_UNOWNED_HOST: use the client execution owner')
for (const file of Object.values(presetLanes).flatMap(lane => Object.keys(lane))) {
  if (!existsSync(resolve(file))) throw Error(`CAPABILITY_FILE_REQUIRED: ${file}`)
}
const selected = plan ? new Set(plan.files) : undefined
const persistent = process.env.PRESET_EVIDENCE_DIR ?? (plan ? resolve(dirname(values.plan), 'quality-capabilities') : undefined)
const evidence = persistent ? resolve(persistent) : mkdtempSync(join(tmpdir(), 'preset-quality-'))
mkdirSync(evidence, { recursive: true })
const phases = Object.entries(presetLanes)
  .map(([name, files]) => [name, Object.keys(files).filter(file => !selected || selected.has(file))])
  .filter(([, files]) => files.length)
const results = []
for (const [name, files] of phases) {
  const selections = [...(name === 'client' ? ['--config', 'vitest.preset-client.config.ts'] : name === 'gea' ? ['--config', 'vitest.preset-integration.config.ts'] : []), ...files]
  const report = join(evidence, `${name}-vitest.json`)
  rmSync(report, { force: true })
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
  const requiredFiles = files.map(file => {
    const matches = summary?.testResults?.filter(result => resolve(result.name) === resolve(file)) ?? []
    const assertions = matches[0]?.assertionResults ?? []
    return {
      file,
      reportedCases: assertions.length,
      passed: matches.length === 1 && assertions.length > 0 && assertions.every(result => result.status === 'passed'),
      nonPassing: assertions.filter(result => result.status !== 'passed').map(result => ({ name: result.fullName, status: result.status }))
    }
  })
  const passed =
    requiredFiles.every(file => file.passed) &&
    summary?.testResults?.length === requiredFiles.length &&
    summary.numPendingTests === 0 &&
    child.status === 0 &&
    !child.error &&
    summary?.success === true &&
    summary.numPassedTests > 0 &&
    summary.numFailedTests === 0
  results.push({
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
  })
}
const result = {
  at: new Date().toISOString(),
  stage: 'offline-capability',
  mode: plan ? plan.mode : 'complete',
  selection: plan,
  status: !phases.length ? 'not-applicable' : results.every(phase => phase.passed) ? 'passed' : 'failed',
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
