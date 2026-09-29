/** 文件作用：承载 skills、commands、personas 三类用户面板的通用搜索、筛选、网格/列表和 CRUD 交互。 */
/**
 * The generic user-panel surface: search, state filter, grid/list toggle,
 * and full CRUD over one user panel directory. The skills / commands /
 * agent-personas panels mount this component with their own kind and copy —
 * one implementation, three surfaces, identical interaction language.
 *
 * 中文：本组件统一承载用户资源面板的搜索、状态筛选、网格/列表切换及增删改查，
 * 通过 kind 和翻译文案复用同一套交互，不把不同面板的差异扩散到存储流程。
 * @module client/ui/UserPanelSurface
 */
import { createElement as h, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconEditOutlineRegular, IconTrashOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToggleSwitch } from './ToggleSwitch.js'
import { createUserPanelEntry, deleteUserPanelEntry, fetchUserPanel, updateUserPanelEntry, type UserPanelEntry, type UserPanelKind } from '../api.js'
import type { Translate } from '../index.js'
import { SearchFilterToolbar } from '../SearchFilterToolbar.js'
import { ResourceCard, ResourceCollection } from './ResourceCard.js'
import { useWorkspaceView } from './workspace-view.js'
import { PanelActions, PanelHeader, BusyIndicator, ConfirmModal, EntryEditorModal, SourceBadge, type PanelConfirmState, type PanelEditorState } from './panel.js'
import css from './panel.module.css'
import { RoleMetadataFields } from '../features/personas/RoleMetadataFields.js'
import { readRoleFields, updateFrontmatter } from '../features/personas/frontmatter.js'

/** Draft templates per panel kind (bilingual; the user edits from here). */
/** 中文：按业务面板生成双语草稿，作为用户新增条目的起始内容。 */
/** 按面板类型生成可直接编辑的 Markdown 初始模板。 */
function draftTemplate(kind: UserPanelKind, t: Translate): string {
  if (kind === 'skills') {
    return ['---', `description: ${t('panelDraftSkillDesc')}`, '---', '', t('panelDraftSkillBody'), ''].join('\n')
  }
  if (kind === 'commands') {
    return ['---', `description: ${t('panelDraftCommandDesc')}`, 'argument-hint: ', '---', '', `${t('panelDraftCommandBody')}: $ARGUMENTS`, ''].join('\n')
  }
  return ['---', `description: ${t('panelDraftPersonaDesc')}`, '---', '', t('panelDraftPersonaBody'), ''].join('\n')
}

type PanelFilter = 'all' | 'disabled' | 'user' | 'plugin'

