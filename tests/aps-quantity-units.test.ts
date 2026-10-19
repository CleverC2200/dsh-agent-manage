import { describe, expect, it } from 'vitest'
import { deriveMetrics } from '../src/aps-compute/metrics.js'
import { summarizePage } from '../src/aps-compute/page-analysis.js'
import { analyzePerspective, analyzeProductionMatrix, matrixCellsFromData } from '../src/aps-compute/perspective-analysis.js'
import { deriveWorkbenchInsights } from '../src/aps-compute/workbench-insights.js'

const data = {
  start: '2026-10-01',
  end: '2026-10-19',
  granularity: 'month',
  sections: [
    { id: 'stock', status: 'ready', rows: [{ base: '华东', category: '水饺', inventory: 10000 }] },
    { id: 'orders', status: 'ready', rows: [{ base: '华东', category: '水饺', demand: 100000, shortage: 20000, invalid: 0 }] }
  ]
}

describe('confirmed one carton per piece display contract', () => {
  it('keeps quantity values while giving metrics and summaries the same carton unit', () => {
    expect(deriveMetrics(data)['库存量']).toMatchObject({ value: 1, unit: '万箱' })
    expect(deriveMetrics(data)['订单缺货量']).toMatchObject({ value: 2, unit: '万箱' })
    expect(summarizePage(data).copy).toContain('库存量1万箱')
    expect(summarizePage(data).copy).toContain('订单缺货量2万箱')
  })
  it('uses cartons in visible perspective values and quantity matrix analysis', () => {
    expect(analyzePerspective('overview', '10月', Object.values(deriveMetrics(data))).copy).toContain('库存量1万箱')
    const matrix = analyzeProductionMatrix('库存量', '10月', matrixCellsFromData(data, '库存量'))
    expect(matrix.copy).toContain('1万箱')
  })
  it('keeps the same shortage quantity in suggested action diagnoses', () => {
    expect(deriveWorkbenchInsights(data).actions[0].diagnosis).toContain('缺货2.00万箱')
  })
})
