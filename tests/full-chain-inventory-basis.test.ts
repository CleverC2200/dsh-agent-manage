import { describe, expect, it } from 'vitest'
import { buildFullChainWorkspace } from '../src/inventory-compute/full-chain-workspace-service.js'
import { summarizeStructure } from '../src/inventory-compute/full-chain-category-structure.js'
import type { FullChainData } from '../src/inventory-compute/full-chain-types.js'

const fixture = (): FullChainData => ({
  baseInventory: [
    {
      snapshotDate: '2026-10-30',
      base: 'B',
      category: '食品',
      sku: 'S',
      currentQty: 100,
      availableQty: 20,
      targetQty: 80,
      externalDemand30d: 300,
      plannedDailyQty: 999,
      confirmedTransferOut30d: 0
    }
  ],
  branchInventory: [{ snapshotDate: '2026-10-30', base: 'B', branch: 'W', category: '食品', sku: 'S', currentQty: 50, availableQty: 5, targetQty: 30, externalDemand30d: 150 }],
  branchOutbound: [{ snapshotDate: '2026-10-30', branch: 'W', sku: 'S', qty: 150 }],
  customerInventory: [],
  agingBatches: [],
  orders: [],
  pendingOrders: [],
  activeCustomerIds30d: [],
  inventoryTrend: []
})
const request = { access: { principalId: 'fixture', trusted: true }, scope: 'company' as const, filters: {}, now: new Date('2026-10-30T00:00:00Z') }

describe('full-chain physical inventory basis', () => {
  it('uses current stock for company total and thirty-day movement for turnover', () => {
    const workspace = buildFullChainWorkspace(fixture(), request)
    expect(workspace.kpis.inventoryLevel.companyCurrent).toBe(150)
    expect(workspace.layerMetrics?.base.turnoverDays).toBe(10)
    expect(workspace.layerMetrics?.branch.turnoverDays).toBe(10)
    const branch = workspace.structure.find(row => row.layer === 'branch')!
    expect(branch.currentQty).toBe(50)
    expect(branch.availableQty).toBe(5)
    expect(summarizeStructure([branch], 'W', '测试分仓').turnoverDays).toBe(10)
  })
  it('keeps known physical stock when availability or outbound is missing', () => {
    const data = fixture()
    data.branchInventory[0]!.availableQty = null
    data.branchInventory[0]!.externalDemand30d = null
    data.branchOutbound = []
    const workspace = buildFullChainWorkspace(data, request)
    expect(workspace.kpis.inventoryLevel.companyCurrent).toBe(150)
    expect(workspace.layerMetrics?.branch.turnoverDays).toBeNull()
    expect(workspace.structure.find(row => row.layer === 'branch')?.currentQty).toBe(50)
  })
})
