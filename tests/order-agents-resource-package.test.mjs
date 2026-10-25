import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { URL } from 'node:url'

const shared = [
  'fulfillment-query-orchestrator',
  'order-fulfillment-risk',
  'sku-inventory-shortage',
  'production-fulfillment-progress',
  'warehouse-logistics-fulfillment',
  'sales-organization-analysis',
  'fulfillment-sales-confirmation-automation',
  'operations-kpi-performance-analysis',
  'operations-exception-root-cause',
  'improvement-action-closure'
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const rootFor = module => new URL(`../business-resources/inventory-${module}/`, import.meta.url)
const json = async (root, file) => JSON.parse(await readFile(new URL(file, root), 'utf8'))

test('both order Agents publish the complete shared Skill tree with valid headers and local references', async () => {
  for (const module of ['orderworkbench', 'orderfulfillment']) {
    const root = rootFor(module)
    const profile = await json(root, 'prompt.json')
    const capability = await json(root, 'capability.json')
    assert.deepEqual(profile.skills, [`inventory-${module}`, ...shared])
    assert.deepEqual(capability.skills, profile.skills)
    assert.equal(capability.maxEffect, module === 'orderworkbench' ? 'submit' : 'view')
    assert.deepEqual(capability.layers, module === 'orderworkbench' ? ['read', 'draft', 'submit'] : ['read'])
    const provenance = await json(root, 'SOURCE.json')
    for (const file of provenance.files) {
      const bytes = await readFile(new URL(file.path, root))
      assert.equal(hash(bytes), file.packagedSha256, `${module}: ${file.path}`)
    }
    for (const name of shared) {
      const file = `skills/${name}/SKILL.md`
      const text = await readFile(new URL(file, root), 'utf8')
      assert.match(text, /^---\n/)
      assert.equal(text.match(/^name: (.+)$/m)?.[1].trim(), name)
      for (const link of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
        if (/^[a-z]+:/i.test(link[1])) continue
        await readFile(new URL(link[1], new URL(file, root)))
      }
      const other = await readFile(new URL(file, rootFor(module === 'orderworkbench' ? 'orderfulfillment' : 'orderworkbench')), 'utf8')
      assert.equal(text, other, `shared content must not depend on registration order: ${name}`)
    }
  }
})

test('workbench prompt keeps its source and the governed report capability without arbitrary SQL writes', async () => {
  const root = rootFor('orderworkbench')
  const profile = await json(root, 'prompt.json')
  const prompt = await readFile(new URL('agent-prompt.md', root))
  assert.equal(hash(prompt), (await json(root, 'SOURCE.json')).promptSha256)
  assert.ok(profile.persona.startsWith(prompt.toString('utf8')))
  assert.match(profile.persona, /订单工作台 Agent/)
  assert.equal(profile.consumerCode, 'order')
  const capability = await json(root, 'capability.json')
  assert.equal(capability.data.mock, false)
  assert.ok(capability.data.tables.includes('agents_order_workbench_report'))
  assert.deepEqual((await json(root, 'mcp.json')).capabilities, ['governed-sql-read'])
  const fulfillment = rootFor('orderfulfillment')
  assert.equal((await json(fulfillment, 'prompt.json')).consumerCode, 'order01')
  assert.deepEqual((await json(fulfillment, 'mcp.json')).capabilities, ['governed-sql-read'])
})
