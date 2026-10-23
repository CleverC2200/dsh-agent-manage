import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'

const root = new URL('../business-resources/aps-client-profile/', import.meta.url)
const read = name => fs.readFileSync(new URL(name, root))
const manifest = JSON.parse(read('SOURCE.json'))
const profile = JSON.parse(read('profile.json'))

test('client snapshot retains all received file bytes and no unlisted payload', () => {
  const walk = (dir, prefix = '') =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      assert.ok(!entry.isSymbolicLink())
      const name = prefix + entry.name
      return entry.isDirectory() ? walk(new URL(entry.name + '/', dir), name + '/') : [name]
    })
  assert.deepEqual(
    walk(root)
      .filter(p => !['README.md', 'SOURCE.json'].includes(p))
      .sort(),
    Object.keys(manifest.files).sort()
  )
  for (const [name, hash] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name) && !name.includes('..') && !name.includes('\\'))
    assert.equal(createHash('sha256').update(read(name)).digest('hex'), hash, name)
  }
})

test('client snapshot retains the three selected skills and their enabled states', () => {
  assert.equal(profile.agentId, 'gea-html-inventory-apsplan')
  assert.ok(read(profile.prompt).length > 0)
  assert.equal(profile.skills.length, 3)
  assert.equal(new Set(profile.skills.map(skill => skill.name)).size, 3)
  assert.deepEqual(
    profile.skills
      .filter(skill => skill.enabled)
      .map(skill => skill.name)
      .sort(),
    ['answer-visualization', 'order-satisfaction-analysis', 'plan-operations-weekly-report']
  )
  for (const skill of profile.skills) {
    assert.equal(skill.entry, `skills/${skill.name}/SKILL.md`)
    assert.ok(read(skill.entry).length > 0)
  }
})

test('received resource bytes are protected from checkout line ending conversion', () => {
  const attributes = fs.readFileSync(new URL('../.gitattributes', import.meta.url), 'utf8')
  for (const rule of [
    'business-resources/aps-client-profile/prompt.md -text whitespace=cr-at-eol,-blank-at-eof',
    'business-resources/aps-client-profile/skills/** -text whitespace=cr-at-eol,-blank-at-eof',
    'business-resources/aps-client-profile/profile.json text eol=lf'
  ]) {
    assert.ok(attributes.split(/\r?\n/).includes(rule), rule)
  }
})
