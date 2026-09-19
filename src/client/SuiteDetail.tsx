/**
 * Suite detail modal: click one suite card to browse its internals.
 *
 * Sections: manifest overview, the skill list (each skill expands to its
 * SKILL.md body through the safe MarkdownText renderer), the validated
 * mcp.json servers (each expands to its full config — display only), the
 * command/subagent file lists, hook/LSP counts, and validation diagnostics.
 *
 * The MCP region is intentionally read-only: credentials and per-server
 * overrides are configured on the MCP services panel (their own detail
 * dialog), not inside the suite detail preview.
 *
 * 文件作用：提供单个套件的只读详情预览和能力面开关。
 * 业务职责：读取套件清单、延迟读取技能正文、展示经过校验的 MCP/LSP/Hook 内容，并把启停能力操作交回宿主。
 */
import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { MarkdownDocument } from './ui/MarkdownDocument.js'
import { fetchSkillContent, fetchSuiteDetail, postAction, type McpServerDetail, type SuiteDetail } from './api.js'
import type { Translate } from './index.js'
import { suiteLayoutLabel } from './layout-label.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import type { CredentialApi } from './credentials.js'
import { createLatestRequestGuard } from './features/suite-detail/suite-detail-resource.js'
import css from './market.module.css'

/** Toggleable surface keys paired with their translation keys. */
/** 中文：可切换表面与翻译键一一对应，详情页只提交这些受控能力开关。 */
const SURFACE_TOGGLE_ROWS = [
  ['skills', 'surfaceSkills'],
  ['mcp', 'surfaceMcp'],
  ['hooks', 'surfaceHooks'],
  ['commands', 'surfaceCommands'],
  ['agents', 'surfaceAgents'],
  ['lsp', 'surfaceLsp']
] as const

export interface SuiteDetailModalProps {
  t: Translate
  credentials?: CredentialApi
  sourceId: string
  suiteId: string
  onClose: () => void
}

