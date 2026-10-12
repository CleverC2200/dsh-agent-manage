import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const call = (phase, env) => spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', phase], { encoding: 'utf8', env: { ...process.env, ...env } })
test('fork scope is rejected before preparation', () => {
  const result = call('scope', { QUALITY_SCOPE_ALLOWED: 'false' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /CANDIDATE_SCOPE_REQUIRED/)
})

test('final quality aggregate rejects failure, missing, skipped and cancelled quality jobs', () => {
  for (const state of ['failure', 'cancelled', 'skipped', '']) {
    const result = call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: state, QUALITY_AUDIT_RESULT: 'success' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /QUALITY_REQUIRED/)
  }
  assert.equal(call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success', QUALITY_AUDIT_RESULT: 'success' }).status, 0)
})

test('quality result does not claim dependency audit coverage', () => {
  assert.equal(call('final', { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success', QUALITY_AUDIT_RESULT: 'failure' }).status, 0)
})

test('maintenance and main pushes use the read-only candidate quality workflow', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const pushBranches = workflow
    .match(/^ {2}push:\n {4}branches: \[([^\]]+)\]/m)?.[1]
    .split(',')
    .map(branch => branch.trim())
  assert.deepEqual(pushBranches, ['main', 'codex/quality-ci-maintenance-20261010'])
  assert.match(workflow, /pull_request:\n {4}types: \[opened, synchronize, reopened\]/)
  assert.match(workflow, /permissions:\n {2}contents: read/)
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.match(workflow, /QUALITY_EXPECTED_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/)
  assert.match(workflow, /QUALITY_SCOPE_ALLOWED: \$\{\{ github.event_name != 'pull_request' \|\| github.event.pull_request.head.repo.full_name == github.repository \}\}/)
})

test('hosted quality prepares the declared Workbench npm before peer installation', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /npm install --global npm@11\.11\.0/)
})

