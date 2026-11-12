import { createElement as h, type ReactNode } from 'react'
import css from '../plugin-settings.module.css'

export interface ToggleSwitchProps {
  on: boolean
  disabled?: boolean
  title?: string
  onChange: () => void
}

export function ToggleSwitch(props: ToggleSwitchProps): ReactNode {

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
