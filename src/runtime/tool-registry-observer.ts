/** 文件作用：以宿主私有层结构观察当前 MCP 工具，供状态面只读使用。 */
/** Host-private adapter for observing model-facing MCP tools. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */

/** One MCP tool observed from the DSH tool registry. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface McpToolSnapshot {
  name: string
  description?: string
}

/**
 * Read MCP tool names from the dsh-tools runtime when available.
 *
 * The registry has no public listing API in the current host release. This
 * adapter uses the observed `layers.merge(...).tools.entries()` data shape and
 * returns an empty observation when a host changes it.
 */
/** 读取宿主私有工具层，输出仅包含 mcp__ 命名空间的只读快照。 */
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
