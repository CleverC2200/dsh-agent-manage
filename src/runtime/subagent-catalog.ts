/** 文件作用：把可用子 Agent 目录发布到会话前置步骤，并避免重复发布。 */
/** Durable role catalogs follow DSH tool-skill's pre-step publication and session-surface recovery. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { HostTranslate } from './host-locale.js'

export interface SubagentCatalogEntry {
  /** Exact execution identity, independent of the human-readable title. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  name: string
  title: string
  description: string
  provider?: string
  model?: string
  reasoningEffort?: string
}

export interface SubagentCatalogSource {
  kind: 'subagent-catalog'
  form: 'catalog'
  update?: true
  entries: readonly SubagentCatalogEntry[]
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'subagent-catalog': SubagentCatalogSource
  }
}

/** Structural host contract avoids a second installation of the agent/session runtimes. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface CatalogAgent {
  session: {
    seq: number
    surface: { nodes: readonly number[] }
    eventAt(seq: number): { type: string; seq: number; data: unknown } | undefined
  }
}

export type CatalogStepDecision = { kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }
export type CatalogStepListener = (payload: { agent: CatalogAgent; signal: AbortSignal }, next: () => Promise<CatalogStepDecision>) => Promise<CatalogStepDecision>

interface CatalogHost {
  tools: { get(name: string, agent: CatalogAgent): unknown }
  /** 中文：注册会话前置监听，返回可撤销的监听句柄。 */
  on(name: 'agent/pre-step', listener: CatalogStepListener): () => void
  logger?: { warn(message: string): void }
}

/** Register after the exact tool definition; teardown removes guidance before execution. */
/** 注册 agent/pre-step 监听，将最新目录发布到会话并返回卸载函数。 */
export function mountSubagentCatalog(
  ctx: Context,
  tool: { name: string },
  snapshot: (agent: CatalogAgent, signal: AbortSignal) => Promise<SubagentCatalogEntry[]>,
  t: HostTranslate
): () => void {
  const host = ctx as unknown as CatalogHost
  let disposed = false
  /** pre-step 回调：在执行前刷新目录，并按摘要去重或删除过期提示。 */
  const dispose = host.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || disposed) return decision
    signal.throwIfAborted()
    let entries: SubagentCatalogEntry[]
    try {
      entries = host.tools.get(tool.name, agent) === tool ? await snapshot(agent, signal) : []
    } catch (error) {
      signal.throwIfAborted()
      host.logger?.warn(`subagent catalog snapshot incomplete: ${String(error)}`)
      return decision
    }
    signal.throwIfAborted()
    if (disposed) return decision
    if (host.tools.get(tool.name, agent) !== tool) entries = []
    const digest = digestEntries(entries)
    const history = catalogHistory(agent)
    const existing = catalogMessage(decision.messages)
    if (history.visibleDigest === digest) {
      return existing === undefined ? decision : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    if (existing !== undefined && digestEntries(existing.entries) === digest) return decision
    if (!history.published && entries.length === 0) {
      return existing === undefined ? decision : { ...decision, messages: decision.messages.filter(message => message.id !== existing.message.id) }
    }
    const message = renderCatalog(entries, history.published, t)
    return {
      ...decision,
      messages: existing === undefined ? [...decision.messages, message] : decision.messages.map(item => (item.id === existing.message.id ? message : item))
    }
  })
  return () => {
    disposed = true
    dispose()
  }
}

/** 转义目录文本中的控制字符，避免注入会话消息格式。 */
function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

/** 将角色目录渲染成一次可见的宿主用户消息。 */
function renderCatalog(entries: readonly SubagentCatalogEntry[], update: boolean, t: HostTranslate): UserMessage {
  const lines = entries.map(entry => {
    const route = [entry.provider, entry.model].filter(value => value !== undefined).join('/') || t('subagentCatalogInherit')
    return `<subagent id="${escapeText(entry.name)}" name="${escapeText(entry.title)}" model="${escapeText(route)}" reasoning_effort="${escapeText(entry.reasoningEffort ?? t('subagentCatalogDefaultEffort'))}">${escapeText(entry.description)}</subagent>`
  })
  return createUserMessage({
    content: [
      {
        type: 'text',
        text: [
          '<system-reminder>',
          t(update ? 'subagentCatalogUpdated' : 'subagentCatalogIntro'),
          '<available_subagents>',
          ...lines,
          '</available_subagents>',
          t(entries.length === 0 ? 'subagentCatalogEmpty' : 'subagentCatalogCall'),
          '</system-reminder>'
        ].join('\n')
      }
    ],
    source: { kind: 'subagent-catalog', form: 'catalog', ...(update ? { update: true } : {}), entries }
  })
}

/** 计算目录内容摘要，用于避免同一 Agent 重复发布未变化目录。 */
function digestEntries(entries: readonly SubagentCatalogEntry[]): string {
  return createHash('sha256')
    .update(entries.map(entry => JSON.stringify([entry.name, entry.title, entry.description, entry.provider, entry.model, entry.reasoningEffort])).join('\n'))
    .digest('hex')
}

/** Resumed and forked seeds may carry unvalidated source fields; ignore unreadable catalogs. */
/** 从事件消息来源读取并校验角色条目，非法来源返回 undefined。 */
function readEntries(source: unknown): readonly SubagentCatalogEntry[] | undefined {
  if (typeof source !== 'object' || source === null || !('kind' in source) || source.kind !== 'subagent-catalog' || !('entries' in source) || !Array.isArray(source.entries))
    return undefined
  const entries: SubagentCatalogEntry[] = []
  for (const raw of source.entries as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined
    const entry = raw as Record<string, unknown>
    if (typeof entry.name !== 'string' || entry.name === '' || typeof entry.title !== 'string' || typeof entry.description !== 'string') return undefined
    if (['provider', 'model', 'reasoningEffort'].some(key => entry[key] !== undefined && (typeof entry[key] !== 'string' || entry[key] === ''))) return undefined
    entries.push({
      name: entry.name,
      title: entry.title,
      description: entry.description,
      ...(entry.provider === undefined ? {} : { provider: entry.provider as string }),
      ...(entry.model === undefined ? {} : { model: entry.model as string }),
      ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort as string })
    })
  }
  return entries
}

/** 从 Agent 事件历史恢复已发布摘要和发布状态。 */
function catalogHistory(agent: CatalogAgent): { visibleDigest?: string; published: boolean } {
  const visible = new Set(agent.session.surface.nodes)
  let published = false
  for (let index = agent.session.seq - 1; index >= 0; index--) {
    const event = agent.session.eventAt(index)
    if (event === undefined) throw new Error(`subagent catalog cannot read seq ${index} below the current Session length`)
    if (event.type !== 'user/message') continue
    const entries = readEntries((event.data as UserMessage).source)
    if (entries === undefined) continue
    published = true
    if (visible.has(event.seq)) return { visibleDigest: digestEntries(entries), published }
  }
  return { published }
}

/** 在历史用户消息中寻找最近一次角色目录消息及其条目。 */
function catalogMessage(messages: readonly UserMessage[]): { message: UserMessage; entries: readonly SubagentCatalogEntry[] } | undefined {
  for (const message of messages) {
    const entries = readEntries(message.source)
    if (entries !== undefined) return { message, entries }
  }
  return undefined
}
