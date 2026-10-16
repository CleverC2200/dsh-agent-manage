import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import process from 'node:process'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { presetLanes } from '../scripts/preset-test-lanes.mjs'

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
        writeFileSync(join(path, 'scripts/ci-test-plan.mjs'), 'export function selectCiTests() { return { files: [], runtime: false, browser: false } }')
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
    const ownScripts = join(root, 'candidate/dsh-agent-manage/scripts')
    mkdirSync(ownScripts, { recursive: true })
    writeFileSync(join(ownScripts, 'quality-peer-baseline.json'), JSON.stringify({ repositories }))
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

test('CI matrix separates required rc.2 from optional alpha and legacy input creation is refused', () => {
  for (const [lane, version] of [
    ['required', '0.2.0-rc.2'],
    ['compatibility', '0.2.1-alpha.1']
  ]) {
    const matrix = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--matrix', '--lane', lane], { encoding: 'utf8' })
    assert.equal(matrix.status, 0, matrix.stderr)
    const lanes = JSON.parse(matrix.stdout).include
    assert.deepEqual([...new Set(lanes.map(item => item.coreVersion))], [version])
    assert.equal(lanes.length, 2)
    assert.equal(lanes.filter(item => item.phase === 'quality' && item.os === 'ubuntu-latest').length, 1)
    assert.equal(lanes.filter(item => item.phase === 'archives' && item.os === 'windows-latest').length, 1)
  }
  const defaultMatrix = spawnSync(process.execPath, ['scripts/write-ci-input.mjs', '--matrix'], { encoding: 'utf8' })
  assert.equal(defaultMatrix.status, 0, defaultMatrix.stderr)
  assert.deepEqual([...new Set(JSON.parse(defaultMatrix.stdout).include.map(item => item.coreVersion))], ['0.2.0-rc.2'])
  const obsolete = spawnSync(process.execPath, ['scripts/write-ci-input.mjs'], { encoding: 'utf8' })
  assert.notEqual(obsolete.status, 0)
  assert.match(obsolete.stderr, /CANDIDATE_INPUT_REQUIRED/)
  for (const phase of ['quality', 'archives', 'audit']) {
    const result = call(phase, { QUALITY_CANDIDATE: '' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CANDIDATE_FINAL_GROUP_REQUIRED/)
  }
})

test('candidate execution refuses missing input and malformed original-byte hashes before source effects', () => {
  for (const hash of ['', 'main', 'A'.repeat(64), 'a'.repeat(64) + '\n']) {
    const result = spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', 'verify-input', '--final-group-sha256', hash], {
      encoding: 'utf8',
      env: { ...process.env, QUALITY_CANDIDATE: '' }
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CANDIDATE_FINAL_GROUP_REQUIRED/)
  }
  const missing = spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', 'verify-input', '--final-group-sha256', 'a'.repeat(64)], {
    encoding: 'utf8',
    env: { ...process.env, QUALITY_CANDIDATE: '' }
  })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /CANDIDATE_INPUT_REQUIRED/)
})

test('hosted events use the immutable public peer reader and admitted group without legacy fallbacks', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /repository: CleverC2200\/dsh-agent-workbench\n {10}ref: \$\{\{ steps.reader.outputs.workbench-sha \}\}/)
  assert.match(workflow, /node \.\.\/\.\.\/scope-peer\/dsh-agent-workbench\/scripts\/read-hosted-peer-input.mjs --repo dsh-agent-manage/)
  for (const field of ['gea-sha', 'workbench-sha', 'manage-sha', 'group-id', 'source-kind', 'baseline-id']) assert.ok(workflow.includes('steps.group.outputs.' + field), field)
  assert.doesNotMatch(workflow, /outputs\.[a-z-]+ \|\| '|write-ci-input.mjs --root|if: github.event_name != 'workflow_dispatch'/)
  assert.equal((workflow.match(/write-hosted-group.mjs --repo dsh-agent-manage/g) ?? []).length, 2)
  assert.equal((workflow.match(/QUALITY_SOURCE_KIND: \$\{\{ needs.candidate-scope.outputs.source-kind \}\}/g) ?? []).length, 2)
})

