/** A source tab with trailing edit and delete controls. 中文：带编辑、删除尾部操作的数据源标签。 */
/** 文件作用：渲染单个数据源标签及其编辑、删除操作，阻止操作按钮冒泡到选中事件。 */
import { createElement as h, type ReactNode } from 'react'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

export interface SourceTabProps {
  t: Translate
  active?: boolean
  label: string
  /** Hover hint for the tab (e.g. scan diagnostics); undefined hides it. */
  /** 中文：可选的扫描诊断悬停提示；未提供时不渲染 title。 */
  title?: string
  onSelect: () => void
  onDelete?: () => void
  onEdit?: () => void
}

/** A source chip with a trailing delete control (deletion confirms at the section level). 中文：删除动作只上报给父级，由父级统一确认。 */
export function SourceTab(props: SourceTabProps): ReactNode {
  /** 根据数据源状态渲染标签，并把选择、编辑、删除事件传给父级。 */
  const { t, active = false, label, title, onSelect, onDelete, onEdit } = props
  return h(
    'div',
    { className: active ? css.srcTabOn : css.srcTab, title },
    h('button', { type: 'button', className: css.srcTabMain, onClick: onSelect }, label),
    onEdit === undefined
      ? null
      : h(
          'button',
          {
            type: 'button',
            className: css.srcTabEdit,
            title: t('editSource'),
            onClick: (event: { stopPropagation(): void }) => {
              // 中文：编辑按钮阻止冒泡，避免同时触发来源选中。
              event.stopPropagation()
              onEdit()
            }
          },
          '✎'
        ),
    onDelete === undefined
      ? null
      : h(
          'button',
          {
            type: 'button',
            className: css.srcTabDel,
            title: t('remove'),
            onClick: (event: { stopPropagation(): void }) => {
              // 中文：删除按钮阻止冒泡，避免删除操作意外切换来源。
              event.stopPropagation()
              onDelete()
            }
          },
          '×'
        )
  )
}
