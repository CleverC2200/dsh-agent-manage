/** 文件作用：集中提供各资源面板共用的标题栏、忙碌反馈、Markdown 编辑器、确认弹窗和来源徽标。 */
/**
 * Shared panel building blocks for the plugin workspace surfaces
 * (market / skills / commands / personas / MCP / LSP).
 *
 * Everything the six panels repeat lives here: the surface shell (title +
 * actions + toolbar + scrollable content region), the busy indicator, the
 * entry editor modal, the danger-confirm modal, and the source badge. The
 * pieces are intentionally small and prop-driven so a panel composes them
 * instead of re-implementing the geometry.
 *
 * 中文：本文件集中复用六类工作区面板的标题栏、滚动容器、忙碌遮罩、Markdown 编辑器、
 * 危险操作确认框和来源徽标，让业务面板只负责提供数据与动作。
 * @module client/ui/panel
 */
import { createElement as h, useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal, IconLoadingOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './panel.module.css'
import { beginBusyOperation } from './busy-operation.js'
import { DetailModal } from './DetailModal.js'
import { MarkdownDocument } from './MarkdownDocument.js'
import type { Translate } from '../index.js'
import detailCss from './detail.module.css'

/** One header action slot (a button + its handler). */
/** 中文：描述一个带标签和处理器的标题栏动作位。 */
export interface PanelAction {
  key: string
  label: string
  title?: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** The trailing header commands have one position and one visual treatment. */
/** 中文：标题栏末端的新增和刷新命令共享位置与视觉样式。 */
export function PanelActions(props: { addLabel?: string; onAdd?: () => void; refreshLabel?: string; onRefresh?: () => void; busy?: boolean }): ReactNode {
  /** 渲染面板右侧新增/刷新动作，并在忙碌时统一禁用按钮。 */
  return h('div', { className: css.headerActions },
    props.onAdd === undefined ? null : h(Button, { variant: 'ghost', size: 'sm', disabled: props.busy, title: props.addLabel, 'aria-label': props.addLabel, onClick: props.onAdd }, h(IconPlusOutlineRegular), props.addLabel),
    props.onRefresh === undefined ? null : h(Button, { variant: 'ghost', size: 'sm', disabled: props.busy, title: props.refreshLabel, 'aria-label': props.refreshLabel, onClick: props.onRefresh }, h(IconRefreshOutlineRegular)))
}

/** Shared heading geometry for all resource tabs. */
/** 中文：所有资源标签页共享标题、说明和操作的头部几何。 */
export function PanelHeader(props: { title: string; subtitle?: string; actions?: ReactNode }): ReactNode {
  /** 输出统一标题、说明和动作区域，保证不同面板头部几何一致。 */
  return h('header', { className: css.header, 'data-panel-header': true },
    h('div', { className: css.headerText },
      h('h2', { className: css.title }, props.title),
      props.subtitle === undefined ? null : h('p', { className: css.subtitle }, props.subtitle)),
    props.actions === undefined ? null : h('div', { className: css.headerActions }, props.actions))
}

/** Shared panel shell: title, subtitle, actions, and the scroll region body. */
/** 中文：组合标题、说明、动作和可滚动正文，作为各资源面板的统一外壳。 */
export function PanelShell(props: { title: string; subtitle?: string; actions?: PanelAction[]; children: ReactNode }): ReactNode {
  /** 组合标题栏和可滚动正文，按声明式动作配置生成面板外壳。 */
  return h(
    'div',
    { className: css.shell },
    h(PanelHeader, {
      title: props.title,
      subtitle: props.subtitle,
      // 中文：将声明式动作转换为统一样式的按钮，并保留每个动作的禁用状态。
      actions: props.actions?.map(action =>
              h(
                Button,
                {
                  key: action.key,
                  variant: 'ghost',
                  size: 'sm',
                  disabled: action.disabled === true,
                  title: action.title ?? action.label,
                  onClick: action.onSelect
                },
                action.label
              )
            )
    }),
    h('div', { className: css.body }, props.children)
  )
}

/**
 * Inline loading feedback, or a lease on the client's shared blocking overlay.
 * Overlay leases render no layout element and can span request + refresh work.
 */
/** 中文：行内模式显示加载文字，overlay 模式申请共享阻塞层，可跨越请求和刷新阶段。 */
export function BusyIndicator(props: { label?: string; overlay?: boolean }): ReactNode {
  /** 根据 overlay 选择行内加载提示或共享阻塞遮罩租约。 */
  if (props.overlay) return h(BusyLease)
  return h(
    'div',
    { className: css.busyLine, role: 'status' },
    h('span', { className: `${css.spinner} ${css.spinning}`, 'aria-hidden': true }, h(IconLoadingOutlineRegular)),
    props.label === undefined ? null : h('span', { className: css.busyLabel }, props.label)
  )
}

/** Hold the shared mask through local refresh/validation after the HTTP mutation finishes. */
/** 中文：HTTP 变更完成后继续持有遮罩，直到本地刷新和校验也结束。 */
function BusyLease(): ReactNode {
  /** 挂载时申请共享忙碌租约，卸载时由 effect 清理对应租约。 */
  useEffect(() => beginBusyOperation(), [])
  return null
}

/** The source badge: where an entry comes from (suite plugin vs user). */
/** 中文：来源徽标区分套件插件条目和用户目录条目。 */
export function SourceBadge(props: { kind: 'plugin' | 'user'; label: string; detail?: string }): ReactNode {
  /** 显示条目来自插件还是用户目录，并把路径作为悬停详情。 */
  return h('span', { className: props.kind === 'plugin' ? css.badgePlugin : css.badgeUser, title: props.detail ?? props.label }, props.label)
}

/** Editor state for the shared entry editor modal. */
/** 中文：共享条目编辑器的草稿状态，区分新增空白草稿和编辑原文。 */
export interface PanelEditorState {
  /** 'create' starts a blank draft; 'edit' loads the entry's raw text. */
  /** 中文：create 创建空白草稿，edit 加载服务端保存的原始文本。 */
  mode: 'create' | 'edit'
  name: string
  id?: string
  path?: string
  text: string
}

/** The shared Markdown entry editor: name (create only) + raw text. */
/** 中文：共享 Markdown 编辑器只在新增时编辑名称，并始终编辑原始正文。 */
export function EntryEditorModal(props: {
  t: Translate
  open: boolean
  state: PanelEditorState | undefined
  title: string
  nameLabel: string
  textLabel: string
  hint?: string
  busy?: boolean
  saveError?: string
  saveLabel?: string
  cancelLabel?: string
  renderFields?: (text: string, onChange: (text: string) => void) => ReactNode
  onClose: () => void
  onSave: (state: PanelEditorState) => Promise<boolean>
}): ReactNode {
  /** 管理新增/编辑 Markdown 条目的本地草稿、预览模式、校验和保存回调。 */
  const [draft, setDraft] = useState<PanelEditorState | undefined>(props.state)
  const [error, setError] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<'preview' | 'edit'>(props.state?.mode === 'create' ? 'edit' : 'preview')
  /** 当父级切换编辑对象或打开状态时重置草稿、错误和预览模式。 */
  useEffect(() => {
    setDraft(props.state)
    setError(undefined)
    setMode(props.state?.mode === 'create' ? 'edit' : 'preview')
  }, [props.state, props.open])
  if (!props.open || props.state === undefined) return null
  const current = draft ?? props.state
  return h(
    DetailModal,
    {
      open: true,
      onClose: () => {
        // 中文：忙碌期间不允许关闭弹窗，避免请求完成前丢失编辑上下文。
        if (props.busy !== true) props.onClose()
      },
      title: props.title,
      closeLabel: props.cancelLabel ?? '×',
      className: css.editorDialog,
      contentClassName: css.editorBody,
      footer: h(
        'div',
        { className: css.editorFooter },
        (error ?? props.saveError) === undefined ? null : h('span', { className: css.editorError, role: 'alert' }, error ?? props.saveError),
        h(Button, { variant: 'ghost', disabled: props.busy, onClick: props.onClose }, props.cancelLabel ?? '×'),
        h(
          Button,
          {
            variant: 'primary',
            disabled: props.busy === true,
            onClick: () => {
              // 中文：先校验名称，再交给父级保存；异步失败时保持弹窗打开。
              if (current.name.trim() === '') {
                setError(props.nameLabel)
                return
              }
              void props
                .onSave({ ...current, name: current.name.trim() })
                .then(ok => {
                  // A failed save keeps the modal open; the panel-level
                  // error strip also carries the message, so only clear a
                  // stale inline validation error here.
                  // 中文：保存失败保留弹窗，面板错误条负责展示请求错误；成功时只清理旧的行内校验错误。
                  if (ok) setError(undefined)
                })
                .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
            }
          },
          props.saveLabel ?? '✓'
        )
      )
    },
    h(
      'div',
      { className: css.editorForm },
      props.state.mode === 'create'
        ? h(
            'label',
            { className: css.editorLabel },
            props.nameLabel,
            h(Input, {
              value: current.name,
              disabled: props.busy,
              placeholder: props.nameLabel,
              'aria-label': props.nameLabel,
              onChange: (event: { target: HTMLInputElement }) => setDraft({ ...current, name: event.target.value })
            })
          )
        : h(
            'div',
            { className: css.editorNameRow },
            h('code', { className: css.editorPath }, props.state.path ?? props.state.name)
          ),
      props.renderFields?.(current.text, text => setDraft({ ...current, text })),
      props.hint === undefined ? null : h('p', { className: css.editorHint }, props.hint),
      h('div', { className: detailCss.modes }, (['preview', 'edit'] as const).map(value => h('button', { type: 'button', className: detailCss.mode, 'aria-pressed': mode === value, onClick: () => setMode(value), key: value }, props.t(value === 'preview' ? 'detailPreview' : 'detailMarkdown')))),
      mode === 'preview' ? h(MarkdownDocument, { text: current.text, t: props.t }) : h(
        'label',
        { className: css.editorLabel },
        props.textLabel,
        h('textarea', {
          className: css.editorArea,
          value: current.text,
          disabled: props.busy,
          rows: 14,
          spellCheck: false,
          'aria-label': props.textLabel,
          onChange: (event: { target: HTMLTextAreaElement }) => setDraft({ ...current, text: event.target.value })
        })
      )
    )
  )
}

/** Danger-confirm state for the shared confirm modal. */
/** 中文：共享危险操作确认弹窗的标题、描述、复选框和确认回调。 */
export interface PanelConfirmState {
  title: string
  description?: string
  /** Optional extra checkbox (e.g. "also delete local files"). */
  /** 中文：可选的额外确认项，例如同时删除本地文件。 */
  checkbox?: { label: string; checked: boolean }
  onConfirm: (checkboxChecked: boolean) => Promise<void> | void
}

/** The shared danger-confirm modal with an optional checkbox. */
/** 中文：复用的危险操作确认弹窗，可把复选框结果传给业务回调。 */
export function ConfirmModal(props: { state: PanelConfirmState | undefined; confirmLabel: string; cancelLabel: string; busy?: boolean; onClose: () => void }): ReactNode {
  /** 显示危险操作确认，并把可选复选框状态传入业务确认函数。 */
  const [checked, setChecked] = useState(false)
  /** 弹窗状态变化时同步复选框初值，避免复用旧确认状态。 */
  useEffect(() => {
    setChecked(props.state?.checkbox?.checked === true)
  }, [props.state])
  if (props.state === undefined) return null
  return h(
    Modal,
    {
      open: true,
      onClose: props.onClose,
      title: props.state.title,
      description: props.state.description,
      closeLabel: props.cancelLabel,
      footer: h(
        'div',
        { className: css.editorFooter },
        h(Button, { variant: 'ghost', onClick: props.onClose }, props.cancelLabel),
        h(
          Button,
          {
            variant: 'primary',
            disabled: props.busy === true,
            onClick: () => {
              // 中文：把用户勾选值交给业务确认回调，完成后关闭弹窗。
              void Promise.resolve(props.state!.onConfirm(checked)).then(() => props.onClose())
            }
          },
          props.confirmLabel
        )
      )
    },
    props.state.checkbox === undefined
      ? null
      : h(
          'label',
          { className: css.confirmCheck },
          h('input', {
            type: 'checkbox',
            checked,
            onChange: (event: { target: HTMLInputElement }) => setChecked(event.target.checked)
          }),
          props.state.checkbox.label
        )
  )
}
