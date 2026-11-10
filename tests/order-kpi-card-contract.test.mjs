import { URL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const root = new URL('../business-resources/inventory-orderworkbench/', import.meta.url)
const text = p => readFile(new URL(p, root), 'utf8')
test('six KPI Skills retain workflows and formats while runtime owns business definitions', async () => {
  for (const p of [
    'skills/operations-order-kpi-details/SKILL.md',
    'skills/operations-kpi-performance-analysis/SKILL.md',
    'skills/operations-order-kpi-details/references/card-contracts.md'
  ]) {
    const s = await text(p)
    assert.match(s, /gea_order_kpi/)
    assert.match(s, /Cube.*知识库/)
    assert.doesNotMatch(s, /change_order_qty|lastshipmenttime|current_stock|kamd|18小时|12小时|0\.5|<6%/)
  }
  const details = await text('skills/operations-order-kpi-details/SKILL.md')
  for (const term of ['分子', '分母', '待判定', '未提供', '五段', '版本', '其他订单']) assert.ok(details.includes(term), term)
})
