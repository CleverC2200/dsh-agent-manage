import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import process from 'node:process'
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Buffer } from 'node:buffer'
import { parse as parseYaml } from 'yaml'
import { presetHostOwners } from '../scripts/preset-test-lanes.mjs'

const call = (phase, env) =>
  spawnSync(process.execPath, ['scripts/run-quality-ci.mjs', '--phase', phase], {
    encoding: 'utf8',
    env: { ...process.env, QUALITY_APPLICABILITY: 'source', QUALITY_AUDIT_APPLICABLE: 'false', QUALITY_DEPENDENCY_APPLICABLE: 'false', ...env }
  })
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

test('final quality rejects failed applicable security checks and accepts explicitly inapplicable lanes', () => {
  const successful = { QUALITY_SCOPE_RESULT: 'success', QUALITY_GATE_RESULT: 'success', QUALITY_WINDOWS_RESULT: 'success' }
  for (const key of ['QUALITY_APPLICABILITY', 'QUALITY_AUDIT_APPLICABLE', 'QUALITY_DEPENDENCY_APPLICABLE']) assert.equal(call('final', { ...successful, [key]: '' }).status, 1)
  for (const state of ['failure', 'cancelled', 'skipped', '']) {
    assert.equal(call('final', { ...successful, QUALITY_AUDIT_APPLICABLE: 'true', QUALITY_AUDIT_RESULT: state }).status, 1)
    assert.equal(call('final', { ...successful, QUALITY_DEPENDENCY_APPLICABLE: 'true', QUALITY_DEPENDENCY_RESULT: state }).status, 1)
  }
  assert.equal(
    call('final', {
      ...successful,
      QUALITY_AUDIT_APPLICABLE: 'true',
      QUALITY_AUDIT_RESULT: 'success',
      QUALITY_DEPENDENCY_APPLICABLE: 'true',
      QUALITY_DEPENDENCY_RESULT: 'success'
    }).status,
    0
  )
  assert.equal(call('final', { ...successful, QUALITY_APPLICABILITY: 'docs', QUALITY_AUDIT_RESULT: 'skipped', QUALITY_DEPENDENCY_RESULT: 'skipped' }).status, 0)
  assert.equal(
    call('final', {
      ...successful,
      QUALITY_AUDIT_APPLICABLE: 'false',
      QUALITY_AUDIT_RESULT: 'skipped',
      QUALITY_DEPENDENCY_APPLICABLE: 'false',
      QUALITY_DEPENDENCY_RESULT: 'skipped'
    }).status,
    0
  )
})

test('automatic source checks and manual joint checks use distinct merge contexts', () => {
  const joint = readFileSync('.github/workflows/quality.yml', 'utf8')
  const source = readFileSync('.github/workflows/source-quality.yml', 'utf8')
  assert.doesNotMatch(joint, /^ {2}(push|pull_request):/m)
  assert.match(joint, /^ {2}workflow_dispatch:/m)
  assert.match(joint, /name: joint-quality/)
  assert.match(source, /^ {2}push:/m)
  assert.match(source, /^ {2}pull_request:/m)
  assert.match(source, /^ {2}candidate-quality:/m)
  const checks = parseYaml(source).jobs['source-checks'].steps
  for (const step of checks.filter(step => step.with?.repository?.startsWith('CleverC2200/dsh-agent-'))) assert.equal(step.if, "needs.source-plan.outputs.engineering == 'true'")
  assert.equal(
    checks.find(step => step.name === 'Prepare or verify SDK through existing cache contract').if,
    "steps.affected.outputs.sdk == 'true' && steps.reuse.outputs.hit != 'true'"
  )
  assert.equal(checks.find(step => step.name === 'Select affected behavior and type checks before preparation').run, 'node scripts/source-quality.mjs --phase affected-plan')
  assert.match(checks.find(step => step.id === 'core').run, /ciCores\('required'\)/)
  assert.doesNotMatch(checks.find(step => step.id === 'core').run, /current-core|adaptation/)
})

test('hosted quality prepares the declared Workbench npm before peer installation', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /npm install --global npm@11\.11\.0/)
})

