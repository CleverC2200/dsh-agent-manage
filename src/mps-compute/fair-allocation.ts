export interface FairDemand {
  id: string
  quantity: number
  resources: string[]
}
export interface FairCapacity {
  id: string
  quantity: number
}
type Edge = { to: number; reverse: number; capacity: number; original: number }

function allocate(demands: FairDemand[], capacities: FairCapacity[], targets: number[]) {
  const sink = demands.length + capacities.length + 1
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => [])
  const add = (from: number, to: number, capacity: number) => {
    const edge = { to, reverse: graph[to].length, capacity, original: capacity }
    graph[from].push(edge)
    graph[to].push({ to: from, reverse: graph[from].length - 1, capacity: 0, original: 0 })
    return edge
  }
  const capacityIndex = new Map(capacities.map((resource, index) => [resource.id, demands.length + 1 + index]))
  const sourceEdges = demands.map((demand, index) => add(0, index + 1, targets[index]))
  const assignments = demands.flatMap((demand, index) =>
    [...new Set(demand.resources)].flatMap(resourceId => {
      const target = capacityIndex.get(resourceId)
      return target === undefined ? [] : [{ demandId: demand.id, resourceId, edge: add(index + 1, target, demand.quantity) }]
    })
  )
  capacities.forEach((resource, index) => add(demands.length + 1 + index, sink, resource.quantity))
  const tolerance =
    Math.max(
      1,
      targets.reduce((sum, value) => sum + value, 0)
    ) * 1e-12
  while (true) {
    const level = Array<number>(graph.length).fill(-1)
    level[0] = 0
    const queue = [0]
    for (let position = 0; position < queue.length; position++) {
      for (const edge of graph[queue[position]]) {
        if (edge.capacity > tolerance && level[edge.to] < 0) {
          level[edge.to] = level[queue[position]] + 1
          queue.push(edge.to)
        }
      }
    }
    if (level[sink] < 0) break
    const next = Array<number>(graph.length).fill(0)
    const send = (node: number, amount: number): number => {
      if (node === sink) return amount
      for (; next[node] < graph[node].length; next[node]++) {
        const edge = graph[node][next[node]]
        if (edge.capacity <= tolerance || level[edge.to] !== level[node] + 1) continue
        const pushed = send(edge.to, Math.min(amount, edge.capacity))
        if (pushed > tolerance) {
          edge.capacity -= pushed
          graph[edge.to][edge.reverse].capacity += pushed
          return pushed
        }
      }
      return 0
    }
    while (send(0, Number.MAX_SAFE_INTEGER) > tolerance) {}
  }
  const reachable = new Set([0])
  const queue = [0]
  for (let position = 0; position < queue.length; position++) {
    for (const edge of graph[queue[position]]) {
      if (edge.capacity > tolerance && !reachable.has(edge.to)) {
        reachable.add(edge.to)
        queue.push(edge.to)
      }
    }
  }
  return {
    feasible: sourceEdges.every(edge => edge.capacity <= tolerance),
    blocked: new Set(demands.filter((_, index) => reachable.has(index + 1)).map(row => row.id)),
    assignments: assignments.map(({ demandId, resourceId, edge }) => ({
      demandId,
      resourceId,
      quantity: Math.max(0, edge.original - edge.capacity)
    }))
  }
}

export function fairAllocate(rawDemands: FairDemand[], rawCapacities: FairCapacity[]) {
  const valid = (value: number) => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
  if (rawDemands.some(row => !row.id || !valid(row.quantity)) || rawCapacities.some(row => !row.id || !valid(row.quantity))) throw Error('产能与需求必须为非负有限数')
  if (new Set(rawDemands.map(row => row.id)).size !== rawDemands.length || new Set(rawCapacities.map(row => row.id)).size !== rawCapacities.length)
    throw Error('需求与资源编号必须唯一')
  const demands = rawDemands.filter(row => row.quantity > 0).toSorted((a, b) => a.id.localeCompare(b.id))
  const capacities = rawCapacities.toSorted((a, b) => a.id.localeCompare(b.id))
  const fixed = new Map<string, number>()
  let result = allocate(
    demands,
    capacities,
    demands.map(() => 0)
  )
  let floor = 0
  while (fixed.size < demands.length) {
    const targets = (rate: number) => demands.map(row => fixed.get(row.id) ?? row.quantity * rate)
    const complete = allocate(demands, capacities, targets(1))
    if (complete.feasible) {
      result = complete
      break
    }
    let low = floor
    let high = 1
    for (let iteration = 0; iteration < 42; iteration++) {
      const middle = (low + high) / 2
      if (allocate(demands, capacities, targets(middle)).feasible) low = middle
      else high = middle
    }
    const rate = Math.max(floor, low - 1e-10)
    result = allocate(demands, capacities, targets(rate))
    const cut = allocate(demands, capacities, targets(Math.min(1, high + 1e-8)))
    const blocked = demands.filter(row => !fixed.has(row.id) && cut.blocked.has(row.id))
    if (!blocked.length) throw Error('公平分配未找到有效产能瓶颈')
    blocked.forEach(row => fixed.set(row.id, row.quantity * rate))
    floor = rate
  }
  if (fixed.size === demands.length)
    result = allocate(
      demands,
      capacities,
      demands.map(row => fixed.get(row.id) ?? 0)
    )
  const remaining = new Map(capacities.map(row => [row.id, row.quantity]))
  const remainingDemand = new Map(demands.map(row => [row.id, row.quantity]))
  const allocations = result.assignments.flatMap(row => {
    const capacity = remaining.get(row.resourceId) ?? 0
    const demand = remainingDemand.get(row.demandId) ?? 0
    const quantity = Math.min(row.quantity, capacity, demand) * (1 - 1e-12)
    remaining.set(row.resourceId, Math.max(0, capacity - quantity))
    remainingDemand.set(row.demandId, Math.max(0, demand - quantity))
    return quantity > 0 ? [{ ...row, quantity }] : []
  })
  const totals = new Map<string, number>()
  for (const row of allocations) totals.set(row.demandId, (totals.get(row.demandId) ?? 0) + row.quantity)
  return {
    allocations,
    demands: rawDemands.map(row => {
      const allocated = totals.get(row.id) ?? 0
      return {
        id: row.id,
        allocated,
        unfulfilled: Math.max(0, row.quantity - allocated),
        rate: row.quantity > 0 ? allocated / row.quantity : 1
      }
    }),
    resources: capacities.map(row => ({
      id: row.id,
      capacity: row.quantity,
      allocated: row.quantity - (remaining.get(row.id) ?? row.quantity)
    }))
  }
}
