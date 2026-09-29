/**
 * 文件作用：展示宿主观察到的 MCP 服务和工具状态。
 * 业务职责：按来源/搜索筛选服务，协调重试、重新授权、凭据配置和直接新增，并在详情关闭或保存后刷新权威状态。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createElement as h } from 'react'
import { Button, Input, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { DetailModal } from './ui/DetailModal.js'
import { ServerConfigEditor } from './ui/ServerConfigEditor.js'
import { ServerConfigDetail } from './ui/ServerConfigDetail.js'
import { parseServerConfig } from './ui/server-form.js'
import { PanelActions, PanelHeader } from './ui/panel.js'
import { mcpDetailActions } from './features/mcp-status/detail-actions.js'
import type { Translate } from './index.js'
import { addMcpServer, fetchMcpStatus, reauthorizeMcpServer, retryMcpMounts, type McpStatusEntry, type McpStatusPayload } from './api.js'
import type { CredentialApi } from './credentials.js'
import { McpCredentialEditor } from './McpCredentialEditor.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ui/ResourceCard.js'
import { useWorkspaceView } from './ui/workspace-view.js'
import { deriveMcpStatusViewModel, type McpStatusFilter } from './features/mcp-status/mcp-status-view-model.js'
import css from './mcp-status.module.css'
import { withBusyOperation } from './ui/busy-operation.js'

interface McpStatusPanelProps {
  t: Translate
  credentials?: CredentialApi
}

type Filter = McpStatusFilter

const EMPTY_STATUS: McpStatusPayload = {
  entries: [],
  observedAt: '',
  totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
}

/** DSH-native MCP inventory with a per-state overview and per-service detail. */
/** 中文：每行状态来自宿主观察和运行时诊断，详情页只操作当前权威服务。 */
/** 渲染 MCP 清单、筛选器和单服务详情弹窗。 */
export function McpStatusPanel({ t, credentials }: McpStatusPanelProps): ReactNode {
  const [payload, setPayload] = useState<McpStatusPayload>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useWorkspaceView()
  const [selected, setSelected] = useState<McpStatusEntry | undefined>(undefined)
  const [adding, setAdding] = useState(false)

  /** 刷新 MCP 状态并定位目标服务，防止对过期条目执行操作。 */
  const observe = async (id: string): Promise<McpStatusEntry> => {
    const refreshed = await fetchMcpStatus()
    setPayload(refreshed)
    const current = refreshed.entries.find(item => item.id === id)
    if (!current) throw new Error(t('mcpEntryGone'))
    setSelected(current)
    return current
  }
  /** 请求宿主重试所有失败挂载，再返回目标服务的最新状态。 */
  const retry = (id: string): Promise<McpStatusEntry> =>
    withBusyOperation(async () => {
      await retryMcpMounts()
      return observe(id)
    })
  /** 清除指定服务 OAuth 授权并重新挂载，返回重新授权后的状态。 */
  const reauthorize = (id: string, serverName: string): Promise<McpStatusEntry> =>
    withBusyOperation(async () => {
      await reauthorizeMcpServer(serverName)
      return observe(id)
    })

  /** 读取全量 MCP 状态，控制首屏加载态和错误提示。 */
  const refresh = (): void => {
    setLoading(true)
    setError(undefined)
    fetchMcpStatus()
      .then(setPayload)
      .catch(caught => {
        setError(caught instanceof Error ? caught.message : String(caught))
      })
      .finally(() => setLoading(false))
  }

  // 中文：进入面板时读取一次；后续动作明确要求刷新时复用同一入口。
  useEffect(() => {
    refresh()
  }, [])

  const viewModel = deriveMcpStatusViewModel(payload, filter, search)
  const { activeEntries, filtered, filterCounts } = viewModel
  // Hide the summary bar entirely while every active row is connected: the
  // green confirmation above an all-green list is noise, not information.
  // 中文：全绿列表不再额外显示绿色汇总提示，减少重复信息。
  // 中文：全部活跃服务已连接时隐藏汇总条，避免重复展示无信息增量的绿色提示。

  return h(
    'div',
    { className: css.surface },
    h(PanelHeader, {
      title: t('mcpStatusTitle'),
      subtitle: t('mcpStatusSubtitle'),
      actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: () => setAdding(true), refreshLabel: t('refresh'), onRefresh: refresh, busy: loading })
    }),
    h(SearchFilterToolbar, {
      className: css.toolbar,
      search,
      searchLabel: t('mcpSearch'),
      searchPlaceholder: t('mcpSearch'),
      onSearchChange: setSearch,
      filters: (['all', 'plugin', 'direct'] as Filter[]).map(kind => ({
        id: kind,
        label: filterLabel(t, kind),
        count: filterCounts[kind],
        icon: h(McpFilterIcon, { kind }),
        active: filter === kind,
        onSelect: () => setFilter(kind),
        hint: mcpFilterHint(t, kind)
      })),
      view,
      gridLabel: t('grid'),
      listLabel: t('list'),
      onViewChange: nextView => setView(nextView)
    }),
    error !== undefined
      ? h('div', { className: css.error }, error, h(Button, { variant: 'ghost', size: 'sm', onClick: refresh }, t('mcpRetry')))
      : loading && activeEntries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : filtered.length === 0
          ? h('div', { className: css.empty }, t('mcpEmpty'))
          : h(
              ResourceCollection,
              { view, className: view === 'grid' ? css.grid : css.list },
              filtered.map(entry => h(McpCard, { key: entry.id, entry, t, onClick: () => setSelected(entry) }))
            ),
    adding
      ? h(McpAddModal, {
          t,
          onClose: () => setAdding(false),
          onSaved: () => {
            setAdding(false)
            refresh()
          }
        })
      : null,
    selected === undefined
      ? null
      : h(McpDetailModal, {
          entry: selected,
          t,
          credentials,
          onClose: () => {
            setSelected(undefined)
            refresh()
          },
          onRetry: retry,
          onReauthorize: reauthorize,
          onRefresh: observe
        })
  )
}

