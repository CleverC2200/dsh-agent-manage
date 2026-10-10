import { test } from 'node:test'
import assert from 'node:assert/strict'
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
          export const verifyOfficialSource = (core, options) => stop('source', options);
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
