/**
 * The Agent Plugins Market settings section.
 *
 * Layout: repository sources run along the TOP as chips (全部 first), with
 * edit-current / add / refresh-all controls on the right; below sit search,
 * status tabs, and the card grid. Colors ride the dsh --dsw-alias-* tokens
 * with light-mode fallbacks so the page follows the active theme.
 *
 * 文件作用：渲染 Agent Plugins 市场主面板。
 * 业务职责：加载源与套件总览，协调搜索/筛选/安装/卸载/刷新等动作，并把宿主进度和确认状态映射为用户可操作的界面。
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { postAction, type OverviewData, type SuiteCardData } from './api.js'
import { readOverview, loadOverview, invalidateOverview, startSourceProgressPolling, type SourceProgressState } from './features/market/market-resource.js'
import { deriveMarketViewModel, type MarketCategory, type MarketFilter } from './features/market/market-view-model.js'
import { SourceTabsRow, type SourceTabItem } from './features/market/SourceTabsRow.js'
import { SourceEditorModal, type EditorState } from './features/market/SourceEditorModal.js'
import { interpolate } from './ui/interpolate.js'
import { InstallConfirmModal, type InstallConfirmState } from './features/market/InstallConfirmModal.js'
import { SuiteCard } from './features/market/SuiteCard.js'
import { StatusIcon } from './ui/StatusIcon.js'
import type { Translate } from './index.js'
import type { CredentialApi } from './credentials.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { SuiteDetailModal } from './SuiteDetail.js'
import { SearchFilterToolbar } from './SearchFilterToolbar.js'
import { BusyIndicator } from './ui/panel.js'
import css from './market.module.css'
import { useWorkspaceView } from './ui/workspace-view.js'
import { PanelHeader, PanelActions } from './ui/panel.js'
import { ResourceCollection } from './ui/ResourceCard.js'

/** Host step keys -> translation keys, resolved against the active t(). */
/** 中文：后端进度键只在此处映射为用户可见文案，未知值保留诊断信息。 */
const PROGRESS_STEP_LABELS: Record<string, string> = {
  cloning: 'progressCloning',
  downloading: 'progressDownloading',
  reading: 'progressReading'
}

export interface MarketSectionProps {
  t: Translate
  /** Host credentials wire used for write-only MCP env configuration. */
  /** 中文：宿主凭据线用于 MCP 引用的只写配置，组件不读取 secret。 */
  credentials?: CredentialApi
}

type Tab = MarketFilter
type Category = MarketCategory

interface ToastState {
  key: number
  message: string
}

interface ConfirmState {
  kind: 'uninstall' | 'removeSource'
  sourceId: string
  suiteId?: string
  /** removeSource only: also physically delete the managed checkout. */
  /** 中文：仅 removeSource 使用；勾选后才物理删除管理器拥有的 checkout。 */
  deleteCheckout: boolean
}

/** 将宿主进度步骤标识转换为当前语言文案，未知步骤保留原值便于诊断。 */
function progressStepLabel(t: Translate, step: string): string {
  const key = PROGRESS_STEP_LABELS[step]
  return key === undefined ? step : t(key as Parameters<Translate>[0])
}

