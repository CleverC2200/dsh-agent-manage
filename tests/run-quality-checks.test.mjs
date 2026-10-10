import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { runQualityChecks } from '../scripts/run-quality-checks.mjs'

test('a failing check does not prevent the independent test and build commands', async () => {
  const visited = []
  const results = await runQualityChecks([
    {
      name: 'check:refactor',
      execute: () => {
        visited.push('check:refactor')
        execFileSync(process.execPath, ['-e', 'process.exit(7)'])
      }
    },
    {
      name: 'test',
      execute: () => {
        visited.push('test')
        execFileSync(process.execPath, ['-e', 'process.exit(0)'])
      }
    },
    {
      name: 'build',
      execute: () => {
        visited.push('build')
        execFileSync(process.execPath, ['-e', 'process.exit(0)'])
      }
    }
  ])
  assert.deepEqual(visited, ['check:refactor', 'test', 'build'])
  assert.deepEqual(
    results.map(row => ({ name: row.name, status: row.status })),
    [
      { name: 'check:refactor', status: 'failed' },
      { name: 'test', status: 'passed' },
      { name: 'build', status: 'passed' }
    ]
  )
  assert.match(results[0].error, /Command failed/)
})

test('cancelled or missing executions remain non-passing and later commands are collected', async () => {
  const results = await runQualityChecks([
    {
      name: 'cancelled',
      execute: () => {
        throw Object.assign(Error('cancelled by caller'), { name: 'AbortError' })
      }
    },
    { name: 'missing' },
    { name: 'build', execute: async () => {} }
  ])
  assert.notEqual(results[0].status, 'passed')
  assert.notEqual(results[1].status, 'passed')
  assert.equal(results[2].status, 'passed')
})
