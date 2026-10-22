import process from 'node:process'
import console from 'node:console'
import { appendFileSync, readFileSync } from 'node:fs'
import { ciCores } from '../../dsh-gea-plugin/scripts/ci-core-policy.mjs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { matrix: { type: 'boolean' }, lane: { type: 'string', default: 'required' }, plan: { type: 'string' } } })
const supported = ciCores(values.lane)
if (!values.matrix) throw Error('CANDIDATE_INPUT_REQUIRED: use the shared hosted group writer for candidate inputs')
const plan = values.plan ? JSON.parse(readFileSync(values.plan, 'utf8')) : undefined
if (
  plan &&
  (plan.schemaVersion !== 1 || plan.repo !== 'dsh-agent-manage' || !['docs', 'source'].includes(plan.applicability) || !Array.isArray(plan.changes) || !Array.isArray(plan.files))
)
  throw Error('CI_TEST_PLAN_REQUIRED')
const docs = plan?.applicability === 'docs'
const changes = plan?.changes ?? []
const dependencyInput = file => /^(?:package\.json|pnpm-lock\.yaml|package-lock\.json)$/.test(file)
const audit =
  !docs &&
  (!plan ||
    changes.some(
      ({ repo, file }) =>
        dependencyInput(file) ||
        (repo === 'dsh-agent-manage' && /^(?:scripts\/(?:run-quality-ci|write-ci-input)\.mjs|\.github\/workflows\/(?:quality|compatibility)\.yml)$/.test(file))
    ))
const dependencyReview = !docs && (!plan || changes.some(({ repo, file }) => repo === 'dsh-agent-manage' && dependencyInput(file)))
const archives =
  !docs &&
  (!plan ||
    plan.files.some(file => ['tests/source-acquisition.test.ts', 'tests/zip-bomb.test.ts', 'tests/private-archive.test.ts'].includes(file)) ||
    changes.some(({ file }) =>
      /^(?:package\.json|pnpm-lock\.yaml|tsconfig[^/]*|vitest[^/]*|scripts\/(?:prepare-official-sdk\.mjs|sdk-artifact-cache\.mjs|supported-cores\.(?:mjs|json)|current-core\.json|ci-core-policy\.(?:mjs|json)|write-ci-input\.mjs|run-quality-ci\.mjs)|\.github\/workflows\/(?:quality|compatibility)\.yml)$/.test(
        file
      )
    ))
const matrix = {
  include: supported
    .flatMap(core => [
      { os: 'ubuntu-latest', phase: 'quality', coreHead: core.head, coreVersion: core.version },
      { os: 'windows-latest', phase: 'archives', coreHead: core.head, coreVersion: core.version }
    ])
    .filter(entry => entry.phase === 'quality' || archives)
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `core-head=${supported[0].head}\napplicability=${docs ? 'docs' : 'source'}\naudit-applicable=${audit}\ndependency-review-applicable=${dependencyReview}\n`
  )
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `audit-matrix=${JSON.stringify({ include: matrix.include.filter(entry => entry.phase === 'quality') })}\n`)
}
console.log(JSON.stringify(matrix))
