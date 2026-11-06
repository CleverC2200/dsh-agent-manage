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
  'operations-order-kpi-details',
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
    assert.deepEqual(profile.skills, [`inventory-${module}`, ...shared, ...(module === 'orderworkbench' ? ['operations-workbook-exception-import'] : [])])
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
      const otherRoot = rootFor(module === 'orderworkbench' ? 'orderfulfillment' : 'orderworkbench')
      const other = await readFile(new URL(file, otherRoot), 'utf8')
      const otherProvenance = await json(otherRoot, 'SOURCE.json')
      const ownSource = provenance.files.find(record => record.path === file)
      const otherSource = otherProvenance.files.find(record => record.path === file)
      assert.ok(ownSource && otherSource, `${name} must retain both source records`)
      if (name === 'operations-order-kpi-details' || ownSource.packagedSha256 === otherSource.packagedSha256)
        assert.equal(text, other, `shared content must match its declared version: ${name}`)
    }
  }
})

test('workbench prompt keeps its source and the governed report capability without arbitrary SQL writes', async () => {
  const root = rootFor('orderworkbench')
  const profile = await json(root, 'prompt.json')
  const prompt = await readFile(new URL('agent-prompt.md', root))
  assert.equal(hash(prompt), (await json(root, 'SOURCE.json')).promptSha256)
  const normalized = value => value.replace(/\s+/g, ' ').trim()
  const [corePrompt, importPolicy] = prompt.toString('utf8').split(/\n+用户要求填充工作台结论摘要、未完成项或改善措施时，/)
  assert.ok(importPolicy)
  assert.ok(normalized(profile.persona).startsWith(normalized(corePrompt)))
  const installedImportPolicy = profile.persona.slice(profile.persona.lastIndexOf('【工作台内容填充】'))
  for (const required of ['operations-workbook-exception-import', '预览', '授权', '数据库回执'])
    assert.ok(installedImportPolicy.includes(required), `installed import policy must retain ${required}`)
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

test('KPI details preserve current published definitions and route to actual order and inventory tables', async () => {
  const root = rootFor('orderworkbench')
  const details = await readFile(new URL('skills/operations-order-kpi-details/SKILL.md', root), 'utf8')
  assert.match(details, /age_days≥60/)
  assert.match(details, /全国\/品项日均需求.*不加调拨/)
  assert.match(details, /订单号｜渠道\/大区\/省区\/销售组/)
  assert.match(details, /产品信息（名称、编码）｜总库存｜60天以上库存件数/)
  assert.match(details, /不得从汇总拼造订单或商品行/)
  const analysis = await readFile(new URL('skills/operations-kpi-performance-analysis/SKILL.md', root), 'utf8')
  assert.match(analysis, /operations-order-kpi-details\/SKILL\.md/)
  assert.match(analysis, /已有指标为空时的解释/)
})