test('peer reader bootstrap rejects malformed dispatch heads, event mismatch and uncommitted source baseline', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const validator = workflow
    .match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n {10}NODE/)?.[1]
    .split('\n')
    .map(line => line.slice(10))
    .join('\n')
  assert.ok(validator)
  const root = mkdtempSync(join(tmpdir(), 'manage-reader-scope-'))
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  try {
    mkdirSync(join(root, 'scripts'))
    const baselineFile = join(root, 'scripts/quality-peer-baseline.json')
    writeFileSync(baselineFile, JSON.stringify({ schemaVersion: 1, repositories: [{ repo: 'dsh-agent-workbench', head: 'b'.repeat(40) }] }))
    git(['init', '--quiet'])
    git(['add', '.'])
    git(['-c', 'user.name=CI fixture', '-c', 'user.email=ci@example.invalid', 'commit', '--quiet', '-m', 'fixture'])
    const own = git(['rev-parse', 'HEAD'])
    const output = join(root, 'output')
    const valid = {
      GITHUB_REPOSITORY: 'CleverC2200/dsh-agent-manage',
      QUALITY_OWN_REPO: 'dsh-agent-manage',
      QUALITY_SCOPE_ALLOWED: 'true',
      QUALITY_EXPECTED_SHA: own,
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      QUALITY_GROUP_WORKBENCH: 'b'.repeat(40)
    }
    const run = change =>
      spawnSync(process.execPath, ['--input-type=module', '-e', validator], { cwd: root, encoding: 'utf8', env: { ...process.env, ...valid, ...change, GITHUB_OUTPUT: output } })
    for (const change of [
      { QUALITY_GROUP_WORKBENCH: '' },
      { QUALITY_GROUP_WORKBENCH: 'main' },
      { QUALITY_GROUP_WORKBENCH: 'B'.repeat(40) },
      { QUALITY_GROUP_WORKBENCH: 'b'.repeat(40) + '\n' },
      { QUALITY_GROUP_WORKBENCH: '$(touch unsafe)' },
      { QUALITY_EXPECTED_SHA: 'd'.repeat(40) },
      { QUALITY_SCOPE_ALLOWED: 'false' }
    ]) {
      const result = run(change)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /CANDIDATE_BASELINE_REQUIRED|CANDIDATE_EVENT_MISMATCH|CANDIDATE_SCOPE_REQUIRED/)
      assert.equal(existsSync(output), false)
    }
    const good = run({ GITHUB_EVENT_NAME: 'push' })
    assert.equal(good.status, 0, good.stderr)
    assert.equal(readFileSync(output, 'utf8'), 'workbench-sha=' + 'b'.repeat(40) + '\n')
    rmSync(output)
    writeFileSync(baselineFile, '{}')
    const dirty = run({ GITHUB_EVENT_NAME: 'push' })
    assert.notEqual(dirty.status, 0)
    assert.match(dirty.stderr, /CANDIDATE_BASELINE_REQUIRED/)
    assert.equal(existsSync(output), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('joint dispatch isolates in-flight runs and retains required Windows and audit lanes', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /github\.ref \}\}/)
  for (const key of ['gea_sha', 'workbench_sha', 'manage_sha']) {
    assert.match(workflow, new RegExp('      ' + key + ':\\n        description: [^\\n]+\\n        required: true\\n        type: string'))
  }
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.run_id/)
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name != 'workflow_dispatch' \}\}/)
  assert.match(
    workflow,
    /QUALITY_PHASE: \$\{\{ matrix.phase == 'quality' && needs.candidate-scope.outputs.business-lane == 'business-profile' && 'business-profile' \|\| matrix.phase \}\}/
  )
  assert.match(
    workflow,
    /'--phase', process.env.QUALITY_PHASE, '--input', process.env.QUALITY_CANDIDATE, '--prepare-sdk', '--core-source', resolve\(process.env.GITHUB_WORKSPACE, 'source\/official-core'\), '--final-group-sha256', process.env.INPUT_SHA256/
  )
  assert.match(workflow, /--phase audit --input "\$QUALITY_CANDIDATE" --core-source "\$GITHUB_WORKSPACE\/source\/official-core" --final-group-sha256 "\$INPUT_SHA256"/)
  assert.match(workflow, /path: source\/official-core/)
  assert.match(workflow, /candidate-group\.json/)
  assert.match(workflow, /dependency-review:[\s\S]*if: github.event_name == 'pull_request'/)
  const requiredWorkflow = workflow.replace(/ {6}- name: Save verified SDK cache[\s\S]*?(?=\n {6}- name: Keep)/g, '')
  assert.doesNotMatch(requiredWorkflow, /continue-on-error|pull_request_target/)
  assert.match(workflow, /timeout-minutes: 1\n {8}uses: actions\/cache\/save@v4/)
})

