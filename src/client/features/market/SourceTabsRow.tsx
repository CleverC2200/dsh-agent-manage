/** 文件作用：管理数据源标签条的折叠、展开、悬停和键盘焦点交互，避免标签过多挤压套件列表。 */
/**
 * The source chip strip: an equal-width pill grid that folds to two rows and
 * expands in place on hover or keyboard focus.
 *
 * Chips keep the header's original `auto-fill` grid, so every pill in a row is
 * the same width and long ids ellipsize instead of stretching a column. While
 * folded the grid is lifted out of the flow at a fixed two-row height with a
 * bottom fade hinting at the rest; hovering or focusing it grows the same grid
 * as an overlay, so the card grid below never moves. Picking a source folds the
 * strip again at once. Chips keep their id order — the selected source is not
 * moved to the front.
 *
 * 中文：来源标签使用等宽网格，超过两行时折叠；悬停或键盘焦点进入后以覆盖层展开，
 * 不推动下方卡片布局，选中来源后立即恢复折叠。
 */
/** 中文：标签保持来源顺序；折叠只改变显示层级，不改变当前选中项位置。 */
import { createElement as h, useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { SourceTab } from './SourceTab.js'
import type { Translate } from '../../index.js'
import css from '../../market.module.css'

/** Rows kept visible while folded. */
/** 中文：折叠时保留给用户直接看到的标签行数。 */
const COLLAPSED_ROWS = 2
/** One chip row: the 24px pill plus the 4px grid gap that follows it. */
/** 中文：一行标签由 24px 胶囊高度和其后的 4px 网格间距组成。 */
const CHIP_ROW_HEIGHT = 28
/** Folded content height: two rows without the trailing gap. */
/** 中文：两行折叠内容高度，不计最后一行之后的多余间距。 */
const COLLAPSED_CONTENT_HEIGHT = CHIP_ROW_HEIGHT * COLLAPSED_ROWS - 4
/** Overlay padding above the grid; `scrollHeight` includes it. */
/** 中文：网格上方覆盖层内边距，测量 scrollHeight 时必须计入。 */
const OVERLAY_PADDING = 6
/** `scrollHeight` that still fits the folded grid — taller means it can expand. */
/** 中文：不超过该高度时无需展开，超过则启用悬停展开。 */
const COLLAPSED_SCROLL_HEIGHT = COLLAPSED_CONTENT_HEIGHT + OVERLAY_PADDING
/**
 * How long the pointer must stay outside the strip before hover expansion is
 * re-armed. Folding after a pick can push the pointer out of the box
 * mid-gesture; without this grace the very next pointer move reopens the strip.
 * 中文：折叠导致指针短暂离开标签条后，需要等待该宽限时间再允许重新展开。
 */
const LEAVE_GRACE_MS = 300

/** One chip in the source strip. */
/** 中文：数据源标签的显示文本和可用编辑/删除动作。 */
export interface SourceTabItem {
  id: string
  /** Visible chip text: `id · kind count`. */
  /** 中文：标签上展示数据源 id、类型和能力数量。 */
  label: string
  /** Hover hint (scan diagnostics); undefined renders no title. */
  /** 中文：扫描诊断悬停提示。 */
  title?: string
  /** The selected source exposes its edit control. */
  /** 中文：仅当前选中的数据源显示编辑入口。 */
  editable?: boolean
  /** Source chips can be removed; the leading `全部` chip cannot. */
  /** 中文：普通来源可删除，最前面的“全部”范围标签不可删除。 */
  deletable?: boolean
}

export interface SourceTabsRowProps {
  t: Translate
  /** `全部` first, the selected source second, the remaining sources after it. */
  /** 中文：标签顺序由父级整理为“全部”、当前来源和其余来源。 */
  items: readonly SourceTabItem[]
  activeId: string
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string) => void
}

