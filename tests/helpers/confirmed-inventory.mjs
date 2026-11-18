export function confirmNoExistingInventoryMovements(input) {
  input.inventoryMovements = input.products.flatMap(({ base, code }) =>
    Array.from({ length: 3 }, (_, offset) => {
      const date = new Date(`${input.context.month}-01T00:00:00Z`)
      date.setUTCMonth(date.getUTCMonth() + offset)
      return { month: date.toISOString().slice(0, 7), base, code, productionInbound: 0, inTransitInbound: 0, transferIn: 0, transferOut: 0 }
    })
  )
  return input
}
