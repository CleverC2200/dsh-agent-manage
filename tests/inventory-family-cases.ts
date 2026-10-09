/** Specification expectations, independent of the runtime policy. */
export const inventoryRoles = [
  { id: 'inventory-qll', skillDirectory: 'qll', name: '全链库存管理Agent', consumer: 'full-chain-inventory', forbiddenConsumer: 'branch-inventory', persona: '全链库存' },
  { id: 'inventory-fc', skillDirectory: 'fc', name: '分仓库存Agent', consumer: 'branch-inventory', forbiddenConsumer: 'dealer-inventory-replenishment', persona: '分仓库存' },
  {
    id: 'inventory-dealer',
    skillDirectory: 'dealer',
    name: '经销商库存Agent',
    consumer: 'dealer-inventory-replenishment',
    forbiddenConsumer: 'full-chain-inventory',
    persona: '经销商库存'
  }
] as const
