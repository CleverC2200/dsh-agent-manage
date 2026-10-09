/** 文件作用：发现项目 Agent 角色卡，并把原始文件转换为应用层目录结果。 */
/**
 * Resolve read-only project roles from the calling session, never from tool-supplied paths.
 *
 * 中文：本文件从当前会话的工作目录中读取项目级 Agent 角色，并转成主机可注册的只读角色清单。
 * 路径只信任会话上下文，不接受工具调用方传入的任意路径。
 */
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { parseAgentRole, type AgentRoleEntry } from '../runtime/agent-role-router.js'
import type { Catalog } from './catalog.js'

/** 根据父会话的 cwd 读取已启用 suite 中的 agents 资源，解析成可用角色；无有效 cwd 时返回空列表。 */
export async function projectAgentRoles(catalog: Catalog, parent: unknown): Promise<AgentRoleEntry[]> {
  const cwd = (parent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return []
  const snapshot = await catalog.readProjectCatalog(cwd)
  const entries: AgentRoleEntry[] = []
  for (const suite of snapshot.enabledSuites) {
    if (suite.activeSurfaces?.agents === false) continue
    for (const resource of suite.resources?.agents ?? (await defaultMarkdownResources(suite.root, 'agents'))) {
      const path = resource.file
      const rawText = await resourceText(resource).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        return undefined
      })
      if (rawText === undefined) continue
      try {
        const policy = parseAgentRole(rawText)
        entries.push({
          name: JSON.stringify([suite.sourceId, suite.id, 'agents', resource.name]),
          path,
          rawText,
          title: policy.title ?? resource.name.replace(/\.agent$/, ''),
          description: policy.description ?? `${suite.manifest.name}: ${resource.name}`,
          disabled: policy.disabled
        })
      } catch {
        // Malformed routing metadata cannot authorize a project role.
        // 中文：路由元数据格式错误时不授权该项目角色，继续处理其他资源。
      }
    }
  }
  return entries
}
