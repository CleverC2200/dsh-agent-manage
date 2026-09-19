/** Shared switch control (ON = primary button fill, like every host toggle). */
/** 文件作用：提供可复用的开关按钮外观和无障碍语义，具体启停业务由 onChange 回调处理。 */
import { createElement as h, type ReactNode } from 'react'
import css from '../market.module.css'

export interface ToggleSwitchProps {
  on: boolean
  disabled?: boolean
  title?: string
  onChange: () => void
}

/** A green/gray switch control for suite enable state. */
/** 中文：绿色表示启用、灰色表示停用，点击事件由父组件决定具体业务。 */
export function ToggleSwitch(props: ToggleSwitchProps): ReactNode {
  /** 将布尔状态渲染为开关按钮，点击时阻止卡片冒泡并通知父级切换。 */
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.on,
      title: props.title,
      'aria-label': props.title,
      disabled: props.disabled,
      className: props.on ? css.switchOn : css.switchOff,
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        props.onChange()
      }
    },
    h('span', { className: css.switchThumb })
  )
}
