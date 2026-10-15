/** 文件作用：组装套件详情和组件资源，向 HTTP 查询层提供只读详情视图。 */
/**
 * Suite detail and preview projections owned by the application layer.
 *
 * 中文：本文件把已归一化的 suite 数据组装成详情页需要的视图模型，包括技能、MCP、Hooks、命令、Agent 和 LSP 预览。
 * 它只读取和投影业务数据，并在输出前隐藏凭据等敏感信息。
 */
import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { discoverLspEntries } from '../catalog/surfaces.js'
import { defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { credentialRefsInServer } from '../runtime/mcp-config.js'
import { redactMcpConfig, redactMcpOverrides } from '../runtime/mcp-redaction.js'
import { effectiveSuiteOverrides, applyOverride, type McpServerOverride } from '../runtime/mcp-overrides.js'
import type { LspSurfaceDetail, McpServerDetail, SkillContent, SuiteDetail } from '../contracts/market.js'
import { effectiveSurfaces, type InstalledEntry, type McpServerStdio, type McpServerStreamableHttp, type Suite, type SuiteMarkdownResource } from '../model/types.js'
import type { McpMountDiagnostic as McpDiagnostic } from '../runtime/mcp-mounts.js'

/** Build the detail response for one normalized suite. 中文：合并 suite、安装状态、挂载诊断和 MCP 覆盖值，生成详情弹窗的完整响应。 */
export async function buildSuiteDetail(
  suite: Suite,
  installed: InstalledEntry | undefined,
  diagnostics: readonly McpDiagnostic[],
  mcpOverrides: Record<string, Record<string, unknown>> = {}
): Promise<SuiteDetail> {
  const remoteUrl = suite.remote?.url
  return {
    sourceId: suite.sourceId,
    suiteId: suite.id,
    name: suite.manifest.name,
    version: suite.manifest.version ?? null,
    description: suite.manifest.description ?? null,
    author: suite.manifest.author ?? null,
    keywords: suite.manifest.keywords ?? [],
    layout: suite.manifest.layout,
    dimension: suite.dimension,
    root: remoteUrl ?? suite.root,
    remoteUrl: remoteUrl ?? null,
    installed: installed !== undefined,
    enabled: installed?.enabled === true,
    surfaceToggles: effectiveSurfaces(installed?.surfaces),
    mcpOverrides: redactMcpOverrides(mcpOverrides),
    skills: suite.skills.map(skill => ({
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      path: skill.file
    })),
    mcpServers:
      suite.mcp === undefined
        ? []
        : Object.entries(suite.mcp.servers).map(([key, server]) => {
            const effective = applyOverride(
              server as McpServerStdio | McpServerStreamableHttp,
              effectiveSuiteOverrides(`${suite.sourceId}/${suite.id}`, mcpOverrides)[key] as McpServerOverride | undefined
            )
            return {
              key,
              ...(redactMcpConfig(server) as Omit<McpServerDetail, 'key' | 'credentialRefs'>),
              credentialRefs: credentialRefsInServer(effective)
            }
          }),
    hooks:
      remoteUrl === undefined
        ? suite.hooks === undefined
          ? suite.resources === undefined
            ? await hooksPreviews(suite.root)
            : { count: 0, entries: [] }
          : normalizedHookPreviews(suite)
        : { count: 0, entries: [] },
    commands: remoteUrl === undefined ? await markdownPreviews(suite.resources?.commands ?? (await defaultMarkdownResources(suite.root, 'commands'))) : [],
    agents: remoteUrl === undefined ? await markdownPreviews(suite.resources?.agents ?? (await defaultMarkdownResources(suite.root, 'agents'))) : [],
    lsp: remoteUrl === undefined ? await lspDetail(suite) : { servers: [], raw: [] },
    errors: suite.errors,
    mcpErrors: diagnostics.filter(diagnostic => diagnostic.suiteId === suite.id).map(diagnostic => `${diagnostic.serverKey}: ${diagnostic.reason}`)
  }
}

/** Read one skill body from a normalized suite. 中文：按名称定位技能并读取完整 SKILL.md，找不到或无法读取时返回可理解的错误。 */
export async function readSkillContent(suite: Suite, skillName: string): Promise<SkillContent> {
  const skill = suite.skills.find(entry => entry.name === skillName)
  if (skill === undefined) throw new Error(`skill "${skillName}" not found in suite "${suite.id}"`)
  let content: string
  try {
    content = await readFile(skill.file, 'utf8')
  } catch (error) {
    throw new Error(`skill file unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { name: skill.name, description: skill.description, content, path: skill.file }
}

/** 读取文本预览，并按字符上限截断，防止详情响应被大文件撑大。 */
async function readPreview(path: string, capBytes = 64 * 1024): Promise<string> {
  const text = await readFile(path, 'utf8')
  return text.length > capBytes ? `${text.slice(0, capBytes)}\n… (truncated)` : text
}

/** 批量生成 Markdown 资源预览，并尝试从 frontmatter 提取描述；单个文件读取失败不影响其他资源。 */
async function markdownPreviews(resources: SuiteMarkdownResource[]): Promise<Array<{ name: string; description?: string; content: string }>> {
  const previews: Array<{ name: string; description?: string; content: string }> = []
  for (const resource of resources) {
    try {
      const content = (await resourceText(resource)).slice(0, 64 * 1024)
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
      let description: string | undefined
      if (match !== null) {
        const yaml = parseYaml(match[1])
        if (typeof yaml === 'object' && yaml !== null) {
          const desc = (yaml as Record<string, unknown>)['description']
          if (typeof desc === 'string') description = desc
        }
      }
      previews.push({ name: resource.name, ...(description === undefined ? {} : { description }), content })
    } catch {
      // Unreadable preview files are omitted from the detail response.
      // 中文：不可读的预览文件仅从详情响应中略过，不拖垮整个 suite。
    }
  }
  return previews
}

/** 将已验证的分组 Hook 结构拉平成详情页可直接展示的事件、匹配器和命令列表。 */
function normalizedHookPreviews(suite: Suite) {
  const entries = Object.entries(suite.hooks!.events).flatMap(([event, groups]) =>
    groups.flatMap(group => group.hooks.map(hook => ({ event, ...(group.matcher === undefined ? {} : { matcher: group.matcher }), command: hook.command })))
  )
  return { count: entries.length, entries }
}

/** 从兼容路径中读取原生 hooks JSON，宽容地提取可识别命令，用于未经归一化的旧布局预览。 */
async function hooksPreviews(root: string): Promise<{ count: number; entries: Array<{ event: string; matcher?: string; command: string }> }> {
  for (const relative of ['hooks/hooks.json', 'hooks.json'] as const) {
    let text: string
    try {
      text = await readFile(`${root}/${relative}`, 'utf8')
    } catch {
      continue
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) continue
      const hooks = (parsed as Record<string, unknown>)['hooks']
      if (typeof hooks !== 'object' || hooks === null) continue
      const entries: Array<{ event: string; matcher?: string; command: string }> = []
      for (const [event, groups] of Object.entries(hooks as Record<string, unknown>)) {
        if (!Array.isArray(groups)) continue
        for (const group of groups) {
          if (typeof group !== 'object' || group === null) continue
          const record = group as Record<string, unknown>
          const matcher = typeof record['matcher'] === 'string' ? record['matcher'] : undefined
          const hooksList = record['hooks']
          if (!Array.isArray(hooksList)) continue
          for (const hook of hooksList) {
            if (typeof hook !== 'object' || hook === null) continue
            const hookRecord = hook as Record<string, unknown>
            if (typeof hookRecord['command'] === 'string') entries.push({ event, ...(matcher === undefined ? {} : { matcher }), command: hookRecord['command'] })
          }
        }
      }
      return { count: entries.length, entries }
    } catch {
      // Unparsable hook files yield zero entries.
      // 中文：Hook 文件无法解析时返回空预览，不让详情页整体失败。
    }
  }
  return { count: 0, entries: [] }
}

/**
 * The suite's LSP surface: inline-declared `lspServers` (already parsed into
 * `suite.lsp` at discovery) rendered as structured server previews, plus the
 * directory-style `.claude-plugin/lsp/*.json` / reverse-domain files as raw
 * previews. Remote suites (not cloned) carry an empty detail.
 *
 * 中文：合并发现阶段已解析的内联 LSP 服务，以及目录型 LSP JSON 原文预览；未克隆的远程 suite 返回空详情。
 */
async function lspDetail(suite: Suite): Promise<LspSurfaceDetail> {
  const servers = Object.values(suite.lsp?.servers ?? {}).map(spec => ({
    key: spec.key,
    command: spec.command,
    args: spec.args,
    extensions: spec.extensionToLanguage,
    ...(spec.env === undefined ? {} : { env: spec.env })
  }))
  const raw: Array<{ name: string; content: string }> = []
  if (suite.remote?.url === undefined) {
    for (const entry of await discoverLspEntries(suite.root)) {
      try {
        raw.push({ name: entry.name, content: await readPreview(entry.path) })
      } catch {
        // Unreadable LSP files are omitted from the detail response.
        // 中文：单个 LSP 文件不可读时只略过该预览。
      }
    }
  }
  return { servers, raw }
}