/** 加载并展示套件详情，同时隔离技能预览和能力面开关的状态流。 */
export function SuiteDetailModal({ t, sourceId, suiteId, onClose }: SuiteDetailModalProps): ReactNode {
  // MarkdownText's chrome (code copy buttons, footnotes heading) is
  // Cordis-free and takes its copy through this labels object.
  // 中文：Markdown 预览的复制按钮和脚注标题不依赖 Cordis，文案由此对象传入。
  const [detail, setDetail] = useState<SuiteDetail | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [openSkill, setOpenSkill] = useState<string | undefined>(undefined)
  const [skillText, setSkillText] = useState<string | undefined>(undefined)
  const [skillLoading, setSkillLoading] = useState(false)
  const skillRequestGuard = useRef(createLatestRequestGuard())
  const [openMcp, setOpenMcp] = useState<string | undefined>(undefined)
  const [openPreview, setOpenPreview] = useState<string | undefined>(undefined)

  // 中文：套件标识变化时清空旧详情和技能请求，避免迟到响应覆盖新套件。
  useEffect(() => {
    let cancelled = false
    skillRequestGuard.current.invalidate()
    setDetail(undefined)
    setError(undefined)
    setOpenSkill(undefined)
    setSkillText(undefined)
    fetchSuiteDetail(sourceId, suiteId)
      .then(value => {
        if (!cancelled) setDetail(value)
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      skillRequestGuard.current.invalidate()
    }
  }, [sourceId, suiteId])

  /** 展开/收起技能并按最新请求保护加载到的 Markdown 正文。 */
  const toggleSkill = async (name: string): Promise<void> => {
    const requestId = skillRequestGuard.current.next()
    if (openSkill === name) {
      setOpenSkill(undefined)
      return
    }
    setOpenSkill(name)
    setSkillLoading(true)
    setSkillText(undefined)
    try {
      const content = await fetchSkillContent(sourceId, suiteId, name)
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(content.content)
    } catch (reason) {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillText(`⚠ ${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      if (skillRequestGuard.current.isCurrent(requestId)) setSkillLoading(false)
    }
  }

  /** 展开或收起一个只读 MCP 配置预览。 */
  const toggleMcp = (key: string): void => {
    setOpenMcp(openMcp === key ? undefined : key)
  }

  const [surfaceBusy, setSurfaceBusy] = useState(false)
  /** 持久化套件能力面开关，再重新读取详情确认宿主结果。 */
  const toggleSurface = async (surface: string, enabled: boolean): Promise<void> => {
    setSurfaceBusy(true)
    try {
      await postAction('set-surface', { sourceId, suiteId, surface, enabled })
      const next = await fetchSuiteDetail(sourceId, suiteId)
      setDetail(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSurfaceBusy(false)
    }
  }

  const layoutLabel = detail === undefined ? '' : suiteLayoutLabel(detail.layout, t)

  return h(DetailModal, {
    open: true,
    onClose,
    title: detail === undefined ? t('detailTitle') : `${detail.name}${detail.version === null ? '' : ` v${detail.version}`}`,
    description: detail === undefined ? undefined : t('detailHint'),
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h('div', { className: css.modalFooter }, h(Button, { variant: 'ghost', onClick: onClose }, t('cancel'))),
    children: h(ErrorBoundary, {
      fallback: boundaryError => h('div', { className: css.warnLine }, `${t('actionFail')}: ${boundaryError.message}`),
      children:
        error !== undefined
          ? h('div', { className: css.warnLine }, error)
          : detail === undefined
            ? h('div', { className: css.empty }, t('loading'))
            : h(
                'div',
                { className: css.detailSections },
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, t('overviewSection')),
                  h(
                    'div',
                    { className: css.detailGrid },
                    h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('sourceLabel')), h('span', { className: css.detailValue }, detail.sourceId)),
                    h(
                      'div',
                      { className: css.detailCell },
                      h('span', { className: css.detailKey }, t('dimensionLabel')),
                      h('span', { className: css.detailValue }, detail.dimension === 'user' ? t('dimensionUser') : t('dimensionProject'))
                    ),
                    h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('layoutLabel')), h('span', { className: css.detailValue }, layoutLabel)),
                    h(
                      'div',
                      { className: css.detailCell },
                      h('span', { className: css.detailKey }, t('statusLabel')),
                      h(
                        'span',
                        { className: detail.enabled ? css.okState : css.detailValue },
                        detail.installed ? (detail.enabled ? t('installedBadge') : t('disabledLabel')) : t('notInstalledLabel')
                      )
                    ),
                    detail.author === null
                      ? null
                      : h(
                          'div',
                          { className: css.detailCell },
                          h('span', { className: css.detailKey }, t('authorLabel')),
                          h('span', { className: css.detailValue }, detail.author)
                        ),
                    detail.keywords.length === 0
                      ? null
                      : h(
                          'div',
                          { className: css.detailCell },
                          h('span', { className: css.detailKey }, t('keywordsLabel')),
                          h('span', { className: css.detailValue }, detail.keywords.join(', '))
                        )
                  ),
                  detail.description === null ? null : h('p', { className: css.detailDesc }, detail.description),
                  h('div', { className: css.detailCell }, h('span', { className: css.detailKey }, t('rootLabel')), h('span', { className: css.mono }, detail.root)),
                  detail.installed === false || detail.surfaceToggles === null
                    ? null
                    : h(
                        'div',
                        { className: css.detailCell },
                        h('span', { className: css.detailKey }, t('surfaceTogglesSection')),
                        h(
                          'div',
                          { className: css.surfaceToggles, title: t('surfaceTogglesHint') },
                          ...SURFACE_TOGGLE_ROWS.map(([key, labelKey]) =>
                            h('label', { key, className: css.surfaceToggle }, h('input', {
                              type: 'checkbox',
                              checked: detail.surfaceToggles![key],
                              disabled: surfaceBusy,
                              onChange: event => {
                                void toggleSurface(key, (event.target as HTMLInputElement).checked)
                              }
                            }), t(labelKey))
                          )
                        )
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('skillsSection')} (${detail.skills.length})`),
                  detail.skills.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.skills.map(skill =>
                        h(
                          'div',
                          { key: skill.name, className: css.detailItem },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: openSkill === skill.name ? css.detailItemOpen : css.detailItemRow,
                              onClick: () => {
                                void toggleSkill(skill.name)
                              }
                            },
                            h('span', { className: css.detailItemName }, skill.name),
                            h('span', { className: css.detailItemDesc }, skill.description),
                            h('span', { className: css.detailChevron }, openSkill === skill.name ? '▾' : '▸')
                          ),
                          openSkill !== skill.name ? null : h('div', { className: css.skillContent }, skillLoading ? t('loading') : h(MarkdownDocument, { text: skillText ?? '', t }))
                        )
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('mcpSection')} (${detail.mcpServers.length})`),
                  detail.mcpErrors.length === 0
                    ? null
                    : h('div', { className: css.warnLine, style: { margin: '0 0 6px' } }, `⚠ ${detail.mcpErrors.join(t('sourceErrorSeparator'))}`),
                  detail.mcpServers.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                     : detail.mcpServers.map(server => {
                        const disabled = detail.mcpOverrides?.[server.key]?.enabled === false
                        return h(
                          'div',
                          { key: server.key, className: css.detailItem },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: openMcp === server.key ? css.detailItemOpen : css.detailItemRow,
                              onClick: () => toggleMcp(server.key)
                            },
                            h('span', { className: css.detailItemName }, server.key),
                            h(
                              'span',
                              { className: css.detailItemDesc },
                              `${mcpSummary(server)}${disabled ? ` · ${t('mcpOverrideDisabledBadge')}` : ''}`
                            ),
                            h('span', { className: css.detailChevron }, openMcp === server.key ? '▾' : '▸')
                          ),
                          openMcp === server.key
                            ? h(
                                'div',
                                { className: css.skillContent },
                                // Read-only preview of the validated config.
                                // Credentials and overrides are configured on
                                // the MCP services panel, not here.
                                // 中文：此处只读展示已校验配置；凭据和覆盖必须在 MCP 服务面板维护。
                                h('pre', { className: css.mono }, JSON.stringify(server, null, 2))
                              )
                            : null
                        )
                      })
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('commandsSection')} (${detail.commands.length})`),
                  detail.commands.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.commands.map(command =>
                        h(PreviewRow, {
                          key: `c:${command.name}`,
                          t,
                          name: `/${command.name}`,
                          description: command.description,
                          open: openPreview === `c:${command.name}`,
                          onToggle: () => setOpenPreview(openPreview === `c:${command.name}` ? undefined : `c:${command.name}`),
                          children: h(MarkdownDocument, { text: command.content, t })
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('agentsSection')} (${detail.agents.length})`),
                  detail.agents.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.agents.map(agent =>
                        h(PreviewRow, {
                          key: `a:${agent.name}`,
                          t,
                          name: agent.name,
                          description: agent.description,
                          open: openPreview === `a:${agent.name}`,
                          onToggle: () => setOpenPreview(openPreview === `a:${agent.name}` ? undefined : `a:${agent.name}`),
                          children: h(MarkdownDocument, { text: agent.content, t })
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('hooksLabel')} (${detail.hooks.count})`),
                  detail.hooks.count === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : detail.hooks.entries.map((hook, index) =>
                        h(PreviewRow, {
                          key: `h:${index}`,
                          t,
                          name: hook.event,
                          description: hook.command,
                          open: openPreview === `h:${index}`,
                          onToggle: () => setOpenPreview(openPreview === `h:${index}` ? undefined : `h:${index}`),
                          children: h('pre', { className: css.mono }, JSON.stringify(hook, null, 2))
                        })
                      )
                ),
                h(
                  'section',
                  { className: css.detailSection },
                  h('h4', { className: css.detailHead }, `${t('lspSection')} (${detail.lsp.servers.length + detail.lsp.raw.length})`),
                  detail.lsp.servers.length === 0 && detail.lsp.raw.length === 0
                    ? h('div', { className: css.sidebarEmpty }, '—')
                    : [
                        ...detail.lsp.servers.map(server =>
                          h(PreviewRow, {
                            key: `l:${server.key}`,
                            t,
                            name: server.key,
                            description: lspSummary(server),
                            open: openPreview === `l:${server.key}`,
                            onToggle: () => setOpenPreview(openPreview === `l:${server.key}` ? undefined : `l:${server.key}`),
                            children: h('pre', { className: css.mono }, JSON.stringify(server, null, 2))
                          })
                        ),
                        ...detail.lsp.raw.map(entry =>
                          h(PreviewRow, {
                            key: `l:${entry.name}`,
                            t,
                            name: entry.name,
                            open: openPreview === `l:${entry.name}`,
                            onToggle: () => setOpenPreview(openPreview === `l:${entry.name}` ? undefined : `l:${entry.name}`),
                            children: h('pre', { className: css.mono }, entry.content)
                          })
                        )
                      ]
                ),
                detail.errors.length === 0
                  ? null
                  : h(
                      'section',
                      { className: css.detailSection },
                      h('h4', { className: css.detailHead }, `${t('errors')} (${detail.errors.length})`),
                      detail.errors.map((entry, index) => h('div', { key: index, className: css.warnLine }, entry))
                    )
              )
    })
  })
}

