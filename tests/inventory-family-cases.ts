/** Specification expectations, independent of the runtime policy. */
export const inventoryRoles = [
  {
    id: 'inventory-qll',
    skillDirectory: 'qll',
    name: '全链库存管理Agent',
    consumer: 'full-chain-inventory',
    forbiddenConsumer: 'branch-inventory',
    persona: '全链库存',
    skills: ['inventory-qll']
  },
  {
    id: 'inventory-fc',
    skillDirectory: 'fc',
    name: '分仓库存Agent',
    consumer: 'branch-inventory',
    forbiddenConsumer: 'dealer-inventory-replenishment',
    persona: '分仓库存',
    skills: [
      'inventory-fc',
      'branch-aging-stagnation-monitoring',
      'branch-customer-inventory-signal',
      'branch-future-aging-projection',
      'branch-inventory-water-level-deviation',
      'branch-metric-explanation',
      'branch-plan-version-explain',
      'branch-policy',
      'branch-replenishment-confirmation-dms',
      'branch-replenishment-demand',
      'branch-report-templates',
      'branch-shortage-monitoring',
      'branch-upstream-base-availability'
    ]
  },
  {
    id: 'inventory-dealer',
    skillDirectory: 'dealer',
    name: '经销商库存Agent',
    consumer: 'dealer-inventory-replenishment',
    forbiddenConsumer: 'full-chain-inventory',
    persona: '经销商库存',
    skills: ['inventory-dealer']
  }
] as const
