export interface McpToolSnapshot {
  name: string
  description?: string
}

export function inspectToolRegistry(runtime: unknown): McpToolSnapshot[] {
  if (typeof runtime !== 'object' || runtime === null) return []
  const layers = (runtime as { layers?: unknown }).layers
  if (typeof layers !== 'object' || layers === null) return []
  const merge = (layers as { merge?: unknown }).merge
  if (typeof merge !== 'function') return []
  const empty = { entries: (): Array<[string, unknown]> => [] }
  try {
    const visible = (merge as (scope: undefined, pick: (layer: { tools?: typeof empty }) => typeof empty) => typeof empty).call(layers, undefined, layer => layer.tools ?? empty)
    const output: McpToolSnapshot[] = []
    for (const [name, definition] of visible.entries()) {
      if (!name.startsWith('mcp__')) continue
      const description =
        typeof definition === 'object' && definition !== null && typeof (definition as { description?: unknown }).description === 'string'
          ? (definition as { description: string }).description
          : undefined
      output.push({ name, ...(description === undefined ? {} : { description }) })
    }
    return output
  } catch {
    return []
  }
}