test('quality requests the real SDK while archives prepare or verify only admitted source', () => {
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
          export const prepareOfficialSource = options => stop('prepare-source', options);
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
        assert.equal(boundary.method, phase === 'audit' ? 'source' : phase === 'archives' ? (prepare ? 'prepare-source' : 'source') : prepare ? 'prepare' : 'verify')
        assert.equal(boundary.options.coreHead, coreHead)
        assert.equal(boundary.options.withFlock, phase === 'quality')
        if (phase === 'audit' || (phase === 'archives' && !prepare)) assert.equal(boundary.options.observedCore, join(root, 'source', 'official-core'))
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
  assert.match(workflow, /node \.\.\/dsh-agent-workbench\/scripts\/read-hosted-peer-input.mjs --repo dsh-agent-manage/)
  for (const field of ['gea-sha', 'workbench-sha', 'manage-sha', 'group-id', 'source-kind', 'baseline-id']) assert.ok(workflow.includes('steps.group.outputs.' + field), field)
  assert.doesNotMatch(workflow, /outputs\.[a-z-]+ \|\| '|write-ci-input.mjs --root|if: github.event_name != 'workflow_dispatch'/)
  assert.equal((workflow.match(/write-hosted-group.mjs --repo dsh-agent-manage/g) ?? []).length, 3)
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

test('joint dispatch isolates in-flight runs and retains applicable Windows and audit lanes', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  assert.match(workflow, /github\.ref \}\}/)
  for (const key of ['gea_sha', 'workbench_sha', 'manage_sha']) {
    assert.match(workflow, new RegExp('      ' + key + ':\\n        description: [^\\n]+\\n        required: true\\n        type: string'))
  }
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && github.run_id/)
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name != 'workflow_dispatch' \}\}/)
  assert.match(workflow, /QUALITY_PHASE: \$\{\{ matrix.phase \}\}/)
  assert.match(
    workflow,
    /'--phase', process.env.QUALITY_PHASE, '--input', process.env.QUALITY_CANDIDATE, '--prepare-sdk', '--core-source', resolve\(process.env.GITHUB_WORKSPACE, 'source\/official-core'\), '--final-group-sha256', process.env.INPUT_SHA256/
  )
  assert.match(workflow, /--phase audit --input "\$QUALITY_CANDIDATE" --core-source "\$GITHUB_WORKSPACE\/source\/official-core" --final-group-sha256 "\$INPUT_SHA256"/)
  assert.match(workflow, /path: source\/official-core/)
  assert.match(workflow, /candidate-group\.json/)
  assert.match(workflow, /dependency-review:[\s\S]*if: github.event_name == 'pull_request'/)
  const requiredWorkflow = workflow.replace(
    / {6}- name: (?:Save verified SDK cache[^\n]*|Inspect bounded main download cache|Save bounded main download cache)\n[\s\S]*?(?=\n {6}- name:)/g,
    ''
  )
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
  const npm = readFileSync('docs/history/upstream-workflows/npm-publish.yml', 'utf8')
  const pages = readFileSync('docs/history/upstream-workflows/docs-pages.yml', 'utf8')
  assert.equal(existsSync('.github/workflows/npm-publish.yml'), false)
  assert.equal(existsSync('.github/workflows/docs-pages.yml'), false)
  assert.match(npm, /pnpm publish --no-git-checks --provenance/)
  assert.match(pages, /actions\/deploy-pages@v5/)
})

