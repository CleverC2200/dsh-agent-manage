/**
 * 文件作用：集中封装市场客户端访问宿主 API 的请求。
 * 业务职责：把市场、MCP、LSP、用户面板等页面使用的输入转换为 HTTP/RPC 请求，统一处理忙碌态和失败响应，向组件返回已类型化的数据。
 */
import { withBusyOperation } from './ui/busy-operation.js'
/** Typed fetch helpers over the host's `/api/agent-plugins/*` routes. */
/** 中文：所有客户端请求集中走宿主市场 API，统一路径、返回类型和错误边界。 */
import { MARKET_ROUTES, userPanelMutationRoute, userPanelRoute, type UserPanelEntryWire, type UserPanelKind } from '../contracts/market.js'
import { MARKET_API_PREFIX, skillRoute, suiteRoute } from '../contracts/market.js'
import type { OverviewPayload, SkillContent, SourceProgress, SuiteDetail, SuiteOverviewCard } from '../contracts/market.js'
import type { McpStatusPayload } from '../contracts/mcp-status.js'
import type { LspStatusPayload } from '../contracts/lsp-status.js'
import type { LspServerSpec } from '../model/types.js'

export type {
  AgentPreview,
  HookPreview,
  LspPreview,
  MarkdownPreview,
  McpServerDetail,
  OverviewPayload,
  SkillContent,
  SourceOverview,
  SourceProgress,
  SuiteDetail,
  SuiteOverviewCard,
  SuiteSkillMeta,
  SuiteSurfaceCounts,
  UserPanelEntryWire,
  UserPanelKind
} from '../contracts/market.js'
export type { McpStatusEntry, McpStatusPayload, McpStatusTool } from '../contracts/mcp-status.js'
export type { LspStatusEntry, LspStatusPayload, LspStatusState } from '../contracts/lsp-status.js'
export type { LspServerSpec } from '../model/types.js'

/** Client-facing alias retained during migration from the original transport types. */
/** 中文：迁移期间保留客户端别名，避免组件依赖旧传输类型名称。 */
export type OverviewData = OverviewPayload
/** Client-facing alias retained during migration from the original transport types. */
/** 中文：迁移期间保留第二个客户端别名，保证接口兼容。 */
export type SuiteCardData = SuiteOverviewCard

