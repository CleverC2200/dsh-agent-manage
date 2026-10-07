export type WorkspaceScope = 'company' | 'all-channel'
export type InventoryLayer = 'base' | 'branch' | 'customer'

export type TrustedAccessContext = {
  principalId: string
  gatewayScopeRef?: string
  trusted: boolean
  allowedBases?: string[]
  allowedBranches?: string[]
  allowedCustomerIds?: string[]
}

export type WorkspaceFilters = {
  month?: string
  base?: string
  branch?: string
  customerId?: string
  category?: string
  sku?: string
}

export type BaseInventoryRow = {
  sourceTargetTurnoverDays?: number | null
  plannedDailyQty?: number | null
  forecastInventoryQty?: number | null
  snapshotDate: string
  base: string
  category: string
  sku: string
  currentQty: number
  availableQty?: number | null
  targetQty: number | null
  externalDemand30d: number | null
  confirmedTransferOut30d: number | null
}

export type BranchInventoryRow = {
  plannedDailyQty?: number | null
  forecastInventoryQty?: number | null
  snapshotDate: string
  base: string | null
  branch: string
  category: string
  sku: string
  currentQty: number
  availableQty?: number | null
  targetQty: number | null
  externalDemand30d: number | null
}

export type CustomerInventoryRow = {
  statisticDate?: string
  snapshotDate: string
  customerId: string
  customer: string
  branch: string | null
  category: string
  sku: string
  currentQty: number
  targetQty: number | null
  sales30d: number | null
  sourceConflict: boolean
}

export type CustomerPlanInventoryRow = {
  snapshotDate: string
  customerId: string
  stockQty: number | null
  inTransitQty: number | null
}

export type AgingBatchRow = {
  snapshotDate: string
  layer: InventoryLayer
  objectName: string
  objectId?: string
  category: string
  sku: string
  batch: string
  qty: number
  ageDays: number | null
  dailyVelocity: number | null
  source?: string
}

export type OrderRow = {
  objectName?: string
  category?: string
  sku?: string
  orderQty?: number | null
  orderIds?: string[]
  affectedOrderIds?: string[]
  snapshotDate: string
  month: string
  pickupType: 'factory' | 'branch'
  demandQty: number
  shortageQty: number
  shippedQty: number
  affectedOrders: number
}

export type PendingOrderRow = {
  shortageQty?: number | null
  preparedQty?: number | null
  stageVerified?: boolean
  sku?: string
  snapshotDate: string
  branch: string
  demandQty: number
  allocatedQty: number
}

export type InventoryTrendRow = {
  snapshotDate: string
  layer: InventoryLayer
  qty: number
}

export type FullChainData = {
  baseCurrentOrders?: Array<{ base: string; snapshotDate: string; orderQty: number | null; shortageQty: number | null }>
  branchOutbound?: Array<{ branch: string; sku: string; category?: string; snapshotDate: string; qty: number | null }>
  branchFulfillment?: Array<{ branch: string; snapshotDate: string; orderQty: number | null; shippedQty: number | null }>
  historyDeferred?: boolean
  customerQuantityGaps?: Array<{ customerId: string; sku: string; category: string }>
  baseInventory: BaseInventoryRow[]
  branchInventory: BranchInventoryRow[]
  customerInventory: CustomerInventoryRow[]
  customerPlanInventory?: CustomerPlanInventoryRow[]
  agingBatches: AgingBatchRow[]
  orders: OrderRow[]
  orders7d?: OrderRow[]
  pendingOrders: PendingOrderRow[]
  activeCustomerIds30d: string[]
  inventoryTrend: InventoryTrendRow[]
  orderHistory?: OrderRow[]
  agingHistory?: Array<{ snapshotDate: string; layer: 'base' | 'branch'; averageAge: number | null }>
}

export type FullChainCalculationRequest = {
  access: TrustedAccessContext
  scope: WorkspaceScope
  filters: WorkspaceFilters
  now: Date
}

export type MetricValue = {
  current: number | null
  target: number | null
  unit: '件' | '箱' | '天' | '%'
  state: 'ok' | 'risk' | 'unavailable'
  explanation: string
  sourceDate: string | null
}

export type InventoryMetric = MetricValue & {
  companyCurrent: number | null
  observedCustomer: number
  observedTotal: number | null
  planCustomerTotal: number | null
  planCustomerDate: string | null
}

export type WorkspaceRisk = {
  code: string
  level: 'attention' | 'high' | 'info'
  title: string
  detail: string
  owner: string
  tab: 'structure' | 'aging' | 'shortage'
}