async function sourceImpactFixture(t, { fullSource = false } = {}) {
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
      for (const file of git(source, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
        if (!existsSync(join(source, file)) || file.startsWith('lib/') || !/\.(?:[cm]?[jt]sx?|css|html|json|ya?ml)$/.test(file)) continue
        if (fullSource || file === 'scripts/ci-test-policy.json' || /^scripts\/workflow-preflight(?:\.test)?\.mjs$/.test(file))
          write(join(path, file), readFileSync(join(source, file)))
        else if (/^(?:tests\/[^/]+\.test\.(?:ts|mjs)|scripts\/source-quality\.test\.mjs)$/.test(file)) write(join(path, file), '')
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
    select: () => selectCiTests({ repositories, repo: own.repo, base, testOwners: presetHostOwners })
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

test('small client style and business Prompt changes avoid expensive engineering fixture suites', async t => {
  for (const file of ['src/client/market.module.css', 'business-resources/orchestration/prompt.md']) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(file, fixture.own)
    const plan = fixture.select()
    assert.equal(plan.applicability, 'source')
    for (const file of ['tests/quality-ci-cli.test.mjs', 'tests/sdk-input-cli.test.mjs', 'tests/agent-knowledge.test.mjs'])
      assert.ok(!plan.files.includes(file), JSON.stringify(plan.files))
    if (file.endsWith('prompt.md')) assert.ok(plan.files.includes('tests/bundled-sales-skills.test.ts'))
  }
})

test('changed engineering modules select their Node behavior consumers', async t => {
  const fixture = await sourceImpactFixture(t, { fullSource: true })
  fixture.change('scripts/download-cache.mjs', fixture.own)
  const plan = fixture.select()
  assert.ok(plan.files.includes('tests/download-cache.test.mjs'))
  assert.ok(!plan.files.includes('tests/sdk-input-cli.test.mjs'))
})

test('compatibility sample changes select the existing offline report consumer', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('scripts/compat-sources.json', fixture.own)
  assert.deepEqual(fixture.select().files, ['tests/agent-mcp.test.ts', 'tests/compat-report.test.ts', 'tests/routes.test.ts'])
})

test('a Manage policy edit retains its real resource and Node consumer contracts', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('scripts/ci-test-policy.json', fixture.own)
  const plan = fixture.select()
  for (const file of ['tests/business-resources.test.ts', 'tests/mps-resource-reception.test.ts', 'tests/ci-applicability.test.mjs', 'tests/quality-ci-cli.test.mjs'])
    assert.ok(plan.reasons['dsh-agent-manage/scripts/ci-test-policy.json'].includes(file), file)
  for (const file of ['tests/agent-mcp.test.ts', 'tests/routes.test.ts']) assert.ok(plan.files.includes(file), file)
})

function qualityExecution(t, files, { cacheOutput = false, invalidReceipt = false, applicability = 'source', phase = 'quality', staleStamp = false } = {}) {
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
    applicability,
    files,
    diffBase: 'a'.repeat(40),
    head: 'b'.repeat(40)
  }
  writeFileSync(join(own, 'scripts/quality-peer-baseline.json'), JSON.stringify({ repositories }))
  writeFileSync(join(own, 'tsconfig.official-paths.json'), JSON.stringify({ compilerOptions: { paths: {} } }))
  const stampBefore = "export const pluginPackageVersion = { name: 'stale', version: '0.0.0' }\n"
  if (staleStamp) {
    mkdirSync(join(own, 'src'))
    writeFileSync(join(own, 'package.json'), JSON.stringify({ name: '@example/manage', version: '1.2.3', type: 'module' }))
    writeFileSync(join(own, 'src/plugin-package-version.ts'), stampBefore)
    writeFileSync(join(own, 'scripts/generate-plugin-package-version.mjs'), readFileSync('scripts/generate-plugin-package-version.mjs'))
  }
  writeFileSync(join(workbench, 'package.json'), JSON.stringify({ packageManager: 'npm@11.11.0' }))
  writeFileSync(join(workbench, 'scripts/quality-fixture.json'), JSON.stringify({ plan, manifest: { core: 'b'.repeat(40), repositories } }))
  writeFileSync(
    join(workbench, 'scripts/ci-test-plan.mjs'),
    `import { readFileSync } from 'node:fs';
    const { plan } = JSON.parse(readFileSync(new URL('./quality-fixture.json', import.meta.url), 'utf8'));
    export const selectCiTests = ({ testOwners }) => {
      if (testOwners?.['tests/base-resource-host.test.ts'] !== 'tests/base-preset-client.test.ts') throw Error('CI_TEST_OWNER_REQUIRED');
      return plan;
    }`
  )
  writeFileSync(
    join(workbench, 'scripts/candidate-input.mjs'),
    `import { readFileSync } from 'node:fs';
    const { manifest } = JSON.parse(readFileSync(new URL('./quality-fixture.json', import.meta.url), 'utf8'));
    export const readFinalGroup = async () => ({ manifest, verifyUnchanged() {} })`
  )
  const callsFile = join(root, 'calls.json')
  const outputFile = join(root, 'github-output')
  const hook = join(root, 'quality-boundary.mjs')
  writeFileSync(
    hook,
    `import cp from 'node:child_process'; import { registerHooks, syncBuiltinESMExports } from 'node:module'; import { writeFileSync } from 'node:fs';
    const calls = [];
    const originalSpawn = cp.spawnSync;
    cp.spawnSync = (command, args) => {
      calls.push({ command, args }); writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
      if (${staleStamp} && (args.includes('check:static:ci') || args.includes('build'))) return originalSpawn(process.execPath, ['scripts/generate-plugin-package-version.mjs', ...(args.includes('check:static:ci') ? ['--check'] : [])], { cwd: ${JSON.stringify(own)}, stdio: 'inherit' });
      return { status: 0 };
    };
    cp.execFileSync = () => '11.11.0';
    syncBuiltinESMExports();
    registerHooks({ load(url, context, next) {
      if (url.endsWith("/build-admission.mjs")) return { format: "module", shortCircuit: true, source: "export const acquireBuild = () => () => {}" };
      if (url !== ${JSON.stringify(pathToFileURL(resolve('scripts/prepare-official-sdk.mjs')).href)}) return next(url, context);
      return { format: 'module', shortCircuit: true, source: 'import cp from "node:child_process"; export const verifyOfficialSDK = options => { if (options.withArtifactReceipt && ${invalidReceipt}) throw Error("SDK_CACHE_ARTIFACT_CHANGED"); }; export const prepareOfficialSDK = () => cp.spawnSync("sdk", ["prepare"]); export const prepareOfficialSource = () => cp.spawnSync("sdk", ["source"]); export const verifyOfficialSource = () => {}' };
    } });`
  )
  const result = spawnSync(
    process.execPath,
    ['--import', hook, resolve('scripts/run-quality-ci.mjs'), '--phase', phase, '--input', join(root, 'input.json'), '--final-group-sha256', 'a'.repeat(64)],
    {
      cwd: own,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: cacheOutput ? outputFile : '' }
    }
  )
  return {
    result,
    calls: existsSync(callsFile) ? JSON.parse(readFileSync(callsFile, 'utf8')) : [],
    plan,
    own,
    stampBefore,
    output: existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : ''
  }
}