/** The generic user-panel surface for one panel kind. */
/** 中文：同一套交互覆盖 skills、commands、personas 三种条目面板。 */
/** 统一管理条目加载、筛选、编辑、启停和删除，并把面板差异收敛到 kind 与翻译文案。 */
export function UserPanelSurface(props: {
  t: Translate
  kind: UserPanelKind
  /** The "quick reply" hint line, only rendered for commands. */
  /** 中文：仅 commands 面板显示的快捷回复提示行。 */
  hint?: string
}): ReactNode {
  const { t, kind } = props
  const [entries, setEntries] = useState<UserPanelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PanelFilter>('all')
  const [view, setView] = useWorkspaceView()
  const [editor, setEditor] = useState<PanelEditorState | undefined>(undefined)
  const [confirm, setConfirm] = useState<PanelConfirmState | undefined>(undefined)
  // Latest-wins guard: overlapping mutations re-read the list, and a slow
  // earlier response must never overwrite a newer one's result.
  // 中文：并发刷新通过序号实行“最新结果胜出”，旧响应不能覆盖新列表。
  const refreshSeq = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    /** 拉取当前面板条目；用序号保证慢响应不能覆盖更新后的列表。 */
    const seq = ++refreshSeq.current
    setError(undefined)
    try {
      const data = await fetchUserPanel(kind)
      // 中文：只有序号仍是最新值时才写回条目，避免旧请求覆盖当前面板。
      if (refreshSeq.current === seq) setEntries(data)
    } catch (reason) {
      // 中文：只展示当前请求错误，已过期请求不改变用户当前看到的提示。
      if (refreshSeq.current === seq) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      // 中文：当前请求结束后关闭加载态，过期请求不影响新一轮加载。
      if (refreshSeq.current === seq) setLoading(false)
    }
  }, [kind])

  /** 切换面板类型时清空旧状态并重新加载当前 kind 的资源。 */
  useEffect(() => {
    setEntries([])
    setLoading(true)
    setSearch('')
    setFilter('all')
    setEditor(undefined)
    setConfirm(undefined)
    void refresh()
    return () => {
      // 中文：卸载或切换 kind 时递增序号，使在途响应失效。
      refreshSeq.current++
    }
  }, [refresh])

  /** Mutate with the shared busy spinner + error surface, then re-read. */
  /** 中文：使用共享忙碌提示执行变更，完成后重新读取列表以获得服务端真值。 */
  const mutate = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      /** 执行一次 CRUD 操作并重新读取列表，统一处理 busy 状态和错误信息。 */
      setBusy(true)
      setError(undefined)
      try {
        await work()
        await refresh()
        return true
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason))
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh]
  )

  const needle = search.trim().toLowerCase()
  /** 仅在本地投影上完成搜索和来源/禁用筛选，不改变服务端条目。 */
  const visible = useMemo(
    // 搜索字段来自服务端原文投影，筛选只改变视图，不修改条目数据。
    () =>
      entries.filter(entry => {
        if ((filter === 'user' || filter === 'plugin') && entry.origin !== filter) return false
        if (filter === 'disabled' && !entry.disabled) return false
        if (needle !== '' && !`${entry.name} ${entry.description} ${entry.suiteName ?? ''} ${entry.path}`.toLowerCase().includes(needle)) return false
        return true
      }),
    [entries, needle, filter]
  )
  const disabledCount = entries.filter(entry => entry.disabled).length

  /** 打开新增编辑器并准备当前面板类型的最小草稿。 */
  const openCreate = (): void => {
    /** 打开新增草稿，按当前面板类型填入最小可用 frontmatter。 */
    setError(undefined)
    setEditor({ mode: 'create', name: '', text: draftTemplate(kind, t) })
  }

  /** 打开既有条目的原文编辑器，保留服务端返回的路径和 rawText。 */
  const openEdit = (entry: UserPanelEntry): void => {
    /** 用服务端保留的 rawText 打开编辑，确保 YAML 注释和 Markdown 正文不丢失。 */
    setError(undefined)
    // The server's raw document preserves YAML metadata and Markdown exactly.
    // 中文：编辑时使用服务端原文，保留 YAML 元数据、注释和 Markdown 正文。
    setEditor({ mode: 'edit', id: entry.id ?? entry.name, name: entry.name, path: entry.path, text: entry.rawText })
  }

  /** 切换条目的 disabled frontmatter，并在服务端成功后刷新列表。 */
  const toggleDisabled = (entry: UserPanelEntry): void => {
    /** 只更新 disabled 元数据键，沿用通用 mutation 刷新列表。 */
    void mutate(() => updateUserPanelEntry(kind, entry.id ?? entry.name, updateFrontmatter(entry.rawText, 'disabled', !entry.disabled)))
  }

  /** 校验并保存新增/编辑草稿，成功时关闭编辑器，失败时保留错误上下文。 */
  const saveEditor = async (state: PanelEditorState): Promise<boolean> => {
    /** 校验 persona 路由后按新增/编辑模式提交文本，成功才关闭编辑器。 */
    if (kind === 'agents') {
      const fields = readRoleFields(state.text)
      if (fields.provider !== '' && (fields.model === '' || fields.model === 'inherit')) {
        setError(t('personaSelectModel'))
        return false
      }
    }
    if (state.mode === 'create') {
      const ok = await mutate(() => createUserPanelEntry(kind, state.name, state.text))
      if (ok) setEditor(undefined)
      return ok
    }
    const ok = await mutate(() => updateUserPanelEntry(kind, state.id ?? state.name, state.text))
    if (ok) setEditor(undefined)
    return ok
  }

  /** 打开删除确认；真正删除由确认弹窗的回调执行。 */
  const openDelete = (entry: UserPanelEntry): void => {
    /** 打开删除确认，不在用户确认前改变服务端条目。 */
    setConfirm({
      title: t('panelDeleteTitle', { name: entry.name }),
      description: t('panelDeleteDesc', { path: entry.path }),
      onConfirm: async () => {
        // 中文：用户确认后才执行删除，并在完成后重新拉取服务端清单。
        await mutate(() => deleteUserPanelEntry(kind, entry.id ?? entry.name))
      }
    })
  }

  const panelTitle = kind === 'skills' ? t('workspaceTabSkills') : kind === 'commands' ? t('workspaceTabCommands') : t('workspaceTabPersonas')
  const panelDescription = kind === 'skills' ? t('skillsPanelDescription') : kind === 'commands' ? t('commandsPanelDescription') : t('personasPanelDescription')

  return h(
    'div',
    { className: css.shell },
    // 中文：手动刷新只重新读取当前面板，不改变筛选和编辑器草稿。
    h(PanelHeader, { title: panelTitle, subtitle: panelDescription, actions: h(PanelActions, { addLabel: t('panelAdd'), onAdd: openCreate, refreshLabel: t('refresh'), onRefresh: () => { void refresh() }, busy }) }),
    error === undefined ? null : h('div', { className: css.editorError }, error),
    busy ? h(BusyIndicator, { overlay: true, label: t('panelWorking') }) : null,
    h(SearchFilterToolbar, {
      search,
      searchLabel: t('panelSearchLabel'),
      searchPlaceholder: t('panelSearchLabel'),
      onSearchChange: setSearch,
      filters: [
        { id: 'all', label: t('panelFilterAll'), count: entries.length, icon: null, active: filter === 'all', onSelect: () => setFilter('all') },
        ...(['user', 'plugin'] as const).map(origin => ({
          id: origin,
          label: t(origin === 'user' ? 'panelSourceUser' : 'panelSourcePlugin'),
          count: entries.filter(entry => entry.origin === origin).length,
          icon: null,
          active: filter === origin,
          onSelect: () => setFilter(origin)
        })),
        { id: 'disabled', label: t('panelFilterDisabled'), count: disabledCount, icon: null, active: filter === 'disabled', onSelect: () => setFilter('disabled') }
      ],
      view,
      gridLabel: t('grid'),
      listLabel: t('list'),
      onViewChange: nextView => setView(nextView),
    }),
    h(
      'div',
      { className: css.body },
      loading && entries.length === 0
        ? h('div', { className: css.empty }, t('loading'))
        : visible.length === 0
          ? h('div', { className: css.empty }, t('panelEmpty'))
          : h(
              ResourceCollection,
              { view, className: view === 'grid' ? css.entryGrid : css.entryList },
              visible.map(entry =>
                h(UserEntryRow, {
                  key: entry.id ?? entry.name,
                  entry,
                  t,
                  compact: view === 'grid',
                  kind,
                  busy,
                  onEdit: () => openEdit(entry),
                  onToggle: () => toggleDisabled(entry),
                  onDelete: () => openDelete(entry)
                })
              )
            ),
      props.hint === undefined ? null : h('p', { className: css.editorHint }, props.hint)
    ),
    h(EntryEditorModal, {
      t,
      open: editor !== undefined,
      state: editor,
      title: editor?.mode === 'create' ? t('panelAddTitle') : editor?.name ?? t('panelEditTitle'),
      nameLabel: t('panelNamePh'),
      textLabel: t('panelTextPh'),
      busy,
      saveError: error,
      saveLabel: t('panelSave'),
      cancelLabel: t('cancel'),
      renderFields: kind === 'agents' ? (text, onChange) => h(RoleMetadataFields, { text, onChange, t, disabled: busy }) : undefined,
      onClose: () => setEditor(undefined),
      onSave: saveEditor
    }),
    h(ConfirmModal, {
      state: confirm,
      confirmLabel: t('confirmDelete'),
      cancelLabel: t('cancel'),
      busy,
      onClose: () => setConfirm(undefined)
    })
  )
}