export type StructureRow = {
  plannedDailyQty?: number | null
  forecastInventoryQty?: number | null
  targetTurnoverDays?: number | null
  projectedTurnoverDays?: number | null
  /** Additive denominator; never average already-divided turnover days. */
  turnoverDemand30d?: number | null
  key: string
  layer: InventoryLayer
  objectName: string
  objectId?: string
  parentName: string | null
  category: string
  sku: string
  currentQty: number
  availableQty?: number | null
  targetQty: number | null
  differenceQty: number | null
  turnoverDays: number | null
  averageAgeDays: number | null
  bigDateQty: number | null
  judgment: string
  suggestedAction: string
  owner: string
  sourceDate: string
  confidence: string
  children?: StructureRow[]
}

export type AgingLayerValues = Record<InventoryLayer, number | null>

export type WorkspaceDetailNode = {
  key: string
  label: string
  layer: InventoryLayer
  filters: WorkspaceFilters
  expandable: boolean
  values: Record<string, number | string | null>
  children?: WorkspaceDetailNode[]
}

export type FullChainWorkspace = {
  contractVersion: 'full-chain-workspace/v1'
  workspaceId: string
  accessScopeId: string
  snapshotToken?: string
  generatedAt: string
  scope: WorkspaceScope
  filters: WorkspaceFilters
  kpis: {
    inventoryLevel: InventoryMetric
    turnover: MetricValue
    aging: MetricValue
    fulfillment: MetricValue
    orderGap: MetricValue
  }
  /** Current snapshot auxiliaries; historical trend points are not current KPI values. */
  layerMetrics?: Record<'base' | 'branch', { averageAgeDays: number | null; turnoverDays: number | null }>
  freshness: {
    minDate: string | null
    maxDate: string | null
    byDomain: Record<string, string | null>
  }
  coverage: {
    coveredCustomers: number
    activeCustomers: number
    rate: number | null
  }
  confidence: {
    level: 'high' | 'medium' | 'low'
    summary: string
  }
  structure: StructureRow[]
  /** Full authorized category × organization summaries, before display pagination. */
  categoryStructure?: StructureRow[]
  agingDetails?: WorkspaceDetailNode[]
  orderDetails?: WorkspaceDetailNode[]
  orderExecution?: {
    currentBaseShortageQty?: number | null
    currentBranchShortageQty?: number | null
    currentBaseOrderQty?: number | null
    currentOrderQty?: number | null
    currentBranchOrderQty?: number | null
    preparedBranchQty?: number | null
    orderQty: number | null
    orderCount: number | null
    shippedQty: number | null
    orderQty7d: number | null
    shippedQty7d: number | null
    shortageQty7d: number | null
    windowEnd: string
  }
  aging: {
    over30ByLayer?: AgingLayerValues
    byLayer: AgingLayerValues
    attentionByLayer: AgingLayerValues
    highRiskByLayer: AgingLayerValues
    projections: {
      day7: { byLayer: AgingLayerValues; state: 'available' | 'partial' | 'unavailable' }
      day14: { byLayer: AgingLayerValues; state: 'available' | 'partial' | 'unavailable' }
    }
  }
  fulfillment: {
    factory: { orderQty?: number | null; shippedQty?: number | null; demandQty: number; shortageQty: number; rate: number | null; affectedOrders: number }
    branch: { orderQty?: number | null; shippedQty?: number | null; demandQty: number; shortageQty: number; rate: number | null; affectedOrders: number }
    national: { orderQty?: number | null; shippedQty?: number | null; demandQty: number; shortageQty: number; rate: number | null; affectedOrders: number }
  }
  pendingOrderGap: number | null
  trends: {
    state?: 'loading'
    inventory: InventoryTrendRow[]
    orders: Array<{ snapshotDate: string; demandQty: number; satisfiedQty: number; shortageQty: number; fulfillmentRate: number | null }>
    aging: Array<{ snapshotDate: string; layer: 'base' | 'branch'; averageAge: number | null }>
    historyPoints: number
  }
  risks: WorkspaceRisk[]
  customerObservationRisks: WorkspaceRisk[]
  evidence: {
    dataNotes?: string[]
    ruleVersion:
      | 'full-chain-rules/2026-09-04'
      | 'full-chain-rules/2026-09-05'
      | 'full-chain-rules/2026-09-05-r2'
      | 'full-chain-rules/2026-09-05-r3'
      | 'full-chain-rules/2026-09-05-r4'
      | 'full-chain-rules/2026-09-09-r5'
      | 'full-chain-rules/2026-09-10-r6'
      | 'full-chain-rules/2026-09-17-r7'
    sourceTables: string[]
    customerAgeSources: Array<{ source: string; snapshotDate: string }>
    readOnly: true
  }
}

export type BuildWorkspaceRequest = FullChainCalculationRequest