test('retired business exceptions have no executable route while behavior tests remain available', () => {
  assert.doesNotMatch(readFileSync('scripts/run-quality-ci.mjs', 'utf8'), /business-profile/)
  assert.doesNotMatch(readFileSync('.github/workflows/quality.yml', 'utf8'), /business-lane|business-profile/)
  assert.ok(!existsSync('scripts/business-profile-ci.mjs'))
  assert.ok(!existsSync('scripts/business-profile-ci.test.mjs'))
  assert.ok(!existsSync('scripts/verify-lifecycle.cjs'))
  assert.ok(existsSync('docs/history/verification/verify-lifecycle.cjs'))
  for (const file of ['tests/business-resources.test.ts', 'tests/business-admission-gea.test.ts', 'tests/gea-mcp-scope.test.ts']) assert.ok(existsSync(file))
})

test('documentation quality preserves knowledge and source checks without installing or building', t => {
  const { result, calls } = qualityExecution(t, [], { applicability: 'docs' })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(calls.some(call => call.command === 'sdk' && call.args.includes('source')))
  assert.ok(calls.some(call => call.args.some(arg => arg.endsWith('check-agent-knowledge.mjs'))))
  assert.ok(calls.some(call => call.command === 'git' && call.args.includes('--check')))
  assert.ok(!calls.some(call => call.args.some(arg => ['install', 'ci', 'build', 'prepare', 'vitest'].includes(arg))))
})

test('the early plan uses the shared selector without SDK or consumer preparation', t => {
  const { result, calls } = qualityExecution(t, [], { applicability: 'docs', phase: 'plan' })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(calls, [])
})