/** 读取 MCP/LSP 服务的当前连接配置，供详情面板展示。 */
export async function fetchServerConfig(kind: 'mcp' | 'lsp', id: string): Promise<import('../contracts/market.js').ServerConfigPayload> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_ROUTES.serverConfig}?${new URLSearchParams({ kind, id })}`, { credentials: 'same-origin' })
    const body = (await response.json()) as import('../contracts/market.js').ServerConfigPayload & { error?: string }
    if (!response.ok) throw new Error(body.error ?? `Server configuration failed: ${response.status}`)
    return body
  })
}

/** 保存用户编辑后的 MCP/LSP 服务配置。 */
export async function saveServerConfig(kind: 'mcp' | 'lsp', id: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('server-config/save', { kind, id, config })
  })
}

/** Load providers, models, or exact-model reasoning options from DSH's live LLM service. */
/** 从宿主实时模型目录读取供应商、模型或模型级推理选项。 */
export async function fetchModelCatalog(provider?: string, signal?: AbortSignal, model?: string): Promise<import('../contracts/market.js').ModelCatalogPayload> {
  const params = new URLSearchParams()
  if (provider !== undefined) params.set('provider', provider)
  if (model !== undefined) params.set('model', model)
  const query = params.size === 0 ? '' : `?${params}`
  const response = await fetch(`${MARKET_ROUTES.modelCatalog}${query}`, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`DSH model directory failed: ${response.status}`)
  return response.json() as Promise<import('../contracts/market.js').ModelCatalogPayload>
}

/** 读取市场总览，作为市场首页卡片和筛选器的数据源。 */
export async function fetchOverview(): Promise<OverviewData> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.overview, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`overview failed: ${response.status}`)
    return response.json() as Promise<OverviewData>
  })
}

/** 读取源仓库扫描/刷新进度，供进度提示轮询使用。 */
export async function fetchSourceProgress(): Promise<SourceProgress> {
  const response = await fetch(MARKET_ROUTES.progress, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`progress failed: ${response.status}`)
  return response.json() as Promise<SourceProgress>
}

/** 读取某个源下指定套件的完整详情。 */
export async function fetchSuiteDetail(sourceId: string, suiteId: string): Promise<SuiteDetail> {
  return withBusyOperation(async () => {
    const response = await fetch(suiteRoute(sourceId, suiteId), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`suite detail failed: ${response.status}`)
    return response.json() as Promise<SuiteDetail>
  })
}

/** 读取宿主观察到的 MCP 服务状态和工具清单。 */
export async function fetchMcpStatus(): Promise<McpStatusPayload> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.mcpStatus, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`MCP status failed: ${response.status}`)
    return response.json() as Promise<McpStatusPayload>
  })
}

/** 读取 LSP 状态；前台请求显示忙碌态，后台轮询不打扰用户。 */
export async function fetchLspStatus(background = false): Promise<LspStatusPayload> {
  /** 执行实际读取，供前台请求和后台静默轮询共享同一响应校验。 */
  const load = async (): Promise<LspStatusPayload> => {
    const response = await fetch(MARKET_ROUTES.lspStatus, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`LSP status failed: ${response.status}`)
    return response.json() as Promise<LspStatusPayload>
  }
  return background ? load() : withBusyOperation(load)
}

/** The user's direct LSP server table (normalized specs). */
/** 中文：用户直配 LSP 表已经过后端规范化，组件不再自行推断字段。 */
/** 读取用户直接配置且已规范化的 LSP 服务表。 */
export async function fetchLspServers(): Promise<Record<string, LspServerSpec>> {
  return withBusyOperation(async () => {
    const response = await fetch(MARKET_ROUTES.lspServers, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`LSP servers failed: ${response.status}`)
    const body = (await response.json()) as { lspServers?: Record<string, LspServerSpec> }
    return body.lspServers ?? {}
  })
}

/** Validate and persist the user's direct LSP server table. */
/** 中文：提交后端校验并持久化直配表，返回宿主接受的规范结果。 */
/** 校验并持久化用户直接配置的 LSP 服务表，返回宿主接受后的结果。 */
export async function saveLspServers(lspServers: unknown): Promise<Record<string, LspServerSpec>> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_ROUTES.lspServers}/save`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lspServers })
    })
    const body = (await response.json()) as { ok?: boolean; error?: string; lspServers?: Record<string, LspServerSpec> }
    if (!response.ok || body.ok === false) throw new Error(body.error ?? `LSP servers save failed: ${response.status}`)
    return body.lspServers ?? {}
  })
}
/** 切换单个用户 LSP 服务的启用状态。 */
export async function setLspServerEnabled(id: string, enabled: boolean): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/enabled', { id, enabled })
  })
}

/** 新增一个用户直接配置的 LSP 服务并交给宿主挂载。 */
export async function addLspServer(name: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('lsp-servers/add', { name, config })
  })
}

/** 读取套件内某个技能的 Markdown 正文。 */
export async function fetchSkillContent(sourceId: string, suiteId: string, skill: string): Promise<SkillContent> {
  return withBusyOperation(async () => {
    const response = await fetch(skillRoute(sourceId, suiteId, skill), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`skill content failed: ${response.status}`)
    return response.json() as Promise<SkillContent>
  })
}

/** Re-run the host MCP reconcile: retries failed mounts, clears residual tools. */
/** 中文：重新触发宿主 MCP 对账，重试失败挂载并清理残留工具。 */
/** 请求宿主重新协调 MCP 挂载，重试失败服务并清理残留工具。 */
export async function retryMcpMounts(): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-retry', {})
  })
}

/** Persist and mount a user-owned MCP server. */
/** 中文：保存用户 MCP 配置并交由宿主挂载，不在客户端直接建立连接。 */
/** 保存用户自有 MCP 配置，并触发宿主挂载。 */
export async function addMcpServer(name: string, config: Record<string, unknown>): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-servers/add', { name, config })
  })
}