/**
 * Render the source chip grid, folded when it needs more than two rows.
 *
 * @param props - Chips in display order, the active scope, and chip actions.
 * @returns An equal-width pill grid that unfolds as an overlay.
 *
 * 中文：根据标签内容测量是否需要折叠，并把选中、编辑、删除事件委托给父级。
 */
export function SourceTabsRow(props: SourceTabsRowProps): ReactNode {
  /** 测量标签内容并渲染可折叠的数据源范围选择条。 */
  const { t, items, activeId, onSelect, onDelete, onEdit } = props
  const gridRef = useRef<HTMLDivElement>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [folded, setFolded] = useState(false)
  // Picking a source folds the strip immediately, even though the pointer is
  // still inside it; leaving the strip (or focus) re-arms the hover expansion.
  // 中文：选中后立即折叠；指针或焦点离开后才允许悬停再次展开。
  const [picked, setPicked] = useState(false)

  /** 取消尚未执行的离开宽限计时，避免指针仍在标签条内时提前解除 picked。 */
  const cancelLeave = useCallback(() => {
    // 清除离开延时，避免折叠期间的指针移动立即重新展开。
    if (leaveTimer.current === undefined) return
    clearTimeout(leaveTimer.current)
    leaveTimer.current = undefined
  }, [])
  /** 组件卸载时清理离开计时器，避免定时回调触碰已卸载视图。 */
  useEffect(() => cancelLeave, [cancelLeave])

  /** 读取完整网格高度并更新折叠状态，供布局变化和 ResizeObserver 共用。 */
  const measure = useCallback(() => {
    // 用完整滚动高度判断是否超过两行，而不是读取当前裁剪后的可见高度。
    const grid = gridRef.current
    if (grid === null) return
    // scrollHeight reports the full content height even while the fold clips
    // it, and it does not change when the overlay expands on hover — so the
    // fold state stays stable while the pointer is inside the strip.
    // 中文：用完整内容高度判断是否需要折叠，展开覆盖层时不会反复改变折叠状态。
    setFolded(grid.scrollHeight > COLLAPSED_SCROLL_HEIGHT)
  }, [])

  /** 首次渲染及标签尺寸变化后重新测量折叠阈值。 */
  useLayoutEffect(() => {
    measure()
    const grid = gridRef.current
    if (grid === null || typeof ResizeObserver === 'undefined') return
    // 中文：尺寸变化时重新计算标签条是否超过两行。
    const observer = new ResizeObserver(() => measure())
    observer.observe(grid)
    return () => observer.disconnect()
  }, [measure, items])

  const className = [css.sourceTabsBox, folded ? css.sourceTabsBoxFold : '', picked ? css.sourceTabsBoxPicked : ''].filter(Boolean).join(' ')
  return h(
    'div',
    {
      className,
      onMouseEnter: cancelLeave,
      onMouseLeave: () => {
        // Grace period: a pointer swept out by the fold itself must not count
        // as "left the strip", or the next move reopens it at once.
        // 中文：折叠造成的瞬时出界不算真正离开，避免下一次移动立即重开。
        cancelLeave()
        leaveTimer.current = setTimeout(() => {
          leaveTimer.current = undefined
          setPicked(false)
        }, LEAVE_GRACE_MS)
      },
      onBlur: (event: FocusEvent<HTMLDivElement>) => {
        // Focus left the strip entirely (the clicked pill keeps focus inside).
        // 中文：只有焦点完全离开标签条才解除 picked 状态，标签按钮内部移动不解除。
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          cancelLeave()
          setPicked(false)
        }
      }
    },
    h(
      'div',
      { ref: gridRef, className: css.sourceTabsRow },
      ...items.map(item =>
        h(SourceTab, {
          key: item.id,
          t,
          active: item.id === activeId,
          label: item.label,
          title: item.title,
          onSelect: () => {
            setPicked(true)
            onSelect(item.id)
          },
          onDelete: item.deletable === true ? () => onDelete(item.id) : undefined,
          onEdit: item.editable === true ? () => onEdit(item.id) : undefined
        })
      )
    )
  )
}
