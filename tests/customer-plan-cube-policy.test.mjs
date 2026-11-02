import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'

const resource = new URL('../business-resources/inventory-customer/', import.meta.url)
const prompt = JSON.parse(fs.readFileSync(new URL('prompt.json', resource), 'utf8'))
const capability = JSON.parse(fs.readFileSync(new URL('capability.json', resource), 'utf8'))

test('customer Cube policy selects the plan source without changing Consumer or granting writes', () => {
  assert.equal(prompt.consumerCode, 'customer_inventory')
  assert.equal(capability.data.consumerCode, prompt.consumerCode)
  assert.equal(capability.maxEffect, 'view')
  assert.deepEqual(capability.layers, ['read'])
  assert.ok(capability.data.tables.includes('agents_scm_cust_plan_order_analysis_d'))
  assert.match(prompt.persona, /不再用旧库存模型的 pack_unitqty_total/)
  assert.match(prompt.persona, /固定单日、单月份查询，回答注明快照日期/)
  assert.match(prompt.persona, /来源没有固定日快照时明确说明/)
})

test('partial values and unpublished Cube members cannot become zero or precise freshness', () => {
  assert.match(prompt.persona, /空值不是0/)
  assert.match(prompt.persona, /全空为未知，不能说0/)
  assert.match(prompt.persona, /测算上限/)
  assert.match(prompt.persona, /计价覆盖不足保持未知/)
  assert.match(prompt.persona, /Cube 模型尚缺相应字段\/度量/)
  assert.match(prompt.persona, /不能把页面实时结果称为Cube每日快照查询结果/)
})

test('customer BI transit queries both quantities and preserves NULL and shipment status boundaries', () => {
  assert.match(prompt.persona, /必须同时查询、分别汇总两字段/)
  assert.match(prompt.persona, /COALESCE\(SUM\(in_transit_qty\),0\)\+COALESCE\(SUM\(unship_qty\),0\)/)
  assert.match(prompt.persona, /不得直接SUM\(in_transit_qty\+unship_qty\)/)
  assert.match(prompt.persona, /两个字段在整个统计范围均无非空值时，结果为未知/)
  assert.match(prompt.persona, /840与820合计1660/)
  assert.match(prompt.persona, /unship_qty合计442时，按已知部分合计442/)
  assert.match(prompt.persona, /两字段均空的SKU数/)
  assert.match(prompt.persona, /不把二者都说成已发货/)
  assert.match(prompt.persona, /尚未发布unship_qty/)
  assert.match(prompt.persona, /2026-11-02对应库存业务日2026-10-31/)
  const skill = fs.readFileSync(new URL('skills/customer/SKILL.md', resource), 'utf8')
  assert.match(skill, /分别汇总 `in_transit_qty` 和 `unship_qty`/)
  assert.match(skill, /两字段在整个范围均无非空值时保持未知/)
})
