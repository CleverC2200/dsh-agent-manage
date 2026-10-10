import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { root: { type: 'string' }, sha: { type: 'string' }, 'core-head': { type: 'string' }, matrix: { type: 'boolean' } } })
const supported = JSON.parse(readFileSync(new URL('../../dsh-gea-plugin/scripts/supported-cores.json', import.meta.url), 'utf8'))
if (values.matrix) {
  const matrix = {
    include: supported.flatMap(core => [
      { os: 'ubuntu-latest', phase: 'quality', coreHead: core.head, coreVersion: core.version },
      { os: 'windows-latest', phase: 'archives', coreHead: core.head, coreVersion: core.version }
    ])
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
    appendFileSync(process.env.GITHUB_OUTPUT, `audit-matrix=${JSON.stringify({ include: matrix.include.filter(entry => entry.phase === 'quality') })}\n`)
  }
  console.log(JSON.stringify(matrix))
} else {
  if (!values.root || !/^[a-f0-9]{40}$/.test(values.sha ?? '')) throw Error('CANDIDATE_EVENT_REQUIRED: root and actual event SHA')
  if (!supported.some(core => core.head === values['core-head'])) throw Error('CANDIDATE_CORE_REQUIRED: explicitly bind a registered Core head')
  const root = resolve(values.root)
  writeFileSync(
    resolve(root, 'candidate-input.json'),
    JSON.stringify(
      {
        core: values['core-head'],
        repositories: [
          { repo: 'dsh-agent-workbench', path: resolve(root, 'candidate/dsh-agent-workbench'), head: '0d98253df33128632d2b927e5c3c6db512647384' },
          { repo: 'dsh-agent-manage', path: resolve(root, 'candidate/dsh-agent-manage'), head: values.sha },
          { repo: 'dsh-gea-plugin', path: resolve(root, 'candidate/dsh-gea-plugin'), head: '0a7663db00657541bbda297a3fa702d6ed285b26' }
        ]
      },
      null,
      2
    ) + '\n'
  )
}