/** 维护市场总览、筛选器和源/套件操作的页面状态。 */
export function MarketSection({ t, credentials }: MarketSectionProps): ReactNode {
  const [overview, setOverview] = useState<OverviewData>(() => readOverview().initial)
  const [loading, setLoading] = useState(() => readOverview().revalidating)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [category, setCategory] = useState<Category>('all')
  const [view, setView] = useWorkspaceView()
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [toast, setToast] = useState<ToastState | undefined>(undefined)
  const [confirm, setConfirm] = useState<ConfirmState | undefined>(undefined)
  const [installConfirm, setInstallConfirm] = useState<InstallConfirmState | undefined>(undefined)
  const [editor, setEditor] = useState<EditorState>(undefined)
  const [detail, setDetail] = useState<{ sourceId: string; suiteId: string } | undefined>(undefined)
  const [progress, setProgress] = useState<SourceProgressState>({ step: undefined, error: undefined })

  const requestSequence = useRef(0)

  const read = useCallback(async () => {
    const sequence = ++requestSequence.current
    try {
      const data = await loadOverview().promise
      if (sequence === requestSequence.current) setOverview(data)
    } catch {
      if (sequence === requestSequence.current) setToast({ key: Date.now(), message: t('loadFail') })
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [t])

  const refresh = useCallback(async () => {
    invalidateOverview()
    await read()
  }, [read])

  useEffect(() => {
    void read()
    return () => {
      requestSequence.current++
    }
  }, [read])

  /** 执行一次宿主市场动作，完成后刷新权威总览并返回是否成功。 */
  const action = useCallback(
    async (key: string, path: string, body: Record<string, unknown>): Promise<boolean> => {
      setBusy(key)
      try {
        await postAction(path, body)
        await refresh()
        return true
      } catch (error) {
        setToast({ key: Date.now(), message: `${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}` })
        return false
      } finally {
        setBusy(undefined)
      }
    },
    [refresh, t]
  )

  const viewModel = useMemo(() => deriveMarketViewModel(overview, search, tab, category), [overview, search, tab, category])
  const { scopeTotals, filtered } = viewModel

  /** 打开指定套件的卸载确认，实际写操作交给 confirmAction。 */
  const openUninstall = useCallback((suite: SuiteCardData) => {
    setConfirm({ kind: 'uninstall', sourceId: suite.sourceId, suiteId: suite.suiteId, deleteCheckout: false })
  }, [])

  /** 根据当前确认类型执行卸载套件或移除仓库源。 */
  const confirmAction = useCallback(async () => {
    if (confirm === undefined) return
    if (confirm.kind === 'uninstall' && confirm.suiteId !== undefined) {
      await action(`u:${confirm.suiteId}`, 'uninstall', { sourceId: confirm.sourceId, suiteId: confirm.suiteId })
    } else if (confirm.kind === 'removeSource') {
      // deleteCheckout physically removes self-acquired checkouts (the host
      // still protects adopted/local directories), so the removed source
      // does not reappear as an "unmanaged checkout" entry.
      // 中文：收编/本地目录仍由宿主保护，删除动作不会把受保护目录变成未管理来源。
      // 中文：只删除管理器自己获取的 checkout；收编或本地目录仍受保护，不会再次显示为未管理来源。
      await action(`s:${confirm.sourceId}`, 'sources/remove', { id: confirm.sourceId, deleteCheckout: confirm.deleteCheckout })
      if (category === confirm.sourceId) setCategory('all')
    }
    setConfirm(undefined)
  }, [confirm, action, category])

  const selectedSource = category === 'all' ? undefined : overview.sources.find(source => source.id === category)

  // Chips read `全部` first, then the selected source, then every other source
  // by id: picking a source keeps it in view once the strip folds, and the
  // rest of the strip never reshuffles. Kind badges are limited to
  // `本地`/`压缩包`; an adopted checkout is an implementation detail, not a
  // user-facing state.
  // 中文：标签顺序稳定；收编 checkout 是实现细节，不作为用户状态展示。
  /** 生成稳定的源标签顺序，并把扫描提示/本地来源映射为可读标记。 */
  const sourceItems = useMemo<SourceTabItem[]>(() => {
    const sorted = [...overview.sources].sort((a, b) => a.id.localeCompare(b.id))
    const ordered =
      selectedSource === undefined ? sorted : [selectedSource, ...sorted.filter(source => source.id !== selectedSource.id)]
    return [
      { id: 'all', label: `${t('tabAll')} ${overview.totals.all}` },
      ...ordered.map(source => {
        const notes = source.scanNotes ?? []
        const noteHint = notes.length === 0 ? undefined : `${t('scanNotes')}: ${notes.slice(0, 8).join(t('sourceErrorSeparator'))}`
        const kindBadge = source.local === true ? t('sourceLocal') : source.kind === 'archive' ? t('sourceArchive') : undefined
        return {
          id: source.id,
          label: `${source.id}${kindBadge === undefined ? '' : ` · ${kindBadge}`} ${source.suiteIds.length}${source.cloned === false || notes.length > 0 ? ' ⚠' : ''}`,
          ...(noteHint === undefined ? {} : { title: noteHint }),
          editable: selectedSource?.id === source.id,
          deletable: true
        }
      })
    ]
  }, [overview.sources, overview.totals.all, selectedSource, t])

  /** 收编发现的未登记本地源，只登记来源，不在客户端复制或删除目录。 */
  const adoptSource = useCallback(
    async (id: string) => {
      await action(`s:adopt:${id}`, 'sources/adopt', { id })
    },
    [action]
  )
  const unmanaged = overview.unmanaged ?? []

  return h(ErrorBoundary, {
    fallback: error => h('div', { className: css.empty }, `${t('actionFail')}: ${error.message}`),
    children: h(
      'div',
      { className: css.market },
      h(
        'div',
        { className: css.header },
        h(PanelHeader, { title: t('nav'), actions: h(PanelActions, { addLabel: t('addSource'), onAdd: () => setEditor({ mode: 'add' }), refreshLabel: t('refreshAll'), onRefresh: () => { void action('s:refresh:all', 'sources/refresh', {}) }, busy: busy !== undefined }) }),
        h(
          'div',
          { className: css.marketControls },
          h(SourceTabsRow, {
            t,
            items: sourceItems,
            activeId: category,
            onSelect: setCategory,
            onDelete: id => setConfirm({ kind: 'removeSource', sourceId: id, deleteCheckout: true }),
            onEdit: id => {
              const source = overview.sources.find(entry => entry.id === id)
              if (source !== undefined) setEditor({ mode: 'edit', source })
            }
          }),
          unmanaged.length === 0
            ? null
            : h(
                'div',
                { className: css.unmanagedRow },
                h('span', { className: css.unmanagedLabel }, t('unmanagedTitle')),
                ...unmanaged.map(entry =>
                  h(
                    'span',
                    { key: entry.id, className: css.unmanagedChip, title: entry.url ?? t('unmanagedNoRemote') },
                    h('span', { className: css.unmanagedChipName }, entry.id),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: css.unmanagedAdopt,
                        disabled: busy !== undefined,
                        title: t('unmanagedAdopt'),
                        onClick: () => {
                          void adoptSource(entry.id)
                        }
                      },
                      '＋'
                    )
                  )
                )
              ),
          h(SearchFilterToolbar, {
            search,
            searchLabel: t('searchPh'),
            searchPlaceholder: t('searchPh'),
            onSearchChange: setSearch,
            filters: [
              { id: 'all', label: t('tabAll'), count: scopeTotals.all, icon: h(StatusIcon, { kind: 'all' }), active: tab === 'all', onSelect: () => setTab('all') },
              {
                id: 'installed',
                label: t('tabInstalled'),
                count: scopeTotals.installed,
                icon: h(StatusIcon, { kind: 'installed' }),
                active: tab === 'installed',
                onSelect: () => setTab('installed')
              },
              {
                id: 'uninstalled',
                label: t('tabUninstalled'),
                count: scopeTotals.all - scopeTotals.installed,
                icon: h(StatusIcon, { kind: 'uninstalled' }),
                active: tab === 'uninstalled',
                onSelect: () => setTab('uninstalled')
              }
            ],
            view,
            gridLabel: t('grid'),
            listLabel: t('list'),
            onViewChange: nextView => setView(nextView)
          })
        )
      ),
      // Keep the global mask until both the mutation and list refresh finish.
      // 中文：写操作及总览刷新都完成前保持全局遮罩，避免用户对旧数据再次操作。
      busy !== undefined ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
      h(
        ResourceCollection,
        { view, className: view === 'grid' ? css.grid : css.list },
        loading
          ? h('div', { className: css.empty }, t('loading'))
          : filtered.length === 0
            ? h('div', { className: css.empty }, tab === 'installed' ? t('installedEmpty') : t('empty'))
            : filtered.map(suite =>
                h(SuiteCard, {
                  key: `${suite.sourceId}/${suite.suiteId}`,
                  t,
                  suite,
                  busy: busy !== undefined,
                  onOpen: () => setDetail({ sourceId: suite.sourceId, suiteId: suite.suiteId }),
                  onInstall: () => {
                    const source = overview.sources.find(entry => entry.id === suite.sourceId)
                    setInstallConfirm({
                      suite,
                      ...(source?.lockCommit === undefined ? {} : { lockCommit: source.lockCommit }),
                      ...(source?.local === true ? { localSource: true } : {})
                    })
                  },
                  onAddSource: () => {
                    if (suite.remoteUrl !== undefined) void action(`a:${suite.suiteId}`, 'sources/add', { url: suite.remoteUrl })
                  },
                  onToggle: () => {
                    void action(`e:${suite.suiteId}`, 'set-enabled', { sourceId: suite.sourceId, suiteId: suite.suiteId, enabled: !suite.enabled })
                  },
                  onRefresh: () => {
                    void action(`r:${suite.suiteId}`, 'sources/refresh', { id: suite.sourceId })
                  },
                  onUninstall: () => openUninstall(suite)
                })
              )
      ),
      toast === undefined ? null : h(Toast, { key: toast.key, text: toast.message, onDone: () => setToast(undefined) }),
      installConfirm === undefined
        ? null
        : h(InstallConfirmModal, {
            t,
            state: installConfirm,
            busy: busy !== undefined,
            onClose: () => setInstallConfirm(undefined),
            onConfirm: async () => {
              const ok = await action(`i:${installConfirm.suite.suiteId}`, 'install', {
                sourceId: installConfirm.suite.sourceId,
                suiteId: installConfirm.suite.suiteId
              })
              if (ok) setInstallConfirm(undefined)
              return ok
            }
          }),
      confirm === undefined
        ? null
        : h(Modal, {
            open: true,
            onClose: () => setConfirm(undefined),
            title:
              confirm.kind === 'uninstall'
                ? t('uninstallConfirmTitle')
                : interpolate(t('removeSourceConfirmTitle', { sourceId: confirm.sourceId }), { sourceId: confirm.sourceId }),
            closeLabel: t('cancel'),
            description: confirm.kind === 'uninstall' ? t('uninstallConfirmDesc') : t('removeSourceConfirmDesc'),
            children:
              confirm.kind === 'removeSource'
                ? h(
                    'label',
                    { className: css.confirmCheck },
                    h('input', {
                      type: 'checkbox',
                      checked: confirm.deleteCheckout,
                      onChange: event =>
                        setConfirm({
                          ...confirm,
                          deleteCheckout: (event.target as HTMLInputElement).checked
                        })
                    }),
                    confirm.deleteCheckout ? t('removeSourceDeleteFiles') : t('removeSourceKeepFiles')
                  )
                : null,
            footer: h(
              'div',
              { className: css.modalFooter },
              h(Button, { variant: 'ghost', disabled: busy !== undefined, onClick: () => setConfirm(undefined) }, t('cancel')),
              h(
                Button,
                {
                  variant: 'primary',
                  disabled: busy !== undefined,
                  onClick: () => {
                    void confirmAction()
                  }
                },
                t('confirmDelete')
              )
            )
          }),
      detail === undefined
        ? null
        : h(SuiteDetailModal, {
            t,
            credentials,
            sourceId: detail.sourceId,
            suiteId: detail.suiteId,
            onClose: () => setDetail(undefined)
          }),
      editor === undefined
        ? null
        : h(SourceEditorModal, {
            t,
            editor,
            busy: busy !== undefined,
            progress,
            onClose: () => setEditor(undefined),
            // 中文：新增源时启动进度轮询并等待刷新完成；编辑源复用统一 action，成功后关闭编辑器。
            onSave: async ({ url, branch, kind, sha256 }) => {
              const key = editor.mode === 'edit' ? `s:edit:${editor.source.id}` : `s:add:${url}`
              const body: Record<string, unknown> = { url, local: kind === 'local', kind }
              if (branch !== '' && kind === 'git') body['branch'] = branch
              if (sha256 !== '' && kind === 'archive') body['sha256'] = sha256
              if (editor.mode === 'add') {
                setBusy(key)
                setProgress({ step: t('progressStarting'), error: undefined })
                const poll = startSourceProgressPolling(setProgress, step => progressStepLabel(t, step))
                try {
                  const payload = await postAction('sources/add', body)
                  const derived = (payload['source'] as { id?: string } | undefined)?.id
                  invalidateOverview()
                  await refresh()
                  setEditor(undefined)
                  if (derived !== undefined) setCategory(derived)
                  return true
                } catch (error) {
                  setToast({ key: Date.now(), message: `${t('actionFail')}: ${error instanceof Error ? error.message : String(error)}` })
                  setProgress({ step: undefined, error: error instanceof Error ? error.message : String(error) })
                  return false
                } finally {
                  poll.stop()
                  setBusy(undefined)
                }
              }
              const ok = await action(key, 'sources/update', { id: editor.source.id, ...body })
              if (ok) setEditor(undefined)
              return ok
            },
            onRemove: async id => {
              setConfirm({ kind: 'removeSource', sourceId: id, deleteCheckout: true })
              setEditor(undefined)
            }
          })
    )
  })
}