test('a stale committed stamp stops quality before build or behavior tests without rewriting source', t => {
  const { result, calls, own, stampBefore } = qualityExecution(t, ['tests/routes.test.ts', 'tests/plugin-package-version.test.mjs'], { staleStamp: true, cacheOutput: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PLUGIN_PACKAGE_VERSION_STALE/)
  assert.match(result.stderr, /QUALITY_CHECKS_FAILED/)
  assert.ok(
    !calls.some(
      call => call.args.includes('build') || call.args.includes('vitest') || call.args.includes('--test') || call.args.some(arg => arg.endsWith('check-preset-capabilities.mjs'))
    )
  )
  assert.equal(readFileSync(join(own, 'src/plugin-package-version.ts'), 'utf8'), stampBefore)
  const receipt = JSON.parse(readFileSync(join(own, 'quality-checks.json'), 'utf8'))
  assert.equal(receipt.length, 1)
  assert.deepEqual(
    receipt.map(check => [check.name, check.status]),
    [['check:static', 'failed']]
  )
})

test('a failed consumer check retains the required failure while a verified SDK can be cached', t => {
  const { result, output } = qualityExecution(t, ['tests/standard-preset.test.ts'], { cacheOutput: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /QUALITY_CHECKS_FAILED/)
  assert.match(output, /^sdk-cache-ready=true$/m)
})

test('SDK cache readiness requires a fresh complete artifact receipt after consumer checks', t => {
  const { result, output } = qualityExecution(t, ['tests/routes.test.ts'], { cacheOutput: true, invalidReceipt: true })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /SDK_CACHE_ARTIFACT_CHANGED/)
  assert.doesNotMatch(output, /sdk-cache-ready/)
})

test('local static checks retain engineering regressions while hosted static leaves them to the plan', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts
  for (const name of ['test:knowledge', 'test:ci-inputs']) {
    assert.ok(scripts['check:static'].split(' && ').includes(`pnpm run ${name}`))
    assert.ok(!scripts['check:static:ci'].split(' && ').includes(`pnpm run ${name}`))
  }
  assert.ok(scripts['test:ci-inputs'].split(' ').includes('tests/plugin-package-version.test.mjs'))
})

