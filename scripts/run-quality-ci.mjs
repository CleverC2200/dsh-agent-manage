import process from 'node:process'
import console from 'node:console'
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { spawnSync, execFileSync } from 'node:child_process'
import { prepareOfficialSDK, verifyOfficialSDK, verifyOfficialSource } from './prepare-official-sdk.mjs'
import { runQualityChecks } from './run-quality-checks.mjs'

const { values } = parseArgs({
  options: {
    phase: { type: 'string', default: 'quality' },
    input: { type: 'string' },
    'core-source': { type: 'string' },
    'prepare-sdk': { type: 'boolean' },
    'final-group-sha256': { type: 'string' }
  }
})
const phase = values.phase
let finalGroup
function refuse(code, detail) {
  throw new Error(`${code}: ${detail}`)
}
function run(command, args, cwd = process.cwd()) {
  finalGroup?.verifyUnchanged()
  const windows = process.platform === 'win32' && command === 'corepack'
  const result = spawnSync(windows ? 'corepack.cmd' : command, args, { cwd, stdio: 'inherit', shell: windows })
  if (result.error || result.status !== 0)
    refuse('QUALITY_COMMAND_FAILED', `${command} ${args.join(' ')} exited ${result.status}: ${result.error?.message ?? result.signal ?? 'no exit result'}`)
}
try {
  if (values['final-group-sha256'] !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(values['final-group-sha256'])) refuse('CANDIDATE_FINAL_GROUP_REQUIRED', 'original bytes SHA256 required')
    if (!['quality', 'business-profile', 'archives', 'audit', 'verify-input'].includes(phase)) refuse('CANDIDATE_FINAL_GROUP_PHASE', phase)
  }
  if (phase === 'scope') {
    if (process.env.QUALITY_SCOPE_ALLOWED !== 'true') refuse('CANDIDATE_SCOPE_REQUIRED', 'same-repository read-only execution only')
  } else if (phase === 'final') {
    for (const key of ['QUALITY_SCOPE_RESULT', 'QUALITY_GATE_RESULT', 'QUALITY_WINDOWS_RESULT']) {
      if (process.env[key] !== 'success') refuse('QUALITY_REQUIRED', `${key}=${process.env[key] ?? 'missing'}`)
    }
  } else {
    if (!['quality', 'business-profile', 'archives', 'audit', 'verify-input'].includes(phase)) refuse('QUALITY_PHASE_REJECTED', phase)
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
    if (phase === 'business-profile') {
      const { loadBusinessProfilePolicy } = await import('./business-profile-ci.mjs')
      const policy = await loadBusinessProfilePolicy(workbench.path)
      policy.validateBusinessProfileGroup(manifest.repositories)
    }
    let plan
    if (phase === 'quality') {
      const { selectCiTests } = await import(pathToFileURL(resolve(workbench.path, 'scripts/ci-test-plan.mjs')))
      const baseline = JSON.parse(readFileSync('scripts/quality-peer-baseline.json'))
      plan = selectCiTests({
        repositories: manifest.repositories,
        repo: 'dsh-agent-manage',
        base: process.env.QUALITY_BASE_SHA || baseline.repositories.find(entry => entry.repo === 'dsh-agent-manage').head
      })
      writeFileSync(resolve(dirname(resolve(input)), 'quality-test-plan.json'), JSON.stringify(plan, null, 2) + '\n')
    }

    const core = resolve(dirname(dirname(process.cwd())), 'official-latest-standard')
    const options = { core, consumer: process.cwd(), coreHead: manifest.core, source: values['core-source'], withFlock: phase === 'quality' }
    process.env.DSH_CORE_CHECKOUT = core
    finalGroup?.verifyUnchanged()
    if (phase === 'audit') verifyOfficialSource(resolve(values['core-source']), options)
    else if (values['prepare-sdk']) prepareOfficialSDK({ ...options, reusePrepared: process.env.QUALITY_REUSE_SDK === 'true' })
    else verifyOfficialSDK(options)
    if (phase !== 'audit')
      run(process.execPath, [
        resolve(workbench.path, 'scripts/verify-candidate-input.mjs'),
        '--input',
        resolve(input),
        '--checkout',
        process.cwd(),
        '--final-group-sha256',
        values['final-group-sha256']
      ])
    if (['quality', 'business-profile'].includes(phase)) {
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
    if (['quality', 'business-profile'].includes(phase)) {
      const checks = await runQualityChecks(
        phase === 'business-profile'
          ? [
              { name: 'static', execute: () => run('corepack', ['pnpm', 'check:static']) },
              {
                name: 'business-profile',
                execute: () =>
                  run('corepack', [
                    'pnpm',
                    'exec',
                    'vitest',
                    'run',
                    'tests/business-resources.test.ts',
                    'tests/bundled-business-tools.test.ts',
                    'tests/gea-mcp-scope.test.ts',
                    'tests/gea-mcp.test.ts'
                  ])
              },
              {
                name: 'admission',
                execute: () => run('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.preset-integration.config.ts', 'tests/business-admission-gea.test.ts'])
              },
              { name: 'build', execute: () => run('corepack', ['pnpm', 'build']) }
            ]
          : [
              ...['check:static', 'check:capabilities', 'build'].map(name => ({ name, execute: () => run('corepack', ['pnpm', 'run', name]) })),
              { name: 'required-and-affected', execute: () => run('corepack', ['pnpm', 'exec', 'vitest', 'run', ...plan.files]) }
            ]
      )
      writeFileSync('quality-checks.json', JSON.stringify(checks, null, 2) + '\n')
      if (checks.length !== 4 || checks.some(check => check.status !== 'passed')) refuse('QUALITY_CHECKS_FAILED', 'see quality-checks.json')
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
