import test from 'node:test'
import assert from 'node:assert/strict'
import { inventoryTurnoverIndex } from '../src/mps-compute/inventory-targets.ts'

const source = (base, code, version, days) => ({ month: '2026-12', base, code, version, finalTarget: 100, dailyDemand: 10, finalTurnoverDays: days, sourceRows: 1 })

test('同批基地SKU分别采用首选或次选，首选有效零不回退，保留回退原因', () => {
  const read = inventoryTurnoverIndex(
    [
      source('甲', 'A', '月初', 10),
      source('甲', 'A', '滚动', 20),
      source('乙', 'A', '滚动', 30),
      source('甲', 'B', '月初', null),
      source('甲', 'B', '滚动', 15),
      source('甲', 'C', '月初', 0),
      source('甲', 'C', '滚动', 25)
    ],
    ['2026-12'],
    'auto',
    [],
    ['月初', '滚动']
  )
  assert.equal(read({ base: '甲', code: 'A' }).sourceDays, 10)
  const fallback = read({ base: '乙', code: 'A' })
  assert.equal(fallback.sourceDays, 30)
  assert.equal(fallback.sourceVersion, '滚动')
  assert.match(fallback.fallbackReason, /月初.*缺目标记录/)
  assert.equal(read({ base: '甲', code: 'B' }).sourceDays, 15)
  assert.match(read({ base: '甲', code: 'B' }).fallbackReason, /月初.*为空或无效/)
  assert.equal(read({ base: '甲', code: 'C' }).sourceDays, 0)
  assert.equal(read({ base: '甲', code: 'C' }).sourceVersion, '月初')
})

test('无效首选逐键回退，冲突和读取失败保留待核，不静默改用次选', () => {
  for (const invalid of [null, -1, NaN, Infinity]) {
    const rows = [source('甲', 'A', '月初', invalid), source('甲', 'A', '滚动', 12)]
    const read = inventoryTurnoverIndex(rows, ['2026-12'], 'auto', [], ['月初', '滚动'])
    assert.equal(read({ base: '甲', code: 'A' }).sourceDays, 12)
    rows[1].finalTurnoverDays = null
    const missing = inventoryTurnoverIndex(rows, ['2026-12'], 'auto', [], ['月初', '滚动'])({ base: '甲', code: 'A' })
    assert.equal(missing.sourceDays, null)
    assert.deepEqual(
      missing.attempts.map(attempt => attempt.status),
      ['invalid-days', 'invalid-days']
    )
    assert.match(missing.missing.join('；'), /月初.*滚动/)
  }
  const first = source('甲', 'A', '月初', 10)
  const fallback = source('甲', 'A', '滚动', 12)
  for (const rows of [
    [first, { ...first, finalTurnoverDays: 11 }, fallback],
    [{ ...first, conflictFields: ['finalTurnoverDays'] }, fallback]
  ]) {
    const policy = inventoryTurnoverIndex(rows, ['2026-12'], 'auto', [], ['月初', '滚动'])({ base: '甲', code: 'A' })
    assert.equal(policy.sourceDays, null)
    assert.deepEqual(
      policy.attempts.map(attempt => attempt.status),
      ['conflict']
    )
  }
  const failed = inventoryTurnoverIndex([first, fallback], ['2026-12'], 'auto', ['接口超时'], ['月初', '滚动'])({ base: '甲', code: 'A' })
  assert.equal(failed.sourceDays, null)
  assert.deepEqual(
    failed.attempts.map(attempt => attempt.status),
    ['read-failed']
  )
  assert.match(failed.missing.join('；'), /接口超时/)
  assert.equal(inventoryTurnoverIndex([fallback], ['2026-12'], '月初')({ base: '甲', code: 'A' }).sourceDays, null)
})
