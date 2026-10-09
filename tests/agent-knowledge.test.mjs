import { test } from 'node:test'
import process from 'node:process'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'

const wrapper = resolve('scripts/check-agent-knowledge.mjs')
const baseline = '5260ba56f70dcf2f59cfca154721d2234ca8f43e'
const note = '.agents/notes/implemented/bug-fix/2026-09-14-mcp-resource-reader.md'
const restoredChinese = readFileSync(note.replace(/\.md$/, '.zh.md'), 'utf8')

test('the actual missing Chinese resource note is refused and its restored counterpart makes the reference valid', () => {
  const historical = execFileSync('git', ['show', `${baseline}:${note}`], { encoding: 'utf8' })
  const root = mkdtempSync(join(tmpdir(), 'manage-knowledge-'))
  try {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: {} }))
    writeFileSync(join(root, 'docs/agent-knowledge.json'), JSON.stringify({ entries: ['docs/current.md'] }))
    writeFileSync(join(root, 'docs/current.md'), '[English](resource.md) | [中文](resource.zh.md)\n')
    writeFileSync(join(root, 'docs/resource.md'), historical)
    const call = () => spawnSync(process.execPath, [wrapper], { cwd: root, env: process.env, encoding: 'utf8' })
    const red = call()
    assert.notEqual(red.status, 0)
    assert.match(red.stderr, /AGENT_REFERENCE_MISSING/)
    assert.match(red.stderr, /resource\.zh\.md/)
    writeFileSync(join(root, 'docs/resource.zh.md'), restoredChinese)
    const green = call()
    assert.equal(green.status, 0, green.stdout + green.stderr)
    assert.equal(JSON.parse(green.stdout).status, 'passed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