/** 为 MCP 详情行生成 transport-aware 的一行摘要。 */
function mcpSummary(server: McpServerDetail): string {
  if (server.type === 'stdio') return server.command ?? server.type
  return server.url ?? server.type
}

/** One-line summary of a declared LSP server: command plus mapped extension list. */
/** 中文：LSP 摘要由启动命令和扩展映射组成，避免展开完整配置占用空间。 */
/** 生成 LSP 详情行的启动命令和扩展映射摘要。 */
function lspSummary(server: { command: string; extensions: Record<string, string> }): string {
  return [server.command, Object.keys(server.extensions).join(' ')].join(' · ')
}

/** 渲染命令、代理、Hook、LSP 等统一的可展开预览行。 */
function PreviewRow(props: { t: Translate; name: string; description?: string; open: boolean; onToggle: () => void; children: ReactNode }): ReactNode {
  const { name, description, open, onToggle, children } = props
  return h(
    'div',
    { className: css.detailItem },
    h(
      'button',
      {
        type: 'button',
        className: open ? css.detailItemOpen : css.detailItemRow,
        onClick: onToggle
      },
      h('span', { className: css.detailItemName }, name),
      description === undefined ? null : h('span', { className: css.detailItemDesc }, description),
      h('span', { className: css.detailChevron }, open ? '▾' : '▸')
    ),
    open ? h('div', { className: css.skillContent }, children) : null
  )
}