test('quality requests real flock preparation and verification; archives and audit do not', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manage-quality-flock-')))
  try {
    const repositories = ['dsh-agent-workbench', 'dsh-agent-manage', 'dsh-gea-plugin'].map(repo => {
      const path = join(root, 'candidate', repo)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, repo === 'dsh-agent-workbench' ? 'package-lock.json' : 'pnpm-lock.yaml'), '{}\n')
      if (repo === 'dsh-agent-workbench') {
        mkdirSync(join(path, 'scripts'))
        writeFileSync(
          join(path, 'scripts/candidate-input.mjs'),
          `import { readFileSync } from 'node:fs'; export async function readFinalGroup({ input }) {
            return { manifest: JSON.parse(readFileSync(input, 'utf8')), verifyUnchanged() {} }
          }`
        )
      }
      const git = args => {
        const result = spawnSync('git', args, { cwd: path, encoding: 'utf8' })
        assert.equal(result.status, 0, result.stderr)
        return result.stdout.trim()
      }
      git(['init', '--quiet'])
      git(['add', '.'])
      git(['-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
      return { repo, path, head: git(['rev-parse', 'HEAD']) }
    })
    const coreHead = JSON.parse(readFileSync('../dsh-gea-plugin/scripts/supported-cores.json', 'utf8'))[0].head
    const input = join(root, 'input.json')
    writeFileSync(input, JSON.stringify({ core: coreHead, repositories }))
    const hook = join(root, 'sdk-boundary.mjs')
    const sdkURL = pathToFileURL(resolve('scripts/prepare-official-sdk.mjs')).href
    writeFileSync(
      hook,
      `import { registerHooks } from 'node:module'; registerHooks({ load(url, context, nextLoad) {
        if (url !== ${JSON.stringify(sdkURL)}) return nextLoad(url, context);
        return { format: 'module', shortCircuit: true, source: \`
          const stop = (method, options) => { throw Error('SDK_BOUNDARY:' + JSON.stringify({ method, options })) };
          export const prepareOfficialSDK = options => stop('prepare', options);
          export const verifyOfficialSDK = options => stop('verify', options);
          export const verifyOfficialSource = (core, options) => stop('source', { ...options, observedCore: core });
        \` };
      } })`
    )
    const own = repositories.find(repo => repo.repo === 'dsh-agent-manage')
    for (const phase of ['quality', 'archives', 'audit']) {
      for (const prepare of [false, true]) {
        const result = spawnSync(
          process.execPath,
          [
            '--import',
            hook,
            resolve('scripts/run-quality-ci.mjs'),
            '--phase',
            phase,
            '--input',
            input,
            '--final-group-sha256',
            'a'.repeat(64),
            '--core-source',
            join(root, 'source', 'official-core'),
            ...(prepare ? ['--prepare-sdk'] : [])
          ],
          { cwd: own.path, encoding: 'utf8', env: { ...process.env, QUALITY_EXPECTED_SHA: own.head } }
        )
        assert.equal(result.status, 1, result.stderr)
        const boundary = JSON.parse(result.stderr.match(/SDK_BOUNDARY:(.*)/)?.[1] ?? 'null')
        assert.ok(boundary, result.stderr)
        assert.equal(boundary.method, phase === 'audit' ? 'source' : prepare ? 'prepare' : 'verify')
        assert.equal(boundary.options.coreHead, coreHead)
        assert.equal(boundary.options.withFlock, phase === 'quality')
        if (phase === 'audit') assert.equal(boundary.options.observedCore, join(root, 'source', 'official-core'))
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('CI input binds the event and registered Core and refuses missing or unregistered Core heads', () => {
  const root = mkdtempSync(join(tmpdir(), 'manage-ci-input-'))
  try {
    const matrix = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--matrix'], { encoding: 'utf8' })
    assert.equal(matrix.status, 0, matrix.stderr)
    const lanes = JSON.parse(matrix.stdout).include
    assert.deepEqual([...new Set(lanes.map(lane => lane.coreVersion))].sort(), ['0.2.0-rc.2', '0.2.1-alpha.1'])
    assert.equal(lanes.filter(lane => lane.phase === 'quality' && lane.os === 'ubuntu-latest').length, 2)
    assert.equal(lanes.filter(lane => lane.phase === 'archives' && lane.os === 'windows-latest').length, 2)
    const args = ['scripts/write-ci-input.mjs', '--root', root, '--sha', 'a'.repeat(40)]
    for (const tail of [[], ['--core-head', '0'.repeat(40)]]) {
      const bad = spawnSync(process.execPath, [...args, ...tail], { encoding: 'utf8' })
      assert.notEqual(bad.status, 0)
      assert.match(bad.stderr, /CANDIDATE_CORE_REQUIRED/)
      assert.equal(existsSync(join(root, 'candidate-input.json')), false)
    }
    const good = spawnSync(process.execPath, [...args, '--core-head', lanes[0].coreHead], { encoding: 'utf8' })
    assert.equal(good.status, 0, good.stderr)
    const input = JSON.parse(readFileSync(join(root, 'candidate-input.json'), 'utf8'))
    assert.equal(input.core, lanes[0].coreHead)
    assert.equal(input.repositories.find(repo => repo.repo === 'dsh-agent-manage').head, 'a'.repeat(40))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('hosted checkout refs and public admission use the reviewed immutable peer commits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hosted-peer-pins-'))
  try {
    const core = '639ed015397290b3745d163aafe02ffee4aa3f84'
    const created = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--root', directory, '--sha', 'a'.repeat(40), '--core-head', core], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    const input = JSON.parse(readFileSync(join(directory, 'candidate-input.json'), 'utf8'))
    const expected = {
      'dsh-agent-workbench': '48a232c6bede7ed64f0c439d18b29ffdaa0df03f',
      'dsh-gea-plugin': '1abc2d208a27d6e3ded541b6741c09ed2eb201ae'
    }
    const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
    for (const [repo, head] of Object.entries(expected)) {
      assert.equal(input.repositories.find(entry => entry.repo === repo)?.head, head)
      const checkoutRefs = [
        ...workflow.matchAll(
          new RegExp('repository: CleverC2200/' + repo + "\\s+ref: \\$\\{\\{ (?:steps.group|needs.candidate-scope).outputs.[a-z-]+ \\|\\| '([a-f0-9]{40})' \\}\\}", 'g')
        )
      ].map(match => match[1])
      assert.ok(checkoutRefs.length > 0, repo + ' must be checked out')
      assert.deepEqual([...new Set(checkoutRefs)], [head], repo + ' checkout and input must agree')
      assert.ok(readFileSync('scripts/run-quality-ci.mjs', 'utf8').includes("'" + repo + "': '" + head + "'"), repo + ' admission validator must agree')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('joint dispatch refuses incomplete, malformed and event-mismatched commits before emitting a group', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const validator = workflow
    .match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n {10}NODE/)?.[1]
    .split('\n')
    .map(line => line.slice(10))
    .join('\n')
  assert.ok(validator, 'scope must validate the dispatch group before peer checkout')
  const root = mkdtempSync(join(tmpdir(), 'manage-dispatch-scope-'))
  try {
    const valid = { GEA_SHA: 'a'.repeat(40), WORKBENCH_SHA: 'b'.repeat(40), MANAGE_SHA: 'c'.repeat(40), EXPECTED_SHA: 'c'.repeat(40) }
    const output = join(root, 'output')
    for (const change of [
      { GEA_SHA: '' },
      { WORKBENCH_SHA: 'main' },
      { MANAGE_SHA: 'C'.repeat(40) },
      { GEA_SHA: 'a'.repeat(40) + '\n' },
      { GEA_SHA: '$(touch unsafe)' },
      { EXPECTED_SHA: 'd'.repeat(40) }
    ]) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', validator], {
        encoding: 'utf8',
        env: { ...process.env, ...valid, ...change, GITHUB_OUTPUT: output }
      })
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /CANDIDATE_GROUP_REQUIRED|CANDIDATE_EVENT_MISMATCH/)
      assert.equal(existsSync(output), false)
    }
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', validator], { encoding: 'utf8', env: { ...process.env, ...valid, GITHUB_OUTPUT: output } })
    assert.equal(result.status, 0, result.stderr)
    const id = createHash('sha256')
      .update(
        JSON.stringify([
          ['dsh-agent-manage', valid.MANAGE_SHA],
          ['dsh-agent-workbench', valid.WORKBENCH_SHA],
          ['dsh-gea-plugin', valid.GEA_SHA]
        ])
      )
      .digest('hex')
    assert.equal(readFileSync(output, 'utf8'), `gea-sha=${valid.GEA_SHA}\nworkbench-sha=${valid.WORKBENCH_SHA}\nmanage-sha=${valid.MANAGE_SHA}\ngroup-id=${id}\n`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('joint dispatch isolates in-flight runs and keeps all original Core, Windows and audit lanes', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /github\.ref \}\}-\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/)
  for (const key of ['gea_sha', 'workbench_sha', 'manage_sha']) {
    assert.match(workflow, new RegExp('      ' + key + ':\\n        description: [^\\n]+\\n        required: true\\n        type: string'))
  }
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.run_id/)
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name != 'workflow_dispatch' \}\}/)
  assert.match(workflow, /QUALITY_PHASE: \$\{\{ matrix.phase \}\}/)
  assert.match(
    workflow,
    /'--phase', process.env.QUALITY_PHASE, '--prepare-sdk', '--core-source', resolve\(process.env.GITHUB_WORKSPACE, 'source\/official-core'\), '--final-group-sha256', process.env.INPUT_SHA256/
  )
  assert.match(workflow, /--phase audit --core-source "\$GITHUB_WORKSPACE\/source\/official-core" --final-group-sha256 "\$INPUT_SHA256"/)
  assert.match(workflow, /path: source\/official-core/)
  assert.match(workflow, /candidate-group\.json/)
  assert.match(workflow, /dependency-review:[\s\S]*if: github.event_name == 'pull_request'/)
  assert.doesNotMatch(workflow, /continue-on-error|pull_request_target/)
})

