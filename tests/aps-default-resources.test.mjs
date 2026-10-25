import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { URL } from 'node:url'
const root = new URL('../business-resources/inventory-apsplan/', import.meta.url)
const profile = JSON.parse(readFileSync(new URL('prompt.json', root)))
const expected = ['plan-operations-weekly-report', 'answer-visualization', 'order-satisfaction-analysis']
test('installed APS defaults use the approved persona and exactly three complete Skills', () => {
  assert.deepEqual(profile.skills, expected)
  const approved = readFileSync(new URL('../business-resources/aps-client-profile/prompt.md', import.meta.url), 'utf8')
  assert.ok(profile.persona.includes(approved.trim()))
  for (const name of expected) assert.ok(existsSync(new URL(`skills/${name}/SKILL.md`, root)), name)
  assert.deepEqual(JSON.parse(readFileSync(new URL('capability.json', root))).skills, expected)
})