/**
 * One chip per non-healthy state, shown only when that state is non-zero.
 *
 * The chips are ordered by severity so the first one the eye lands on is the
 * state that most needs attention, and the whole bar collapses to a single
 * "all connected" confirmation when nothing is wrong.
 */
/** 渲染 MCP 服务的紧凑状态卡片，详情和危险操作放在弹窗中。 */
function McpCard({ entry, t, onClick }: { entry: McpStatusEntry; t: Translate; onClick: () => void }): ReactNode {
  const interactive = {
    role: 'button' as const,
    tabIndex: 0,
    onClick,
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      // Enter and Space activate a role="button" the same way a native one does.
      // 中文：键盘 Enter/Space 与鼠标点击使用同一详情打开行为，满足无障碍交互。
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onClick()
    }
  }
  return h(
    ResourceCard,
    {
      className: css.card,
      state: entry.state === 'connected' ? 'active' : entry.state === 'disabled' ? 'disabled' : entry.state === 'failed' || entry.state === 'orphaned' ? 'error' : 'warning',
      ...interactive
    },
    h(
      'div',
      { className: css.cardBody },
      h(
        'div',
        { className: css.cardTop },
        h('span', { className: `${css.statusDot} ${css[`status${entry.state}`]}`, 'aria-hidden': true }),
        h('span', { className: css.service }, h('span', { className: css.name }, entry.name)),
        h('span', { className: css.toolCount }, entry.tools.length === 1 ? `${entry.tools.length} ${t('mcpTool')}` : `${entry.tools.length} ${t('mcpTools')}`)
      ),
      h('p', { className: css.endpoint }, entry.endpoint ?? t('mcpObservedEndpoint'))
      // Reason text, the state pill, and every action (retry, configure,
      // details) live in the detail dialog: the card keeps only the identity
      // line and the endpoint, so a wall of red cards stays scannable.
      // 中文：重试、配置和详情集中在弹窗，卡片只保留身份与端点以维持可扫描性。
    )
  )
}

/** 根据 MCP 来源绘制套件或用户直配图标。 */
function McpSourceIcon({ kind }: { kind: 'plugin' | 'direct' }): ReactNode {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  return kind === 'plugin'
    ? h(
        'svg',
        common,
        h('path', {
          d: 'M6 2.5v2H4A1.5 1.5 0 0 0 2.5 6v2h2a1.5 1.5 0 1 1 0 3h-2v2A1.5 1.5 0 0 0 4 14.5h2v-2a1.5 1.5 0 1 1 3 0v2h2a1.5 1.5 0 0 0 1.5-1.5v-2h-2a1.5 1.5 0 1 1 0-3h2V6A1.5 1.5 0 0 0 11 4.5H9v-2a1.5 1.5 0 1 0-3 0Z'
        })
      )
    : h('svg', common, h('circle', { cx: 8, cy: 5, r: 2.2 }), h('path', { d: 'M3.5 13c.6-2.2 2.1-3.3 4.5-3.3s3.9 1.1 4.5 3.3' }))
}

