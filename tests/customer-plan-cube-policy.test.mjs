import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

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
