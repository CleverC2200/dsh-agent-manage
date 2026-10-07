import type { DealerDashboardRecord, DealerCategoryInventorySummary } from './dealer-dashboard.js'

/** Chinese-calendar season, evaluated in the business timezone (including leap months). */
export function seasonalReplenishmentReason(category: string, now = new Date()) {
  if (!category.includes('粽')) return null
  const parts = new Intl.DateTimeFormat('en-u-ca-chinese', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(now)
  const monthText = parts.find(part => part.type === 'month')?.value || ''
  const month = Number.parseInt(monthText, 10)
  const day = Number(parts.find(part => part.type === 'day')?.value)
  const leap = /bis/.test(monthText)
  const stopped = month > 5 || (month === 5 && (leap || day >= 5)) || (month === 1 && !leap && day <= 15)
  return stopped ? '季节性商品过节日后不补货' : null
}

export function skuExpiryFacts(age: number | null | undefined, stock: number | null | undefined) {
  if (age == null || stock == null) return { near: 0, expired: 0, remaining: null }
  const known = age != null && Number.isFinite(age) && age >= 0 && stock != null && Number.isFinite(stock) && stock >= 0
  if (!known) return { near: null, expired: null, remaining: null }
  return {
    near: age! >= (365 * 2) / 3 && age! <= 365 ? stock! : 0,
    expired: age! > 365 ? stock! : 0,
    remaining: 365 - age!
  }
}

export function replenishmentFacts(
  stock: number | null | undefined,
  expiryStock: number | null | undefined,
  transitStock: number | null | undefined,
  sales30: number | null | undefined
) {
  transitStock ??= 0
  expiryStock ??= 0
  const fields: [string, number | null | undefined][] = [
    ['在仓库存', stock],
    ['在仓临期库存', expiryStock],
    ['在途库存', transitStock],
    ['近30日销量', sales30]
  ]
  const missing = fields.flatMap(([name, value]) => (value == null ? [name + '未提供'] : !Number.isFinite(value) || value < 0 ? [name + '异常'] : []))
  if (missing.length)
    return {
      quantity: null,
      reason: missing.join('、') + '，暂无法计算建议备货量',
      action: '待核查'
    }
  const target = (sales30! / 30) * 20
  const available = Math.max(stock! - expiryStock!, 0) + transitStock!
  const quantity = Math.max(0, Math.round(Number((target - available).toFixed(6))))
  if (![target, available, quantity].every(Number.isFinite))
    return {
      quantity: null,
      reason: '库存或动销数值超出可计算范围，请核查数据',
      action: '待核查'
    }
  const fmt = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
  return {
    quantity,
    reason: `按近30日销量${fmt(sales30!)}箱、20天目标计算目标库存${fmt(target)}箱；在仓可用库存${fmt(Math.max(stock! - expiryStock!, 0))}箱，在途${fmt(transitStock!)}箱；建议备货${fmt(quantity)}箱${quantity === 0 ? '，无需补货' : ''}`,
    action: quantity > 0 ? '建议补货' : '无需补货'
  }
}

export function missingStockFactsReason(stock: number | null | undefined, transit: number | null | undefined, target: number | null | undefined): string {
  const fields: [string, number | null | undefined][] = [
    ['在仓库存', stock],
    ['在途数量', transit ?? 0],
    ['目标备货', target]
  ]
  const issues = fields.flatMap(([name, value]) => (value == null ? [name + '未提供'] : !Number.isFinite(value) || value < 0 ? [name + '异常'] : []))
  return issues.length ? issues.join('、') + '，暂无法确定建议备货量，请核查对应数据' : ''
}

export function inventoryStructureRisk(categories: DealerCategoryInventorySummary[]) {
  const details = categories.map(row => {
    const stock = row.riskInventory,
      transit = row.riskTransit,
      sales = row.sales30
    const complete = row.riskDataComplete === true && row.category !== '未分类' && [stock, transit, sales].every(value => value != null && Number.isFinite(value) && value >= 0)
    const reasons: string[] = []
    if (complete) {
      const total = stock! + transit!
      if (sales === 0 && total > 0) reasons.push('近30天无动销')
      if (sales! > 0 && total / (sales! / 30) < 20) reasons.push('覆盖低于20天')
      if (sales! > 0 && total / (sales! / 30) > 20) reasons.push('覆盖超过20天')
    }
    return { category: row.category, complete, reasons }
  })
  return {
    count: details.length && details.every(row => row.complete) ? details.filter(row => row.reasons.length > 0).length : null,
    details
  }
}

export function finite(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function actionFor(record: DealerDashboardRecord) {
  if (record.orderException || record.dataIssues.length > 0) return ''
  // 订补货动作直接以数据通道返回的已核验建议量为准。
  if (record.suggestedQuantity > 0) return '建议补货'
  return '暂无补货建议'
}

export function suggestedStockQuantity(target: number | null | undefined, stock: number | null | undefined, transit: number | null | undefined): number | null {
  transit ??= 0
  if ([target, stock, transit].some(value => value == null || !Number.isFinite(value) || value < 0)) return null
  return Math.max(0, Number((target! - stock! - transit!).toFixed(6)))
}

export function reasonFor(record: DealerDashboardRecord) {
  const valid = (value: number | null | undefined) => (value != null && Number.isFinite(value) && value >= 0 ? value : null)
  const fmt = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
  if (record.orderException) return `暂停建议：${record.orderException}`
  if (record.dataIssues.length) return `数据待核查：${record.dataIssues.join('、')}`
  const stock = valid(record.actualInventory ?? record.inventory)
  const transit = valid(record.actualInTransit ?? record.publishedInTransit)
  const target = valid(record.targetInventory)
  const sales = valid(record.sales30)
  const qty = valid(record.publishedSuggestedQuantity)
  const total = stock != null && transit != null ? stock + transit : null
  const reasons: string[] = []
  if (total != null && target != null) {
    reasons.push(total < target ? `库存${fmt(total)}箱，低于目标${fmt(target)}箱，差额${fmt(target - total)}箱` : `库存${fmt(total)}箱，已达到目标${fmt(target)}箱`)
  } else reasons.push('库存、在途或目标备货缺失，暂不能比较缺口')
  if (sales != null && sales > 0 && total != null) reasons.push(`近30日销量${fmt(sales)}箱，参考覆盖${fmt(total / (sales / 30))}天`)
  else reasons.push(sales === 0 ? '近30日销量为0，覆盖天数无法计算' : '动销或库存数据不完整，覆盖天数待核查')
  if (qty == null) reasons.push('已发布建议量缺失，需核查')
  else if (qty === 0) reasons.push('已发布建议量为0，暂无补货建议')
  else {
    reasons.push(`已发布建议补货${fmt(qty)}箱`)
    reasons.push(total != null && target != null && total >= target ? '与当前库存对比不一致，请核查建议日期及备货口径' : '源未提供具体测算原因，以上为当前库存参考')
  }
  return reasons.join('；')
}
export type LiveDemoSku = {
  // 公司商品与购物车只消费真实字段，不能复用旧库存演示补齐值。
  commerceFacts: {
    stock: number | null
    transit: number | null
    recommendedQty: number | null
    nearExpiryStock: number | null
    price: number | null
    warehouse: string | null
  }
  dealer: string
  dealerCode: string
  dealerName: string
  plannedQty: number | null
  region: string
  code: string
  sku: string
  category: string
  stock: number | null
  transit: number | null
  normalStock: number | null
  stockAmount: number | null
  targetInventory: number | null
  suggestedStockQty: number | null
  orderRecommendation?: {
    quantity: number | null
    reason: string
    action: string
  }
  // 用户指定按平均货龄判断整款在仓库存；未知货龄不按0处理。
  nearExpiryStock: number | null
  expiredStock: number | null
  remainingValidityDays: number | null
  totalValidityDays: number
  sales7: number | null
  sales30: number | null
  shortageSales30: number | null
  publishedSales7: number | null
  publishedSales30: number | null
  publishedSalesAmount30: number | null
  productRange: string | null
  productTag: string | null
  materialSize: string | null
  cifPrice: number | null
  averageAge: number | null
  inventorySnapshotDate: string | null
  inventoryDailySource: string | null
  margin: number | null
  price: number | null
  sellThrough: number | null
  manualQtyOverride: number
  manualAdjustNote: string
  liveAction: string
  liveReason: string
}

export function computeDealerSku(record: DealerDashboardRecord, price: number | null, useDailyInventory = true, now = new Date()): LiveDemoSku {
  const inventory = (useDailyInventory ? (record.actualInventory ?? record.inventory) : record.inventory) ?? null
  const realTransit = (useDailyInventory ? (record.actualInTransit ?? record.publishedInTransit) : record.publishedInTransit) ?? 0
  const transit = realTransit
  const targetInventory = record.targetInventory ?? null
  const blockingDataIssues = record.dataIssues.filter(issue => !['日均销量缺失或为0', '目标库存缺失', '平均货龄缺失'].includes(issue))
  const validOrderSuggestion = !record.orderException && blockingDataIssues.length === 0
  const expiry = skuExpiryFacts(record.averageAge, useDailyInventory ? (record.actualInventory ?? record.inventory) : record.inventory)
  const recommendation = replenishmentFacts(
    useDailyInventory ? (record.actualInventory ?? record.inventory) : record.inventory,
    expiry.near == null || expiry.expired == null ? null : expiry.near + expiry.expired,
    realTransit,
    record.sales30
  )
  const orderInputs = [
    useDailyInventory ? (record.actualInventory ?? record.inventory) : record.inventory,
    expiry.near == null || expiry.expired == null ? null : expiry.near + expiry.expired,
    realTransit,
    record.sales30
  ]
  const orderMissing = ['在仓库存', '在仓临期库存', '在途库存', '近30日销量'].filter((_, index) => orderInputs[index] == null)
  const orderRecommendation = replenishmentFacts(orderInputs[0] ?? 0, orderInputs[1] ?? 0, orderInputs[2] ?? 0, orderInputs[3] ?? 0)
  const orderIssues = blockingDataIssues.filter(issue => ['主粒度重复', '平均货龄为负', '统一到岸价为负'].includes(issue))
  if (record.orderException || orderIssues.length) {
    orderRecommendation.quantity = null
    orderRecommendation.action = '待核查'
    orderRecommendation.reason = '业务校验未通过：' + (record.orderException || orderIssues.join('、'))
  }
  if (orderRecommendation.quantity != null && orderRecommendation.quantity > 0) {
    const integerQuantity = Math.round(orderRecommendation.quantity)
    if (integerQuantity !== orderRecommendation.quantity) orderRecommendation.reason += '；整箱订货四舍五入为' + integerQuantity + '箱'
    orderRecommendation.quantity = integerQuantity
  }
  if (orderMissing.length) orderRecommendation.reason += '；仅订单计算：' + orderMissing.join('、') + '缺失按0参与计算，源数据仍缺失'
  const seasonalReason = record.materialCode === '10005290' ? '商品已下架，不推荐补货' : seasonalReplenishmentReason(record.productCategory || '', now)
  if (seasonalReason) {
    Object.assign(recommendation, {
      quantity: 0,
      action: '无需补货',
      reason: seasonalReason
    })
    Object.assign(orderRecommendation, {
      quantity: 0,
      action: '无需补货',
      reason: seasonalReason
    })
  }
  const suggestedStockQty = recommendation.quantity
  const noReplenishment = suggestedStockQty === 0
  return {
    commerceFacts: {
      stock: useDailyInventory ? (record.actualInventory ?? record.inventory) : record.inventory,
      transit: realTransit,
      recommendedQty: suggestedStockQty == null ? null : noReplenishment ? 0 : !validOrderSuggestion ? null : suggestedStockQty,
      nearExpiryStock: expiry.near,
      price: price,
      warehouse: null
    },
    dealer: record.customerCode,
    dealerCode: record.customerCode,
    plannedQty: record.plannedQty ?? null,
    dealerName: record.customerName || record.customerCode,
    region: '已授权范围',
    code: record.materialCode,
    sku: record.materialName || record.materialCode,
    category: record.productCategory || '未分类',
    stock: inventory,
    transit,
    normalStock: record.normalInventory,
    stockAmount: record.stockAmount,
    targetInventory,
    suggestedStockQty,
    orderRecommendation,
    nearExpiryStock: expiry.near,
    expiredStock: expiry.expired,
    totalValidityDays: 365,
    remainingValidityDays: expiry.remaining,
    sales7: record.sales7 ?? null,
    sales30: record.sales30 ?? null,
    shortageSales30: record.dailySales != null && record.dailySales > 0 ? record.dailySales * 30 : null,
    publishedSales7: record.sales7,
    publishedSales30: record.sales30,
    publishedSalesAmount30: record.salesAmount30,
    productRange: record.productRange,
    productTag: record.productTag,
    materialSize: record.materialSize,
    cifPrice: record.cifPrice,
    averageAge: record.averageAge ?? null,
    inventorySnapshotDate: record.inventorySnapshotDate,
    inventoryDailySource: record.inventoryDailySource,
    margin: null,
    price: price,
    sellThrough: null,
    manualQtyOverride: suggestedStockQty != null && !noReplenishment && validOrderSuggestion ? suggestedStockQty : 0,
    manualAdjustNote: suggestedStockQty == null ? '补货数据待完善' : '按20天目标及可用库存计算',
    liveAction: suggestedStockQty == null ? recommendation.action : !noReplenishment && !validOrderSuggestion ? '待核查' : recommendation.action,
    liveReason:
      suggestedStockQty != null && !noReplenishment && !validOrderSuggestion
        ? recommendation.reason + '；业务校验未通过：' + (record.orderException || blockingDataIssues.join('、'))
        : recommendation.reason
  }
}