/** 为 MCP 来源筛选器提供统一图标。 */
function McpFilterIcon({ kind }: { kind: Filter }): ReactNode {
  if (kind === 'plugin') return h(McpSourceIcon, { kind: 'plugin' })
  if (kind === 'direct') return h(McpSourceIcon, { kind: 'direct' })
  return h(
    'svg',
    { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5 13.5 11' })
  )
}

/**
 * The detail dialog owns every action and every long text: state, reason,
 * credentials, config, tools, and the retry control with its in-place result
 * echo. The state pill is dropped entirely — the dot and the reason box carry
 * that information without a second red stamp.
 * 中文：详情弹窗是服务操作的单一入口，集中展示状态、原因、配置、凭据和工具。
 */
export function McpDetailModal({
  entry,
  t,
  credentials,
  onClose,
  onRetry,
  onReauthorize,
  onRefresh
}: {
  entry: McpStatusEntry
  t: Translate
  credentials?: CredentialApi
  onClose: () => void
  onRetry: (entryId: string) => Promise<McpStatusEntry>
  onReauthorize: (id: string, serverName: string) => Promise<McpStatusEntry>
  onRefresh: (id: string) => Promise<McpStatusEntry>
}): ReactNode {
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [confirmAuth, setConfirmAuth] = useState(false)
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>()
  const actions = mcpDetailActions(entry)
  /** 执行重试或重新授权，并把“已连接/仍不可用/失败”反馈给用户。 */
  const run = async (authorize: boolean): Promise<void> => {
    setConfirmAuth(false)
    setPending(true)
    setFeedback(undefined)
    try {
      const current = authorize ? await onReauthorize(entry.id, entry.name) : await onRetry(entry.id)
      const connected = current.state === 'connected'
      setFeedback({ error: !connected, text: connected ? t('mcpRetrySuccess') : t('mcpStillUnavailable') + (current.reason ? ': ' + current.reason : '') })
    } catch (reason) {
      setFeedback({ error: true, text: t('actionFail') + ': ' + (reason instanceof Error ? reason.message : String(reason)) })
    } finally {
      setPending(false)
    }
  }
  return h(DetailModal, {
    open: true,
    onClose: () => {
      if (!pending) onClose()
    },
    title: entry.name,
    description: t('mcpServiceDetail'),
    closeLabel: t('mcpClose'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      actions.retry
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending || dirty,
              title: dirty ? t('mcpSaveFirst') : t('mcpRetryPreservesCredentials'),
              onClick: () => {
                void run(false)
              }
            },
            h(IconRefreshOutlineRegular),
            t('mcpRetryConnection')
          )
        : null,
      actions.reauthorize
        ? h(
            Button,
            {
              variant: 'ghost',
              size: 'sm',
              disabled: pending || dirty,
              title: dirty ? t('mcpSaveFirst') : t('mcpReauthExplain'),
              onClick: () => {
                setConfirmAuth(true)
                setFeedback(undefined)
              }
            },
            t('mcpReauthorize')
          )
        : null,
      h(Button, { variant: 'ghost', disabled: pending, onClick: onClose }, t('mcpClose'))
    ),
    children: h(
      'div',
      { className: css.detail },
      feedback ? h('p', { role: feedback.error ? 'alert' : 'status', className: feedback.error ? css.error : css.retryEchoSuccess }, feedback.text) : null,
      confirmAuth
        ? h(
            'section',
            { className: css.reasonBox, role: 'alert' },
            h('p', null, t('mcpReauthExplain')),
            h(Button, { variant: 'ghost', onClick: () => setConfirmAuth(false) }, t('cancel')),
            h(
              Button,
              {
                variant: 'primary',
                disabled: dirty || pending,
                onClick: () => {
                  void run(true)
                }
              },
              t('mcpConfirmReauth')
            )
          )
        : null,
      dirty && (actions.retry || actions.reauthorize) ? h('p', { className: css.reasonText }, t('mcpSaveFirst')) : null,
      entry.state === 'needs-credentials' ? h('p', { className: css.reasonText }, t('mcpConfigureCredentialsFirst')) : null,
      h(
        'div',
        { className: css.detailHero },
        h('span', { className: `${css.statusDot} ${css[`status${entry.state}`]}`, 'aria-hidden': true }),
        h(
          'div',
          { className: css.detailHeroText },
          entry.endpoint === undefined ? null : h('p', { className: css.detailEndpoint }, entry.endpoint),
          // Source and transport moved here from the card meta row. The
          // qualified suite id disambiguates same-named servers from
          // different sources (e.g. two context7 installs).
          // 中文：详情补充来源和传输；限定 suite ID 区分不同 source 下的同名服务。
          h(
            'p',
            { className: css.detailEndpoint },
            [entry.kind === 'plugin' ? `${t('mcpPlugin')}: ${entry.suiteId ?? entry.source ?? '—'}` : t('mcpDirect'), entry.transport].join(' · ')
          )
        )
      ),
      // A foreign mount is informational: the localized hint (per cause —
      // another plugin, or another source's identical suite) replaces the raw
      // English reason, which drops to a dim secondary line for its details.
      // 中文：foreign mount 只是提示；界面按原因给出本地化说明，原始英文仅作次要诊断。
      entry.state === 'foreign'
        ? h(
            'div',
            { className: css.reasonBox },
            h('span', { className: css.reasonLabel }, t('mcpReasonLabel')),
            h('p', { className: css.reasonText }, entry.code === 'duplicate-mount' ? t('mcpDuplicateHint') : t('mcpForeignHint')),
            entry.reason === undefined ? null : h('p', { className: css.reasonRaw }, entry.reason)
          )
        : entry.reason === undefined
          ? null
          : h('div', { className: css.reasonBox }, h('span', { className: css.reasonLabel }, t('mcpReasonLabel')), h('p', { className: css.reasonText }, entry.reason)),
      entry.kind === 'direct' && !entry.managed ? h('p', { className: css.reasonText }, t('mcpDirectBoundary')) : null,
      entry.credentialRefs?.length === 0 || entry.credentialRefs === undefined ? null : h(McpCredentialEditor, { t, api: credentials, refs: entry.credentialRefs }),
      entry.kind === 'plugin' || entry.managed === true ? h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, t('mcpConfig')),
        h(ServerConfigDetail, {
          kind: 'mcp',
          id: entry.id,
          t,
          onDirtyChange: setDirty,
          onSaved: () => {
            void onRefresh(entry.id).catch(reason => setFeedback({ error: true, text: t('mcpSavedStatusUnknown') + ': ' + String(reason) }))
          }
        })
      ) : null,
      h(
        'section',
        { className: css.detailSection },
        h('h4', { className: css.detailHead }, `${t('mcpTools')} (${entry.tools.length})`),
        entry.tools.length === 0
          ? h('div', { className: css.detailEmpty }, entry.advertisedTools === false && entry.state === 'degraded' ? t('mcpZeroTools') : t('mcpNoTools'))
          : h(
              'div',
              { className: css.toolList },
              entry.tools.map(tool =>
                h(
                  'div',
                  { key: tool.name, className: css.tool },
                  h('span', { className: css.toolName }, tool.name),
                  tool.description === undefined || tool.description === '' ? null : h('span', { className: css.toolDescription }, tool.description)
                )
              )
            )
      )
    )
  })
}

