import { URL } from 'node:url'
import process from 'node:process'
import console from 'node:console'
import { readFileSync, appendFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { matrix: { type: 'boolean' } } })
const supported = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/supported-cores.json', import.meta.url), 'utf8'))
if (!values.matrix) throw Error('CANDIDATE_INPUT_REQUIRED: use the shared hosted group writer for candidate inputs')
const matrix = {
  include: supported
    .filter(core => !core.id)
    .flatMap(core => [
      { os: 'ubuntu-latest', phase: 'quality', coreHead: core.head, coreVersion: core.version },
      { os: 'windows-latest', phase: 'archives', coreHead: core.head, coreVersion: core.version }
    ])
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `audit-matrix=${JSON.stringify({ include: matrix.include.filter(entry => entry.phase === 'quality') })}\n`)
}
console.log(JSON.stringify(matrix))