/** One entry row: name, source badge, description, path, and row actions. */
/** 中文：条目行组合名称、来源徽标、描述、路径及操作按钮。 */
function UserEntryRow(props: {
  entry: UserPanelEntry
  t: Translate
  compact: boolean
  kind: UserPanelKind
  busy: boolean
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
}): ReactNode {
  /** 将单条用户面板条目投影为卡片/列表行，并连接编辑、删除和启停操作。 */
  const { entry, t } = props
  const metaPairs = Object.entries(entry.metadata).filter(([key]) => key !== 'description' && key !== 'disabled' && key !== 'name')
  return h(
    ResourceCard,
    { className: css.entryRow, state: entry.disabled ? 'disabled' : 'active' },
    h(
      'div',
      { className: css.entryMain },
      h(
        'div',
        { className: css.entryHead },
        h('button', { type: 'button', className: css.entryName, onClick: props.onEdit, title: t('panelDetails') }, props.kind === 'commands' ? `/${entry.name}` : entry.name),
        h(SourceBadge, {
          kind: entry.origin,
          label: entry.origin === 'user' ? t('panelSourceUser') : `${t('panelSourcePlugin')}${entry.suiteName ? ` · ${entry.suiteName}` : ''}`,
          detail: entry.path
        }),
        entry.disabled ? h('span', { className: css.editorPath }, t('panelDisabledBadge')) : null
      ),
      entry.description === '' ? null : h('p', { className: css.entryDesc }, entry.description),
      props.compact ? null : h('span', { className: css.entryPath }, entry.path),
      metaPairs.length === 0 || props.compact
        ? null
        : h('span', { className: css.entryPath }, metaPairs.map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join(' · '))
    ),
    h(
      'div',
      { className: css.entryActions },
      h('button', { type: 'button', className: css.iconBtn, 'aria-label': t('panelEditTitle'), disabled: props.busy, title: t('panelEditTitle'), onClick: props.onEdit }, h(IconEditOutlineRegular)),
      h(
        'button',
        {
          type: 'button',
          className: `${css.iconBtn} ${css.iconBtnDanger}`,
          'aria-label': t('panelDelete'),
          disabled: props.busy,
          title: t('panelDelete'),
          onClick: props.onDelete
        },
        h(IconTrashOutlineRegular)
      ),
      h(ToggleSwitch, { on: !entry.disabled, disabled: props.busy, title: entry.disabled ? t('enable') : t('disable'), onChange: props.onToggle })
    )
  )
}
