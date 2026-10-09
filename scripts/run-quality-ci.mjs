import { readFileSync, appendFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { prepareOfficialSDK, verifyOfficialSDK } from './prepare-official-sdk.mjs'

const args = process.argv.slice(2)
const value = name => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
const phase = value('--phase') ?? 'quality'
function refuse(code, detail) {
  throw new Error(`${code}: ${detail}`)
}
function run(command, args, cwd = process.cwd()) {
  const windows = process.platform === 'win32' && command === 'corepack'
  const result = spawnSync(windows ? 'corepack.cmd' : command, args, { cwd, stdio: 'inherit', shell: windows })
  if (result.error || result.status !== 0) refuse('QUALITY_COMMAND_FAILED', `${command} ${args.join(' ')} exited ${result.status}: ${result.error?.message ?? ''}`)
}
try {
  if (phase === 'scope') {
    if (process.env.QUALITY_SCOPE_ALLOWED !== 'true') refuse('CANDIDATE_SCOPE_REQUIRED', 'same-repository read-only execution only')
  } else if (phase === 'final') {
    for (const key of ['QUALITY_SCOPE_RESULT', 'QUALITY_GATE_RESULT', 'QUALITY_WINDOWS_RESULT', 'QUALITY_AUDIT_RESULT']) {
      if (process.env[key] !== 'success') refuse('QUALITY_REQUIRED', `${key}=${process.env[key] ?? 'missing'}`)
    }
  } else {
    if (!['quality', 'archives', 'audit'].includes(phase)) refuse('QUALITY_PHASE_REJECTED', phase)
    const input = value('--input') ?? process.env.QUALITY_CANDIDATE
    if (!input) refuse('CANDIDATE_INPUT_REQUIRED', '--input <frozen group JSON>')
    const manifest = JSON.parse(readFileSync(resolve(input), 'utf8'))
    if (manifest.core !== '5badb15009ae1756c3afe0ae0cef1faafc290ccc') refuse('CANDIDATE_CORE', 'fixed admitted Core required before preparation')
    if (manifest.repositories?.length !== 3) refuse('CANDIDATE_PEER_REQUIRED', 'exactly the three admitted repositories')
    const own = manifest.repositories?.find(entry => entry.repo === 'dsh-agent-manage')
    const workbench = manifest.repositories?.find(entry => entry.repo === 'dsh-agent-workbench')
    if (!own || !workbench || resolve(own.path) !== process.cwd()) refuse('CANDIDATE_CHECKOUT', 'run in the registered Manage checkout')
    if (process.env.CI && !process.env.QUALITY_EXPECTED_SHA) refuse('CANDIDATE_EVENT_REQUIRED', 'actual event head SHA')
    if (process.env.QUALITY_EXPECTED_SHA && own.head !== process.env.QUALITY_EXPECTED_SHA) refuse('CANDIDATE_EVENT_MISMATCH', own.head)
    // Admission is frozen and clean. Ordinary incremental development continues
    // to use check:refactor without this clean-candidate requirement.
    const expectedPeers = { 'dsh-agent-workbench': '9b4863692cb29a3edc8a2358e98feb7846526d1b', 'dsh-gea-plugin': 'b05ca162e1bf5ffb8443962a0b8b7e8ff8a61e96' }
    for (const name of ['dsh-agent-workbench', 'dsh-agent-manage', 'dsh-gea-plugin']) {
      const entries = manifest.repositories.filter(entry => entry.repo === name)
      if (entries.length !== 1) refuse('CANDIDATE_PEER_REQUIRED', name)
      const entry = entries[0]
      const observed = execFileSync('git', ['-C', entry.path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      if (observed !== entry.head || (expectedPeers[name] && entry.head !== expectedPeers[name])) refuse('CANDIDATE_HEAD', name)
      if (execFileSync('git', ['-C', entry.path, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() !== 'false') refuse('CANDIDATE_HISTORY_REQUIRED', name)
      if (execFileSync('git', ['-C', entry.path, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).trim()) refuse('CANDIDATE_DIRTY', name)
      const lock = name === 'dsh-agent-workbench' ? 'package-lock.json' : 'pnpm-lock.yaml'
      if (!execFileSync('git', ['-C', entry.path, 'show', `HEAD:${lock}`]).equals(readFileSync(resolve(entry.path, lock)))) refuse('CANDIDATE_LOCK', name)
    }
    const core = resolve(dirname(dirname(process.cwd())), 'official-latest-standard')
    const options = { core, consumer: process.cwd(), source: value('--core-source') }
    if (args.includes('--prepare-sdk')) prepareOfficialSDK(options)
    else verifyOfficialSDK(options)
    run(process.execPath, [resolve(workbench.path, 'scripts/verify-candidate-input.mjs'), '--input', resolve(input), '--checkout', process.cwd()])
    for (const targets of Object.values(JSON.parse(readFileSync('tsconfig.official-paths.json', 'utf8')).compilerOptions.paths)) {
      for (const target of targets.filter(path => path.startsWith('../dsh-agent-workbench/'))) readFileSync(resolve(target))
    }
    run('corepack', ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts', '--prefer-offline'])
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'dependencies-prepared=true\n')
    if (phase === 'quality') {
      run('corepack', ['pnpm', 'run', 'test:ci-inputs'])
      run('corepack', ['pnpm', 'run', 'check:knowledge'])
      run('corepack', ['pnpm', 'run', 'check:refactor'])
      run('corepack', ['pnpm', 'run', 'test'])
      run('corepack', ['pnpm', 'run', 'build'])
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