/** 校验并新增一个用户直配 MCP 服务，成功后交回父面板刷新。 */
function McpAddModal({ t, onClose, onSaved }: { t: Translate; onClose: () => void; onSaved: () => void }): ReactNode {
  const [name, setName] = useState('')
  const [config, setConfig] = useState('{"type":"stdio","command":""}')
  const [valid, setValid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** 解析 JSON 配置并提交新增请求，统一处理异步忙碌和错误。 */
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void Promise.resolve()
      .then(() => addMcpServer(name.trim(), parseServerConfig(config)))
      .then(onSaved)
      .catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setBusy(false))
  }
  return h(DetailModal, {
    open: true,
    title: t('mcpAddTitle'),
    onClose: busy ? () => {} : onClose,
    closeLabel: t('cancel'),
    className: css.detailDialog,
    contentClassName: css.detailBody,
    footer: h(
      'div',
      { className: css.modalFooter },
      h(Button, { variant: 'ghost', disabled: busy, onClick: onClose }, t('cancel')),
      h(Button, { disabled: busy || name.trim() === '' || !valid, onClick: save }, t('save'))
    ),
    children: h(
      'div',
      { className: css.detail },
      h(
        'label',
        null,
        t('mcpServerName'),
        h(Input, {
          value: name,
          placeholder: t('mcpServerName'),
          'aria-label': t('mcpServerName'),
          disabled: busy,
          onChange: (event: { target: { value: string } }) => setName(event.target.value)
        })
      ),
      h(ServerConfigEditor, { kind: 'mcp', text: config, onChange: setConfig, t, disabled: busy, onValidityChange: setValid }),
      error === undefined ? null : h('div', { role: 'alert', className: css.error }, error)
    )
  })
}

/** 把 MCP 来源筛选值转换为当前语言的标签。 */
function filterLabel(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpPlugin')
  if (kind === 'direct') return t('mcpDirect')
  return t('mcpAll')
}

/** Hover/aria explanation for each MCP filter tab. */
/** 中文：为每个 MCP 来源筛选项提供悬浮和无障碍统计口径说明。 */
/** 返回筛选器的悬浮/无障碍说明，解释统计口径而非只显示数量。 */
function mcpFilterHint(t: Translate, kind: Filter): string {
  if (kind === 'plugin') return t('mcpFilterPluginHint')
  if (kind === 'direct') return t('mcpFilterDirectHint')
  return t('mcpFilterAllHint')
}