/** Drop one server's OAuth grant so its next mount re-runs browser authorization. */
/** 中文：清除单服务 OAuth 授权，下一次挂载重新走浏览器授权流程。 */
/** 清除指定 MCP 服务的 OAuth 授权，使下次挂载重新走浏览器授权。 */
export async function reauthorizeMcpServer(serverName: string): Promise<void> {
  return withBusyOperation(async () => {
    await postAction('mcp-reauthorize', { serverName })
  })
}

/** The MCP backend card state: active client, host availability, download region. */
/** 中文：卡片状态包含当前后端、宿主兼容性和下载区域。 */
export interface McpBackendInfo {
  backend: 'builtin' | 'host'
  hostClient: { available: boolean; version?: string }
  downloadRegion: { setting: 'auto' | 'global' | 'china'; effective: 'global' | 'china' }
}

/** 查询当前使用的 MCP 后端、宿主客户端可用性和下载区域。 */
export async function fetchMcpBackend(): Promise<McpBackendInfo> {
  const response = await fetch(MARKET_ROUTES.mcpBackend, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`mcp backend failed: ${response.status}`)
  return response.json() as Promise<McpBackendInfo>
}

/** 执行统一的市场 POST 动作，并校验宿主返回的 ok 标志。 */
export async function postAction(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return withBusyOperation(async () => {
    const response = await fetch(`${MARKET_API_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    const payload = (await response.json()) as { ok: boolean; error?: string }
    if (!response.ok || payload.ok !== true) {
      throw new Error(payload.error ?? `request failed: ${response.status}`)
    }
    return payload
  })
}

/* ---- User panel CRUD (skills / commands / agent personas) -------------- */
/* 中文：用户面板 CRUD 统一走同一组带类型的 API 路由。 */

/** One user panel entry, client-facing alias of the wire shape. */
/** 中文：用户面板条目的客户端别名，保留宿主 wire 的字段形状。 */
export type UserPanelEntry = UserPanelEntryWire

/** List one panel's entries. */
/** 中文：读取单类用户面板条目，返回已类型化列表。 */
/** 读取技能、命令或代理角色面板中的条目。 */
export async function fetchUserPanel(kind: UserPanelKind): Promise<UserPanelEntry[]> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelRoute(kind), { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`user panel failed: ${response.status}`)
    const body = (await response.json()) as { entries?: UserPanelEntry[] }
    return body.entries ?? []
  })
}

/** Create one panel entry. */
/** 中文：创建用户面板条目并返回宿主生成的记录。 */
/** 创建一个用户面板条目并返回宿主生成的记录。 */
export async function createUserPanelEntry(kind: UserPanelKind, name: string, text: string): Promise<UserPanelEntry> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelMutationRoute(kind, 'create'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text })
    })
    const payload = (await response.json()) as { ok?: boolean; error?: string; entry?: UserPanelEntry }
    if (!response.ok || payload.ok !== true || payload.entry === undefined) throw new Error(payload.error ?? `create failed: ${response.status}`)
    return payload.entry
  })
}

/** Replace one panel entry's file content. */
/** 中文：替换面板条目正文，名称仍作为稳定身份。 */
/** 更新用户面板条目的文件正文。 */
export async function updateUserPanelEntry(kind: UserPanelKind, name: string, text: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelMutationRoute(kind, 'update', name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text })
    })
    const payload = (await response.json()) as { ok?: boolean; error?: string }
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `save failed: ${response.status}`)
  })
}

/** Delete one panel entry. */
/** 中文：删除指定用户面板条目。 */
/** 删除用户面板中的一个条目。 */
export async function deleteUserPanelEntry(kind: UserPanelKind, name: string): Promise<void> {
  return withBusyOperation(async () => {
    const response = await fetch(userPanelMutationRoute(kind, 'delete'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    })
    const payload = (await response.json()) as { ok?: boolean; error?: string }
    if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `delete failed: ${response.status}`)
  })
}
