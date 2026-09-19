/** 文件作用：提供统一的详情/编辑弹窗和固定底部操作槽，确保保存按钮不随正文滚动。 */
import { createContext, createElement as h, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { createPortal } from 'react-dom'
import css from './detail.module.css'

const FooterTarget = createContext<HTMLDivElement | null>(null)

/** Configuration editors contribute their save action to the same fixed footer as other details. */
/** 中文：配置编辑器把保存操作放入详情页统一固定底部，而不是随正文滚动。 */
export function DetailFooterAction({ children }: { children: ReactNode }): ReactNode {
  /** 将子操作 portal 到详情弹窗底部槽；脱离弹窗上下文时不渲染。 */
  const target = useContext(FooterTarget)
  return target === null ? null : createPortal(children, target)
}

/** One wide, viewport-bounded dialog for all resource details and editors. */
/** 中文：所有资源详情和编辑器共用宽度受视口约束的弹窗。 */
export function DetailModal(props: ComponentProps<typeof Modal>): ReactNode {
  /** 包装基础 Modal，注入统一尺寸、正文样式和可被子编辑器复用的 footer slot。 */
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  return h(
    FooterTarget.Provider,
    { value: target },
    h(Modal, {
      ...props,
      className: `${props.className ?? ''} ${css.dialog}`,
      contentClassName: `${props.contentClassName ?? ''} ${css.body}`,
      footer: h('div', { className: css.footer }, props.footer, h('div', { ref: setTarget, className: css.footerSlot }))
    })
  )
}
