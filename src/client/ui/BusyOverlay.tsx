/** 文件作用：在异步操作期间覆盖当前对话框或工作区，统一阻止重复交互并提供进度提示。 */
import { createElement as h, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { busySnapshot, operationTarget, subscribeBusy } from './busy-operation.js'
import type { Translate } from '../index.js'
import css from './busy-overlay.module.css'

/** 中文：上述计时用于过滤瞬时请求、保证最短可读时长，并在释放后平滑收起遮罩。 */
export const BUSY_SHOW_DELAY_MS = 200
export const BUSY_MIN_VISIBLE_MS = 400
export const BUSY_SETTLE_MS = 100

/** Mount once per client. A body-level host covers portaled dialogs without inheriting their inert state. */
/** 中文：每个客户端只挂载一次，body 级宿主可覆盖 portal 弹窗且不继承其 inert。 */
/** 订阅共享忙碌租约，处理延迟显示、最短显示时长和目标元素保留。 */
export function BusyOverlay({ t }: { t: Translate }): ReactNode {
  const tasks = useSyncExternalStore(subscribeBusy, busySnapshot, busySnapshot)
  const target = [...tasks].reverse().find(task => task.target?.isConnected)?.target ?? (tasks.length ? operationTarget() : null)
  const [heldTarget, setHeldTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  const startedAt = useRef<number | null>(null)
  const shownAt = useRef<number | null>(null)
  const active = tasks.length > 0

  /** 根据共享租约延迟显示或收起遮罩，并在租约切换时保留正确的定位目标。 */
  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    if (active && target) {
      setHeldTarget(target)
      startedAt.current ??= Date.now()
      if (shownAt.current === null) {
        timer = setTimeout(
          () => {
            // 中文：延迟结束后记录实际显示时间，供最短显示时长计算。
            shownAt.current = Date.now()
            setVisible(true)
          },
          Math.max(0, BUSY_SHOW_DELAY_MS - (Date.now() - startedAt.current))
        )
      }
    } else {
      // 结束租约后清空计时和目标，避免下一次操作继承旧遮罩。
      /** 清除当前遮罩的计时和目标，避免下一次操作继承旧状态。 */
      const clear = (): void => {
        startedAt.current = null
        shownAt.current = null
        setVisible(false)
        setHeldTarget(null)
      }
      if (shownAt.current === null) clear()
      else timer = setTimeout(clear, Math.max(BUSY_SETTLE_MS, BUSY_MIN_VISIBLE_MS - (Date.now() - shownAt.current)))
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [active, target])

  const displayedTarget = target ?? (heldTarget?.isConnected ? heldTarget : null)
  return displayedTarget && (active || visible) ? h(ActiveOverlay, { target: displayedTarget, t, visible }) : null
}

/** 将遮罩定位到目标元素，并负责 inert、焦点陷阱和事件拦截的生命周期。 */
function ActiveOverlay({ target, t, visible }: { target: HTMLElement; t: Translate; visible: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState(() => target.getBoundingClientRect())
  const [message, setMessage] = useState(0)
  const hints = [t('busyHintProcessing'), t('busyHintRefresh'), t('busyHintWaiting')]

  /** 遮罩可见时轮换进度提示，隐藏后释放定时器。 */
  useEffect(() => {
    if (!visible) return
    // 中文：循环切换提示文案，保持遮罩在长请求期间仍有反馈。
    const timer = setInterval(() => setMessage(value => (value + 1) % hints.length), 3200)
    return () => clearInterval(timer)
  }, [hints.length, visible])

  /** 为目标区域设置 inert 和事件拦截，并跟随弹窗尺寸、位置及焦点变化。 */
  useLayoutEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const inertBefore = target.hasAttribute('inert')
    const busyBefore = target.getAttribute('aria-busy')
    target.setAttribute('inert', '')
    target.setAttribute('aria-busy', 'true')
    const scope = target.closest('[role="presentation"]') ?? target
    /** 阻止遮罩目标内的交互事件，避免忙碌期间重复提交或关闭弹窗。 */
    const stop = (event: Event): void => {
      // 遮罩期间阻止目标区域和弹窗背景上的提交、点击及键盘操作。
      if (ref.current?.contains(event.target as Node)) return
      // Include the modal backdrop: otherwise a click outside the dialog can close an active save.
      // 中文：连同弹窗背景一起拦截，避免保存进行中点击背景关闭弹窗。
      if (event instanceof KeyboardEvent || scope.contains(event.target as Node)) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    /** 将误入被锁定区域的焦点拉回遮罩，维持忙碌期间的焦点陷阱。 */
    const trapFocus = (event: FocusEvent): void => {
      // 焦点意外落入被锁定区域时拉回遮罩，避免用户继续修改表单。
      if (scope.contains(event.target as Node)) ref.current?.focus({ preventScroll: true })
    }
    /** 重新测量目标边界，供遮罩定位并避免无实际变化的状态更新。 */
    const update = (): void => {
      // 对话框可能移动或做 transform 动画，遮罩需持续跟随其边界。
      const next = target.getBoundingClientRect()
      setRect(previous => (previous.top === next.top && previous.left === next.left && previous.width === next.width && previous.height === next.height ? previous : next))
    }
    // ResizeObserver does not observe transform animations on the host dialog.
    // 中文：ResizeObserver 看不到宿主弹窗的位移动画，因此还需逐帧跟随位置。
    let frame = 0
    // requestAnimationFrame 追踪 transform 位移，ResizeObserver 只负责尺寸变化。
    /** 用动画帧跟随 transform 位移；尺寸变化由 ResizeObserver 处理。 */
    const follow = (): void => {
      update()
      frame = requestAnimationFrame(follow)
    }
    if (typeof requestAnimationFrame !== 'undefined') frame = requestAnimationFrame(follow)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    observer?.observe(target)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.addEventListener(event, stop, true)
    window.addEventListener('focusin', trapFocus, true)
    ref.current?.focus({ preventScroll: true })
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      for (const event of ['pointerdown', 'click', 'keydown', 'submit']) window.removeEventListener(event, stop, true)
      window.removeEventListener('focusin', trapFocus, true)
      if (!inertBefore) target.removeAttribute('inert')
      if (busyBefore === null) target.removeAttribute('aria-busy')
      else target.setAttribute('aria-busy', busyBefore)
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true })
    }
  }, [target])

  return h(
    'div',
    {
      ref,
      className: css.overlay,
      tabIndex: -1,
      'data-operation-overlay': true,
      'data-visible': visible,
      role: 'status',
      'aria-live': 'polite',
      'aria-label': t('panelWorking'),
      style: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, borderRadius: getComputedStyle(target).borderRadius },
      onKeyDown: (event: { preventDefault(): void; stopPropagation(): void }) => {
        // 中文：遮罩自身也不接受键盘操作，事件不向下层表单传播。
        event.preventDefault()
        event.stopPropagation()
      }
    },
    visible
      ? h(
          'div',
          { className: css.content },
          h('span', { className: css.spinner, 'aria-hidden': true }, h(IconLoadingOutlineRegular, { size: 28 })),
          h('strong', { className: css.label }, t('panelWorking')),
          h('div', { className: css.hintViewport }, h('p', { key: message, className: css.hint }, hints[message]))
        )
      : null
  )
}