test('joint execution keeps the native runner environment and forwards the complete CLI with failure status', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const step = workflow.match(/ {6}- name: Prepare independent SDK and run all frozen joint group gates\n([\s\S]*?)\n {6}- name:/)?.[1]
  assert.ok(step, 'joint quality step must exist')
  assert.doesNotMatch(step, /shell:/, 'Windows must retain the native PowerShell runner environment')
  const code = step.match(/node --input-type=module -e "([^"\n]+)"/)?.[1]
  assert.ok(code, 'CLI arguments must come from Node environment reads')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manage native runner ')))
  try {
    const own = join(root, 'candidate', 'dsh-agent-manage')
    mkdirSync(join(own, 'scripts'), { recursive: true })
    writeFileSync(
      join(own, 'scripts', 'run-quality-ci.mjs'),
      `import { writeFileSync } from 'node:fs'; writeFileSync(process.env.PROTOCOL_OUTPUT, JSON.stringify({ args: process.argv.slice(2), path: process.env.PATH })); process.exitCode = Number(process.env.PROTOCOL_EXIT);`
    )
    const output = join(root, 'result.json')
    for (const phase of ['quality', 'archives']) {
      for (const exit of [0, 9]) {
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
          cwd: own,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_WORKSPACE: root, QUALITY_PHASE: phase, INPUT_SHA256: 'a'.repeat(64), PROTOCOL_OUTPUT: output, PROTOCOL_EXIT: String(exit) }
        })
        assert.equal(result.status, exit, result.stderr)
        const observed = JSON.parse(readFileSync(output, 'utf8'))
        assert.deepEqual(observed.args, ['--phase', phase, '--prepare-sdk', '--core-source', resolve(root, 'source/official-core'), '--final-group-sha256', 'a'.repeat(64)])
        assert.equal(observed.path, process.env.PATH, 'Node must preserve the runner PATH for archive tools')
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
