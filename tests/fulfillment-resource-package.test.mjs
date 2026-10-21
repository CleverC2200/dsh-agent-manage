import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { URL } from 'node:url'

const root = new URL('../business-resources/inventory-orderfulfillment/', import.meta.url)
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'))
const hash = value => createHash('sha256').update(value).digest('hex')

test('received fulfillment prompt and complete Skill tree retain provenance and readable references', async () => {
  const source = await json('SOURCE.json')
  const prompt = await readFile(new URL('agent-prompt.md', root))
  assert.equal(hash(prompt), source.promptSha256)
  const profile = await json('prompt.json')
  assert.ok(
    profile.persona.startsWith(
      prompt
        .toString('utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n')
    )
  )
  assert.equal(profile.skills.length, 8)
  for (const file of source.files) {
    const bytes = await readFile(new URL(file.path, root))
    assert.equal(hash(bytes), file.packagedSha256, file.path)
    assert.doesNotMatch(bytes.toString('utf8'), /\/Users\//, file.path)
    if (!file.path.endsWith('/SKILL.md')) continue
    const text = bytes.toString('utf8')
    const name = text.match(/^name: (.+)$/m)?.[1].trim()
    assert.ok(profile.skills.includes(name), name)
    assert.match(text, /当前安装能力边界/)
    for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      if (/^[a-z]+:/i.test(match[1])) continue
      await readFile(new URL(match[1], new URL(file.path, root)))
    }
  }
  const paths = await readdir(new URL('skills/', root), { recursive: true })
  assert.ok(paths.every(path => !/\.DS_Store|__MACOSX/.test(path)))
  const capability = await json('capability.json')
  assert.deepEqual(capability.skills, profile.skills)
  assert.equal(capability.data.consumerCode, 'order01')
  assert.notEqual(capability.data.mock, true)
  assert.equal(capability.maxEffect, 'view')
  assert.deepEqual((await json('mcp.json')).capabilities, ['governed-sql-read'])
})