test('download producers are main-only and bounded while both quality lanes retain capability reports', () => {
  const workflow = readFileSync('.github/workflows/quality.yml', 'utf8')
  for (const name of ['Inspect bounded main download cache', 'Save bounded main download cache']) {
    const step = workflow.match(new RegExp(`- name: ${name}\\n([\\s\\S]*?)\\n {6}- name:`))?.[1]
    assert.match(step, /github.event_name == 'push' && github.ref == 'refs\/heads\/main' && !cancelled\(\)/)
    assert.match(step, /continue-on-error: true\n {8}timeout-minutes: 1/)
  }
  for (const lane of ['quality', 'compatibility']) assert.match(readFileSync(`.github/workflows/${lane}.yml`, 'utf8'), /quality-capabilities\//)
})

test('download restore and save share one fixed path output across quality and compatibility', () => {
  const pathReference = '${{ steps.cache-path.outputs.paths }}'
  for (const lane of ['quality', 'compatibility']) {
    const workflow = parseYaml(readFileSync(`.github/workflows/${lane}.yml`, 'utf8'))
    const steps = Object.values(workflow.jobs).flatMap(job => job.steps ?? [])
    const locate = steps.find(step => step.id === 'cache-path')
    assert.match(locate.run, /PNPM_STORE_PATH="\$\(corepack pnpm store path --silent\)" node scripts\/download-cache\.mjs --github-paths/)
    const restore = steps.find(step => step.uses === 'actions/cache/restore@v4' && step.with.key.startsWith('downloads-'))
    assert.equal(restore.with.path, pathReference)
    const save = steps.find(step => step.uses === 'actions/cache/save@v4' && step.with.key.includes('steps.download-cache.outputs'))
    if (lane === 'quality') assert.equal(save.with.path, restore.with.path)
    else assert.equal(save, undefined, 'compatibility only restores the main-produced download cache')
  }
})

test('selected Node and Vitest files run in separate existing adapters', t => {
  const { result, calls } = qualityExecution(t, ['tests/routes.test.ts', 'tests/download-cache.test.mjs'])
  assert.equal(result.status, 0, result.stderr)
  const node = calls.filter(call => call.args.includes('--test'))
  const vitest = calls.filter(call => call.args.includes('vitest'))
  assert.deepEqual(
    node.map(call => call.args),
    [['--test', 'tests/download-cache.test.mjs']]
  )
  assert.equal(vitest.length, 1)
  assert.ok(vitest[0].args.includes('tests/routes.test.ts'))
  assert.ok(!vitest[0].args.includes('tests/download-cache.test.mjs'))
})

test('quality executes planned capability files once and leaves the ordinary batch disjoint', t => {
  const { result, calls, plan } = qualityExecution(t, [
    'tests/routes.test.ts',
    'tests/standard-preset.test.ts',
    'tests/standard-preset-draft.test.ts',
    'tests/user-agent-cube-gea.test.ts'
  ])
  assert.equal(result.status, 0, result.stderr)
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

test('CI input writer changes select their Node contracts without fixed capability batches', async t => {
  const fixture = await sourceImpactFixture(t, { fullSource: true })
  fixture.change('scripts/write-ci-input.mjs', fixture.own)
  assert.deepEqual(fixture.select().files, [
    'scripts/source-quality.test.mjs',
    'tests/agent-mcp.test.ts',
    'tests/ci-applicability.test.mjs',
    'tests/quality-ci-cli.test.mjs',
    'tests/routes.test.ts'
  ])
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

test('peer dependency inputs select the capabilities that consume those peers', async t => {
  for (const [repo, expected] of [
    ['dsh-gea-plugin', 'tests/user-agent-cube-gea.test.ts'],
    ['dsh-agent-workbench', 'tests/base-preset-client.test.ts']
  ]) {
    const fixture = await sourceImpactFixture(t)
    fixture.change(
      'package.json',
      fixture.repositories.find(entry => entry.repo === repo)
    )
    assert.ok(fixture.select().files.includes(expected), repo)
  }
})

test('archive jobs retain their required Windows gate while SDK cache work is limited to quality', () => {
  for (const lane of ['quality', 'compatibility']) {
    const workflow = readFileSync(`.github/workflows/${lane}.yml`, 'utf8')
    const source = workflow.match(/- name: Prepare owned Core source without compiling\n([\s\S]*?)\n {6}- uses:/)?.[1]
    const restore = workflow.match(/- uses: actions\/cache\/restore@v4\n {8}id: sdk-cache\n([\s\S]*?)\n {6}- name:/)?.[1]
    const save = workflow.match(/- name: Save verified SDK cache without delaying required checks\n([\s\S]*?)\n {6}- name:/)?.[1]
    assert.match(source, /if: matrix\.phase == 'quality'/)
    assert.match(restore, /if: matrix\.phase == 'quality'/)
    assert.match(save, /if: matrix\.phase == 'quality' && [^\n]*!cancelled\(\) && steps\.quality\.outputs\.sdk-cache-ready == 'true'/)
    assert.match(workflow, /QUALITY_WINDOWS_RESULT/)
  }
})

test('quality refuses an empty ordinary group without launching unfiltered Vitest discovery', t => {
  const { result, calls, own } = qualityExecution(t, ['tests/standard-preset.test.ts'])
  assert.equal(result.status, 1)
  assert.equal(
    calls.some(call => call.args.includes('vitest')),
    false
  )
  const ordinary = JSON.parse(readFileSync(join(own, 'quality-checks.json'), 'utf8')).find(check => check.name === 'required-and-affected')
  assert.equal(ordinary.status, 'failed')
  assert.match(ordinary.error, /CI_TEST_PLAN_EMPTY_ORDINARY/)
})

test('a transitive Host implementation change selects its real client owner and records child execution', async t => {
  const fixture = await sourceImpactFixture(t, { fullSource: true })
  fixture.change('src/runtime/standard-preset.ts', fixture.own)
  const plan = fixture.select()
  assert.ok(plan.files.includes('tests/base-preset-client.test.ts'))
  assert.equal(plan.files.includes('tests/base-resource-host.test.ts'), false)
  assert.equal(plan.executedBy['tests/base-resource-host.test.ts'], 'tests/base-preset-client.test.ts')
  assert.ok(plan.reasons['dsh-agent-manage/src/runtime/standard-preset.ts'].includes('tests/base-preset-client.test.ts'))
  if (process.env.REVIEW_FIX_EVIDENCE) writeFileSync(join(process.env.REVIEW_FIX_EVIDENCE, 'fixture-standard-preset-plan.json'), JSON.stringify(plan, null, 2) + '\n')
})

test('quality refuses an unowned Host helper before the ordinary config can silently exclude it', t => {
  const { result, calls } = qualityExecution(t, ['tests/routes.test.ts', 'tests/base-resource-host.test.ts'])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /CI_TEST_PLAN_UNOWNED_HOST/)
  assert.equal(
    calls.some(call => call.args.includes('vitest')),
    false
  )
})

test('a direct client owner change runs that file once without falsely recording a merged Host helper', async t => {
  const fixture = await sourceImpactFixture(t)
  fixture.change('tests/base-preset-client.test.ts', fixture.own)
  const plan = fixture.select()
  assert.equal(plan.files.filter(file => file === 'tests/base-preset-client.test.ts').length, 1)
  assert.equal(plan.files.includes('tests/base-resource-host.test.ts'), false)
  assert.equal(Object.hasOwn(plan.executedBy, 'tests/base-resource-host.test.ts'), false)
})

test('source tools skip Core while both download caches retain successful misses for reuse', () => {
  const steps = parseYaml(readFileSync('.github/workflows/source-quality.yml', 'utf8')).jobs['source-checks'].steps
  const core = steps.find(step => step.with?.repository === 'CleverC2200/deepseek-harness')
  assert.equal(core.if, "steps.affected.outputs.core == 'true' && steps.reuse.outputs.hit != 'true'")
  for (const id of ['tool-download-cache', 'download-cache']) {
    const restore = steps.find(step => step.id === id)
    const save = steps.find(step => step.uses === 'actions/cache/save@v4' && step.with?.key === '${{ steps.' + id + '.outputs.cache-primary-key }}')
    assert.equal(restore.uses, 'actions/cache/restore@v4')
    assert.ok(save)
    assert.match(save.if, /success\(\)/)
    assert.ok(save.if.includes('steps.' + id + ".outputs.cache-hit != 'true'"))
    assert.deepEqual(save.with.path, restore.with.path)
    assert.ok(steps.indexOf(save) > steps.findIndex(step => step.name === 'Prepare dependencies consumed by selected checks'))
    if (id === 'download-cache') assert.ok(steps.indexOf(save) > steps.findIndex(step => step.name === 'Run affected behavior and real TypeScript checks'))
  }
  const tools = steps.find(step => step.id === 'tool-download-cache')
  assert.equal(tools.with['restore-keys'], undefined)
  assert.equal(tools.with.path, '${{ steps.affected.outputs.tools-downloads }}')
})

test('merged PR result reuse skips only the validated body and preserves every fallback check', () => {
  const workflow = parseYaml(readFileSync('.github/workflows/source-quality.yml', 'utf8'))
  const job = workflow.jobs['source-checks'],
    steps = job.steps
  const affected = steps.findIndex(step => step.id === 'affected')
  const lookup = steps.findIndex(step => step.id === 'reuse')
  const check = steps.findIndex(step => step.name === 'Check applicable repository source')
  assert.ok(affected < lookup && lookup < check)
  assert.equal(job.permissions.actions, 'read')
  assert.equal(workflow.jobs['candidate-quality'].if, 'always()')
  assert.ok(workflow.jobs['candidate-quality'].needs.includes('source-checks'))
  const evaluate = (condition, hit) =>
    Function(
      'steps',
      'needs',
      'success',
      'return (' + condition.replace(/(steps|needs)\.([\w-]+)\.outputs\.([\w-]+)/g, (_, kind, id, output) => `${kind}["${id}"].outputs["${output}"]`) + ')'
    )({ reuse: { outputs: { hit } }, affected: { outputs: { dependencies: 'true', sdk: 'false' } } }, { 'source-plan': { outputs: { engineering: 'true' } } }, () => true)
  for (const name of [
    'Check applicable repository source',
    'Check committed package version',
    'Enable declared package managers',
    'Prepare dependencies consumed by selected checks',
    'Run affected behavior and real TypeScript checks'
  ]) {
    const step = steps.find(step => step.name === name)
    assert.equal(evaluate(step.if, 'true'), false, name)
    assert.equal(evaluate(step.if, 'false'), true, name)
    assert.equal(step['continue-on-error'], undefined)
  }
  const record = steps.findIndex(step => step.id === 'receipt')
  assert.ok(record > steps.findIndex(step => step.name === 'Run affected behavior and real TypeScript checks'))
  assert.match(steps[record].if, /success\(\)/)
  const store = steps.find(step => step.name === 'Store reusable tool-check receipt')
  assert.equal(store.with.name, 'source-result-${{ github.run_attempt }}')
  assert.equal(store.if, "steps.receipt.outputs.published == 'true'")
  assert.equal(workflow.permissions.contents, 'read')
})