test('joint execution keeps the native runner environment and forwards the complete CLI with failure status', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  const step = workflow.match(/ {6}- name: Prepare independent SDK and run all admitted group gates\n([\s\S]*?)\n {6}- name:/)?.[1]
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
          env: {
            ...process.env,
            GITHUB_WORKSPACE: root,
            QUALITY_PHASE: phase,
            QUALITY_CANDIDATE: join(root, 'candidate-input.json'),
            INPUT_SHA256: 'a'.repeat(64),
            PROTOCOL_OUTPUT: output,
            PROTOCOL_EXIT: String(exit)
          }
        })
        assert.equal(result.status, exit, result.stderr)
        const observed = JSON.parse(readFileSync(output, 'utf8'))
        assert.deepEqual(observed.args, [
          '--phase',
          phase,
          '--input',
          join(root, 'candidate-input.json'),
          '--prepare-sdk',
          '--core-source',
          resolve(root, 'source/official-core'),
          '--final-group-sha256',
          'a'.repeat(64)
        ])
        assert.equal(observed.path, process.env.PATH, 'Node must preserve the runner PATH for archive tools')
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('personal integration cannot trigger upstream release or Pages publication', () => {
  const npm = readFileSync('.github/workflows/npm-publish.yml', 'utf8')
  const pages = readFileSync('.github/workflows/docs-pages.yml', 'utf8')
  const deny = "github.repository != 'CleverC2200/dsh-agent-manage'"
  const job = (workflow, name) => workflow.match(new RegExp('^  ' + name + ':\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))', 'm'))?.[1]
  for (const [workflow, name] of [
    [npm, 'release-please'],
    [npm, 'npm-publish'],
    [pages, 'build'],
    [pages, 'deploy']
  ]) {
    const body = job(workflow, name)
    assert.ok(body, name)
    assert.ok(body.includes(deny), name + ' must refuse publication from the registered personal repository')
  }
  assert.match(npm, /pnpm publish --no-git-checks --provenance/)
  assert.match(pages, /actions\/deploy-pages@v5/)
})

async function sourceImpactFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manage-source-impact-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = resolve(import.meta.dirname, '..')
  const workbenchSource = process.env.QUALITY_POLICY_WORKBENCH ?? resolve(source, '../dsh-agent-workbench')
  const { selectCiTests } = await import(pathToFileURL(join(workbenchSource, 'scripts/ci-test-plan.mjs')))
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (path, bytes) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
  const commit = path => {
    git(path, 'add', '.')
    git(path, '-c', 'user.name=fixture', '-c', 'user.email=fixture@invalid', 'commit', '--quiet', '-m', 'source snapshot')
    return git(path, 'rev-parse', 'HEAD')
  }
  const repositories = []
  for (const repo of ['dsh-agent-workbench', 'dsh-gea-plugin', 'dsh-agent-manage']) {
    const path = join(root, repo)
    write(join(path, 'package.json'), JSON.stringify({ name: repo }))
    git(path, 'init', '--quiet')
    if (repo === 'dsh-agent-manage') {
      // Snapshot authored inputs only; concurrent scratch directories and builds have other owners.
      for (const file of git(source, 'ls-files', '-z').split('\0').filter(Boolean)) {
        if (file.startsWith('lib/') || !/\.(?:[cm]?[jt]sx?|css|html|json|ya?ml)$/.test(file)) continue
        write(join(path, file), readFileSync(join(source, file)))
      }
      write(join(path, 'scripts/quality-peer-baseline.json'), JSON.stringify({ repositories: repositories.map(({ repo, head }) => ({ repo, head })) }))
    }
    repositories.push({ repo, path, head: commit(path) })
  }
  const own = repositories.find(entry => entry.repo === 'dsh-agent-manage')
  const workbench = repositories.find(entry => entry.repo === 'dsh-agent-workbench')
  const base = own.head
  return {
    own,
    repositories,
    change(file, entry = workbench) {
      const path = join(entry.path, file)
      write(path, existsSync(path) ? Buffer.concat([readFileSync(path), Buffer.from('\n')]) : 'changed fixture source\n')
      entry.head = commit(entry.path)
    },
    select: () => selectCiTests({ repositories, repo: own.repo, base })
  }
}

