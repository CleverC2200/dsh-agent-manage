import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { URL } from 'node:url'

const root = new URL('../business-resources/inventory-orderworkbench/', import.meta.url)
const text = path => readFile(new URL(path, root), 'utf8')

test('persona routes registered KPIs to the shared runtime without duplicating calculations', async () => {
  const prompt = JSON.parse(await text('prompt.json'))
  assert.equal(prompt.persona, await text('agent-prompt.md'))
  assert.match(prompt.persona, /gea_order_kpi/)
  assert.match(prompt.persona, /其他订单、库存和业务知识问题/)
  assert.doesNotMatch(prompt.persona, /change_order_qty|lastshipmenttime|满18小时|满12小时/)
  const rules = JSON.parse(await text('capability.json')).data.rules.join('\n')
  assert.doesNotMatch(rules, /change_order_qty|1−sum|滚动销售计划加|货龄只取/)
  assert.match(rules, /共享运行时/)
})

test('edited workbench resource bytes match their packaged provenance', async () => {
  const source = JSON.parse(await text('SOURCE.json'))
  const hash = value => createHash('sha256').update(value).digest('hex')
  assert.equal(hash((await text('agent-prompt.md')).replaceAll('\r\n', '\n')), source.promptSha256)
  for (const file of source.files) {
    assert.equal(hash((await text(file.path)).replaceAll('\r\n', '\n')), file.packagedSha256, file.path)
  }
})
