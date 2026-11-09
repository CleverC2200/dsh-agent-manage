import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { URL } from 'node:url'

const root = new URL('../business-resources/inventory-orderworkbench/', import.meta.url)
const text = path => readFile(new URL(path, root), 'utf8')

test('amendment persona and detail route agree on quantities, no lock and nonnegative requests', async () => {
  const prompt = JSON.parse(await text('prompt.json'))
  const details = await text('skills/operations-order-kpi-details/SKILL.md')
  const capability = JSON.parse(await text('capability.json'))
  assert.match(prompt.persona, /分子仅change_order_qty≥0/)
  assert.match(prompt.persona, /不加锁定期/)
  assert.match(prompt.persona, /单位不得写成订单“张”/)
  assert.match(details, /metricDetails.queries/)
  assert.match(details, /不要求存在改单事件、版本、原因或时间/)
  assert.doesNotMatch(details, /\*\*改单率\*\*：.*最近改单时间倒序/)
  assert.ok(capability.data.tables.includes('agents_dim_bas_warehouse_d'))
  assert.doesNotMatch(capability.data.rules.join('\n'), /作废\/改单分类型1\/2/)
})

test('edited workbench resource bytes match their packaged provenance', async () => {
  const source = JSON.parse(await text('SOURCE.json'))
  const hash = value => createHash('sha256').update(value).digest('hex')
  assert.equal(hash((await text('agent-prompt.md')).replaceAll('\r\n', '\n')), source.promptSha256)
  for (const file of source.files) {
    assert.equal(hash((await text(file.path)).replaceAll('\r\n', '\n')), file.packagedSha256, file.path)
  }
})
