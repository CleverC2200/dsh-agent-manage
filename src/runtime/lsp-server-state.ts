/** 文件作用：持久化用户禁用的 LSP 服务标识，供挂载对账读取。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** 根据数据根目录定位 LSP 禁用状态文件。 */
export function lspServerStatePath(dataRoot: string): string {
  return join(dataRoot, 'lsp-server-state.json')
}
/** 读取禁用服务集合；缺失或损坏时按空集合处理，避免阻断运行时启动。 */
export async function loadDisabledLspServers(dataRoot: string): Promise<Set<string>> {
  try {
    const value = JSON.parse(await readFile(lspServerStatePath(dataRoot), 'utf8')) as { disabled?: unknown }
    return new Set(Array.isArray(value.disabled) ? value.disabled.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}
/** 去重、排序并持久化禁用服务集合，确保状态文件稳定可审计。 */
export async function saveDisabledLspServers(dataRoot: string, disabled: Iterable<string>): Promise<void> {
  const path = lspServerStatePath(dataRoot)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify({ disabled: [...new Set(disabled)].sort() }, null, 2)}\n`, 'utf8')
}
