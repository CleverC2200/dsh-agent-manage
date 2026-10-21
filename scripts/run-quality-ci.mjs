import { createRequire } from 'node:module'
import process from 'node:process'
import console from 'node:console'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { spawnSync, execFileSync } from 'node:child_process'
import { prepareOfficialSDK, prepareOfficialSource, verifyOfficialSDK, verifyOfficialSource } from './prepare-official-sdk.mjs'
import { runQualityChecks } from './run-quality-checks.mjs'
import { presetLanes, presetHostOwners } from './preset-test-lanes.mjs'

const { values } = parseArgs({
  options: {
    phase: { type: 'string', default: 'quality' },
    input: { type: 'string' },
    'core-source': { type: 'string' },
    'prepare-sdk': { type: 'boolean' },
      'source-only': { type: 'boolean' },
    'final-group-sha256': { type: 'string' }
  }
})
const phase = values.phase
let finalGroup
function refuse(code, detail) {
  throw new Error(`${code}: ${detail}`)
}
function run(command, args, cwd = process.cwd()) {
  const release =
    ['npm', 'corepack'].includes(command) && (args.includes('ci') || args.includes('install'))
      ? createRequire(import.meta.url)('../../dsh-gea-plugin/scripts/build-admission.mjs').acquireBuild({ operation: 'prepare', cwd })
      : () => {}
  try {
    finalGroup?.verifyUnchanged()
    const windows = process.platform === 'win32' && command === 'corepack'
    const result = spawnSync(windows ? 'corepack.cmd' : command, args, { cwd, stdio: 'inherit', shell: windows })
    if (result.error || result.status !== 0)
      refuse('QUALITY_COMMAND_FAILED', `${command} ${args.join(' ')} exited ${result.status}: ${result.error?.message ?? result.signal ?? 'no exit result'}`)
  } finally {
    release()
  }
}
try {
  if (values['final-group-sha256'] !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(values['final-group-sha256'])) refuse('CANDIDATE_FINAL_GROUP_REQUIRED', 'original bytes SHA256 required')
    if (!['quality', 'archives', 'audit', 'verify-input', 'plan'].includes(phase)) refuse('CANDIDATE_FINAL_GROUP_PHASE', phase)
  }
  if (phase === 'scope') {
    if (process.env.QUALITY_SCOPE_ALLOWED !== 'true') refuse('CANDIDATE_SCOPE_REQUIRED', 'same-repository read-only execution only')
  } else if (phase === 'final') {
    if (!['docs', 'source'].includes(process.env.QUALITY_APPLICABILITY)) refuse('QUALITY_REQUIRED', 'explicit plan applicability')
    for (const key of ['QUALITY_AUDIT_APPLICABLE', 'QUALITY_DEPENDENCY_APPLICABLE', 'QUALITY_CODEQL_APPLICABLE']) {
      if (!['true', 'false'].includes(process.env[key])) refuse('QUALITY_REQUIRED', `${key}=missing`)
    }
    const docs = process.env.QUALITY_APPLICABILITY === 'docs'
    const required = ['QUALITY_SCOPE_RESULT', 'QUALITY_GATE_RESULT', 'QUALITY_WINDOWS_RESULT']
    if (!docs && process.env.QUALITY_AUDIT_APPLICABLE === 'true') required.push('QUALITY_AUDIT_RESULT')
    if (!docs && process.env.QUALITY_DEPENDENCY_APPLICABLE === 'true') required.push('QUALITY_DEPENDENCY_RESULT')
    if (!docs && process.env.QUALITY_CODEQL_APPLICABLE === 'true') required.push('QUALITY_CODEQL_RESULT')
    for (const key of required) {
      if (process.env[key] !== 'success') refuse('QUALITY_REQUIRED', `${key}=${process.env[key] ?? 'missing'}`)
    }
  } else {
    if (!['quality', 'archives', 'audit', 'verify-input', 'plan'].includes(phase)) refuse('QUALITY_PHASE_REJECTED', phase)
    if (!values['final-group-sha256']) refuse('CANDIDATE_FINAL_GROUP_REQUIRED', 'candidate execution requires explicit admitted group hash')
    const input = values.input ?? process.env.QUALITY_CANDIDATE
    if (!input) refuse('CANDIDATE_INPUT_REQUIRED', '--input <frozen group JSON>')
    const { readFinalGroup } = await import(pathToFileURL(resolve('../dsh-agent-workbench/scripts/candidate-input.mjs')))
    finalGroup = await readFinalGroup({
      input,
      sha256: values['final-group-sha256'],
      checkout: process.cwd(),
      repo: 'dsh-agent-manage',
      coreSource: values['core-source'],
      expectedSha: process.env.QUALITY_EXPECTED_SHA,
      ci: process.env.CI
    })
    if (phase === 'verify-input') {
      console.log(JSON.stringify(finalGroup.receipt))
      process.exit(0)
    }
    const manifest = finalGroup.manifest
    const workbench = manifest.repositories.find(entry => entry.repo === 'dsh-agent-workbench')
    process.env.QUALITY_POLICY_WORKBENCH = workbench.path
    let plan
    const planFile = resolve(dirname(resolve(input)), 'quality-test-plan.json')
    if (['quality', 'plan'].includes(phase)) {
      const { selectCiTests } = await import(pathToFileURL(resolve(workbench.path, 'scripts/ci-test-plan.mjs')))
      const baseline = JSON.parse(readFileSync('scripts/quality-peer-baseline.json'))
      plan = selectCiTests({
        repositories: manifest.repositories,
        sourceOnly: values['source-only'],
        repo: 'dsh-agent-manage',
        testOwners: presetHostOwners,
        base: process.env.QUALITY_BASE_SHA || baseline.repositories.find(entry => entry.repo === 'dsh-agent-manage').head
      })
      for (const file of plan.files) {
        if (Object.hasOwn(presetHostOwners, file)) refuse('CI_TEST_PLAN_UNOWNED_HOST', file)
      }
      writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n')
    }
    if (phase === 'plan') {
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `applicability=${plan.applicability}\n`)
      console.log(JSON.stringify(plan))
      process.exit(0)
    }
    if (plan?.applicability === 'docs') {
      const options = { core: resolve(dirname(dirname(process.cwd())), 'official-latest-standard'), source: values['core-source'], coreHead: manifest.core }
      prepareOfficialSource(options)
      const checks = await runQualityChecks([
        { name: 'knowledge', execute: () => run(process.execPath, [resolve('scripts/check-agent-knowledge.mjs')]) },
        { name: 'whitespace', execute: () => run('git', ['diff', '--check', plan.diffBase, plan.head]) }
      ])
      writeFileSync('quality-checks.json', JSON.stringify(checks, null, 2) + '\n')
      if (checks.some(check => check.status !== 'passed')) refuse('QUALITY_CHECKS_FAILED', 'see quality-checks.json')
      console.log(JSON.stringify({ status: 'passed', phase, applicability: 'docs', runtime: 'not-applicable' }))
      process.exit(0)
    }

    const core = resolve(dirname(dirname(process.cwd())), 'official-latest-standard')
    const options = { core, consumer: process.cwd(), coreHead: manifest.core, source: values['core-source'], withFlock: phase === 'quality' }
    process.env.DSH_CORE_CHECKOUT = core
    finalGroup?.verifyUnchanged()
    if (phase === 'audit') verifyOfficialSource(resolve(values['core-source']), options)
    else if (phase === 'archives') {
      if (values['prepare-sdk']) prepareOfficialSource(options)
      else {
        verifyOfficialSource(resolve(values['core-source']), options)
        process.env.DSH_CORE_CHECKOUT = resolve(values['core-source'])
      }
    } else if (values['prepare-sdk']) prepareOfficialSDK({ ...options, reusePrepared: process.env.QUALITY_REUSE_SDK === 'true' })
    else verifyOfficialSDK(options)
    if (!['audit', 'archives'].includes(phase))
      run(process.execPath, [
        resolve(workbench.path, 'scripts/verify-candidate-input.mjs'),
        '--input',
        resolve(input),
        '--checkout',
        process.cwd(),
        '--final-group-sha256',
        values['final-group-sha256']
      ])
    if (phase === 'quality') {
      const npmManager = JSON.parse(readFileSync(resolve(workbench.path, 'package.json'), 'utf8')).packageManager
      if (npmManager !== 'npm@11.11.0' || execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim() !== npmManager.slice('npm@'.length))
        refuse('QUALITY_TOOLCHAIN_REQUIRED', 'Workbench npm@11.11.0')
      run('npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], workbench.path)
      run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline'], manifest.repositories.find(entry => entry.repo === 'dsh-gea-plugin').path)
      // Workbench's public declarations are tracked source inputs, not missing cold outputs.
      for (const targets of Object.values(JSON.parse(readFileSync('tsconfig.official-paths.json', 'utf8')).compilerOptions.paths)) {
        for (const target of targets.filter(path => path.startsWith('../dsh-agent-workbench/'))) readFileSync(resolve(target))
      }
    }
    run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline'])
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'dependencies-prepared=true\n')
    if (phase === 'quality') {
      const checks = await runQualityChecks([{ name: 'check:static', execute: () => run('corepack', ['pnpm', 'run', 'check:static:ci']) }])
      if (checks[0].status === 'passed')
        checks.push(
          ...(await runQualityChecks([
            { name: 'capabilities', execute: () => run(process.execPath, [resolve('scripts/check-preset-capabilities.mjs'), '--plan', planFile]) },
            { name: 'build', execute: () => run('corepack', ['pnpm', 'run', 'build']) },
            ...(plan.files.some(file => file.endsWith('.test.mjs'))
              ? [{ name: 'node-tests', execute: () => run(process.execPath, ['--test', ...plan.files.filter(file => file.endsWith('.test.mjs'))]) }]
              : []),
            {
              name: 'required-and-affected',
              execute: () => {
                const files = plan.files.filter(file => file.endsWith('.test.ts') && !Object.values(presetLanes).some(lane => file in lane))
                if (!files.length && values['source-only']) return
                if (!files.length) refuse('CI_TEST_PLAN_EMPTY_ORDINARY', 'required ordinary tests must be explicitly selected')
                run('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.ci-unit.config.ts', ...files])
              }
            }
          ]))
        )
      writeFileSync('quality-checks.json', JSON.stringify(checks, null, 2) + '\n')
      if (process.env.GITHUB_OUTPUT) {
        finalGroup.verifyUnchanged()
        verifyOfficialSDK({ ...options, withArtifactReceipt: true })
        appendFileSync(process.env.GITHUB_OUTPUT, 'sdk-cache-ready=true\n')
      }
      if (checks.some(check => check.status !== 'passed')) refuse('QUALITY_CHECKS_FAILED', 'see quality-checks.json')
    } else if (phase === 'archives') {
      run('corepack', ['pnpm', 'exec', 'vitest', 'run', 'tests/source-acquisition.test.ts', 'tests/zip-bomb.test.ts', 'tests/private-archive.test.ts'])
    } else {
      run('corepack', ['pnpm', 'audit', '--audit-level', 'high', '--json'])
    }
  }
  console.log(JSON.stringify({ status: 'passed', phase, platform: process.platform, runtime: 'not-observed' }))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
