import solver, { type Model } from 'javascript-lp-solver'

export interface JointDemand {
  id: string
  quantity: number
  options: { resourceId: string; usage: { resourceId: string; share: number }[] }[]
}

export function jointAllocate(demands: JointDemand[], capacities: { id: string; quantity: number }[]) {
  const selected = demands.filter(row => row.quantity > 0 && row.options.length > 0).toSorted((a, b) => a.id.localeCompare(b.id))
  const fixed = new Map<string, number>()
  const resourceIndex = new Map(capacities.map((row, index) => [row.id, index]))
  const choices = selected.flatMap((demand, index) => demand.options.map(option => ({ demand, index, option })))
  const scale = capacities.map(resource =>
    Math.max(
      resource.quantity,
      ...choices.map(row => row.demand.quantity * row.option.usage.filter(item => item.resourceId === resource.id).reduce((sum, item) => sum + item.share, 0)),
      1e-12
    )
  )
  const solve = (floor: number | null, objective?: Set<number>) => {
    const model: Model = { optimize: 'objective', opType: 'max', constraints: {}, variables: {} }
    capacities.forEach((resource, index) => {
      model.constraints[`r${index}`] = { max: resource.quantity / scale[index] }
    })
    selected.forEach((demand, index) => {
      const rate = fixed.get(demand.id)
      model.constraints[`d${index}`] = rate === undefined ? { max: 1, min: floor ?? 0 } : { equal: rate }
      if (floor === null && rate === undefined) model.constraints[`f${index}`] = { min: 0 }
    })
    choices.forEach(({ demand, index, option }, position) => {
      const variable: Record<string, number> = { [`d${index}`]: 1, objective: objective?.has(index) ? 1 : 0 }
      if (floor === null && !fixed.has(demand.id)) variable[`f${index}`] = 1
      for (const usage of option.usage) {
        const resource = resourceIndex.get(usage.resourceId)
        if (resource === undefined) throw Error('联合产能分配引用未知资源')
        variable[`r${resource}`] = (variable[`r${resource}`] ?? 0) + (demand.quantity * usage.share) / scale[resource]
      }
      model.variables[`x${position}`] = variable
    })
    if (floor === null) {
      model.constraints.floor = { max: 1 }
      model.variables.rate = { objective: 1, floor: 1 }
      selected.forEach((demand, index) => {
        if (!fixed.has(demand.id)) model.variables.rate[`f${index}`] = -1
      })
    }
    const execute: unknown = Reflect.get(solver, 'Solve')
    if (typeof execute !== 'function') throw Error('联合产能求解器不可用')
    const result: unknown = execute.call(solver, model, 1e-12)
    if (typeof result !== 'object' || result === null || !('feasible' in result) || result.feasible !== true) throw Error('联合产能求解失败，拒绝生成排产量')
    const value = (name: string) => {
      const value: unknown = Reflect.get(result, name)
      if (value === undefined) return 0
      if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('联合产能求解结果无效')
      return value
    }
    return { rate: value('rate'), values: choices.map((_, index) => value(`x${index}`)) }
  }
  let values = choices.map(() => 0)
  while (fixed.size < selected.length) {
    const result = solve(null)
    const rate = Math.min(1, Math.max(0, result.rate))
    values = result.values
    if (rate >= 1 - 1e-8) break
    const blockedIndexes = new Set(selected.flatMap((demand, index) => (fixed.has(demand.id) ? [] : [index])))
    while (blockedIndexes.size) {
      const probe = solve(Math.max(0, rate - 1e-12), blockedIndexes)
      const delivered = selected.map(() => 0)
      probe.values.forEach((value, position) => {
        delivered[choices[position].index] += value
      })
      const flexible = [...blockedIndexes].filter(index => delivered[index] > rate + 1e-7)
      if (!flexible.length) break
      flexible.forEach(index => blockedIndexes.delete(index))
    }
    const blocked = selected.filter((_, index) => blockedIndexes.has(index))
    if (!blocked.length) throw Error('联合产能求解未找到瓶颈，拒绝生成排产量')
    blocked.forEach(demand => fixed.set(demand.id, Math.max(0, rate - 1e-12)))
  }
  const allocations = choices.flatMap(({ demand, option }, index) =>
    values[index] > 0 ? [{ demandId: demand.id, resourceId: option.resourceId, quantity: values[index] * demand.quantity, usage: option.usage }] : []
  )
  return {
    allocations,
    demands: selected.map(demand => ({ id: demand.id, allocated: allocations.filter(row => row.demandId === demand.id).reduce((sum, row) => sum + row.quantity, 0) }))
  }
}