test('regional page source selects its Manage resource contract without unrelated tests', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('static/regional/source/index.html')
  const plan = fixture.select()
  assert.deepEqual(plan.reasons['dsh-agent-workbench/static/regional/source/index.html'], ['tests/business-resources.test.ts'])
  assert.deepEqual(plan.files, ['tests/agent-mcp.test.ts', 'tests/business-resources.test.ts', 'tests/routes.test.ts'])
  assert.deepEqual(plan.required, ['tests/agent-mcp.test.ts', 'tests/routes.test.ts'])
})

test('category page source selects the same Manage resource contract', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('static/category/source/app.js')
  const plan = fixture.select()
  assert.deepEqual(plan.reasons['dsh-agent-workbench/static/category/source/app.js'], ['tests/business-resources.test.ts'])
  assert.deepEqual(plan.files, ['tests/agent-mcp.test.ts', 'tests/business-resources.test.ts', 'tests/routes.test.ts'])
})

test('MPS page source selects its dedicated resource reception contract', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('static/mps/source/app.js')
  const plan = fixture.select()
  assert.deepEqual(plan.reasons['dsh-agent-workbench/static/mps/source/app.js'], ['tests/mps-resource-reception.test.ts'])
  assert.deepEqual(plan.files, ['tests/agent-mcp.test.ts', 'tests/mps-resource-reception.test.ts', 'tests/routes.test.ts'])
})

test('unregistered source and neighbouring static directories remain unmapped', async t => {
  for (const [file, own] of [
    ['src/unmapped-fixture.ts', true],
    ['static/regional-unregistered/source/index.html', false]
  ]) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(file, own ? fixture.own : undefined)
    assert.throws(() => fixture.select(), /CI_TEST_IMPACT_UNMAPPED/)
  }
})

test('missing static resource consumer contracts reject the plan instead of silently shrinking it', async t => {
  for (const [source, target] of [
    ['static/regional/source/index.html', 'tests/business-resources.test.ts'],
    ['static/mps/source/app.js', 'tests/mps-resource-reception.test.ts']
  ]) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(source)
    rmSync(join(fixture.own.path, target))
    assert.throws(() => fixture.select(), /CI_TEST_FILE_REQUIRED/)
  }
})

test('a Manage policy edit runs the static resource consumers in its own source CI plan', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('scripts/ci-test-policy.json', fixture.own)
  const plan = fixture.select()
  assert.deepEqual(
    plan.reasons['dsh-agent-manage/scripts/ci-test-policy.json'],
    [
      ...Object.values(presetLanes).flatMap(lane => Object.keys(lane)),
      'tests/agent-mcp.test.ts',
      'tests/business-resources.test.ts',
      'tests/mps-resource-reception.test.ts',
      'tests/routes.test.ts'
    ].sort()
  )
  assert.deepEqual(plan.files, plan.reasons['dsh-agent-manage/scripts/ci-test-policy.json'])
})

test('quality executes planned capability files once and leaves the ordinary batch disjoint', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'manage-quality-selection-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repositories = ['dsh-agent-workbench', 'dsh-agent-manage', 'dsh-gea-plugin'].map(repo => {
    const path = join(root, 'candidate', repo)
    mkdirSync(join(path, 'scripts'), { recursive: true })
    return { repo, path, head: 'a'.repeat(40) }
  })
  const own = repositories.find(entry => entry.repo === 'dsh-agent-manage').path
  const workbench = repositories.find(entry => entry.repo === 'dsh-agent-workbench').path
  const plan = {
    schemaVersion: 1,
    mode: 'required-and-affected',
    repo: 'dsh-agent-manage',
    files: ['tests/routes.test.ts', 'tests/standard-preset.test.ts', 'tests/standard-preset-draft.test.ts', 'tests/user-agent-cube-gea.test.ts']
  }
  writeFileSync(join(own, 'scripts/quality-peer-baseline.json'), JSON.stringify({ repositories }))
  writeFileSync(join(own, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: {} } }))
  writeFileSync(join(workbench, 'package.json'), JSON.stringify({ packageManager: 'npm@11.11.0' }))
  writeFileSync(join(workbench, 'scripts/ci-test-plan.mjs'), `export const selectCiTests = () => (${JSON.stringify(plan)})`)
  writeFileSync(
    join(workbench, 'scripts/candidate-input.mjs'),
    `export const readFinalGroup = async () => ({ manifest: ${JSON.stringify({ core: 'b'.repeat(40), repositories })}, verifyUnchanged() {} })`
  )
  const callsFile = join(root, 'calls.json')
  const hook = join(root, 'quality-boundary.mjs')
  writeFileSync(
    hook,
    `import cp from 'node:child_process'; import { registerHooks, syncBuiltinESMExports } from 'node:module'; import { writeFileSync } from 'node:fs';
    const calls = [];
    cp.spawnSync = (command, args) => { calls.push({ command, args }); writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls)); return { status: 0 }; };
    cp.execFileSync = () => '11.11.0';
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url !== ${JSON.stringify(pathToFileURL(resolve('scripts/prepare-official-sdk.mjs')).href)}) return next(url, context);
      return { format: 'module', shortCircuit: true, source: 'export const verifyOfficialSDK = () => {}; export const prepareOfficialSDK = () => {}; export const verifyOfficialSource = () => {}' };
    } });`
  )
  const result = spawnSync(
    process.execPath,
    ['--import', hook, resolve('scripts/run-quality-ci.mjs'), '--phase', 'quality', '--input', join(root, 'input.json'), '--final-group-sha256', 'a'.repeat(64)],
    {
      cwd: own,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: '' }
    }
  )
  assert.equal(result.status, 0, result.stderr)
  const calls = JSON.parse(readFileSync(callsFile, 'utf8'))
  const capabilities = calls.filter(call => call.args.includes('check:capabilities') || call.args.some(arg => arg.endsWith('check-preset-capabilities.mjs')))
  assert.equal(capabilities.length, 1)
  const capability = capabilities[0]
  const planIndex = capability.args.indexOf('--plan')
  assert.notEqual(planIndex, -1)
  assert.deepEqual(JSON.parse(readFileSync(capability.args[planIndex + 1], 'utf8')), plan)
  const ordinary = calls.filter(call => call.args.includes('vitest'))
  assert.equal(ordinary.length, 1)
  assert.deepEqual(
    ordinary[0].args.filter(arg => arg.startsWith('tests/')),
    ['tests/routes.test.ts']
  )
})

test('Core preparation and lane configuration changes select their real capability contracts', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('scripts/prepare-official-sdk.mjs', fixture.own)
  const plan = fixture.select()
  for (const file of ['tests/standard-preset.test.ts', 'tests/standard-preset-draft.test.ts', 'tests/standard-preset-gea.test.ts', 'tests/manage-bundle-default.test.ts']) {
    assert.ok(plan.files.includes(file), file)
  }
})

test('client Host helper changes select the owning draft lifecycle instead of a standalone helper', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('tests/base-resource-host.test.ts', fixture.own)
  const plan = fixture.select()
  assert.ok(plan.files.includes('tests/base-preset-client.test.ts'))
  assert.equal(plan.files.includes('tests/base-resource-host.test.ts'), false)
})

test('GEA authorization and Workbench resource selection changes retain their real capability lanes', async t => {
  for (const [repo, file, expected] of [
    ['dsh-gea-plugin', 'src/host/business-identity.ts', 'tests/standard-preset-gea.test.ts'],
    ['dsh-agent-workbench', 'src/resource-selection.ts', 'tests/base-preset-client.test.ts']
  ]) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(
      file,
      fixture.repositories.find(entry => entry.repo === repo)
    )
    const plan = fixture.select()
    assert.ok(plan.files.includes(expected), file)
    assert.equal(plan.files.includes('tests/manage-cold-boot.test.ts'), false)
  }
})

test('dynamic inventory resources keep the inventory Session and GEA contracts', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('business-resources/inventory-qll/prompt.json', fixture.own)
  const plan = fixture.select()
  assert.ok(plan.files.includes('tests/inventory-family-client.test.ts'))
  assert.ok(plan.files.includes('tests/inventory-family-preset.test.ts'))
  assert.equal(plan.files.includes('tests/manage-cold-boot.test.ts'), false)
})

test('unrelated CI input writer changes keep the required floor without fixed capability batches', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('scripts/write-ci-input.mjs', fixture.own)
  assert.deepEqual(fixture.select().files, ['tests/agent-mcp.test.ts', 'tests/routes.test.ts'])
})

test('Workbench Session preparation and registered Core inputs keep the capability consumers', async t => {
  for (const [repo, file, expected] of [
    ['dsh-agent-workbench', 'src/page-session-core.ts', 'tests/base-preset-client.test.ts'],
    ['dsh-gea-plugin', 'scripts/supported-cores.json', 'tests/standard-preset.test.ts']
  ]) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(
      file,
      fixture.repositories.find(entry => entry.repo === repo)
    )
    assert.ok(fixture.select().files.includes(expected), file)
  }
})
