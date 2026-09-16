/** 文件作用：提供资源卡片和集合容器的统一结构标记，让不同业务面板共享状态边框和布局语义。 */
import { createElement as h, type HTMLAttributes, type ReactNode } from 'react'
import css from './resource-card.module.css'

export type ResourceState = 'active' | 'disabled' | 'warning' | 'error'

/** State chrome shared by every resource, independent of the source and the content layout. */
/** 中文：资源状态外观与来源、内容布局解耦，所有资源卡片复用。 */
export function ResourceCard({ state, className, children, ...props }: HTMLAttributes<HTMLElement> & { state: ResourceState; children?: ReactNode }): ReactNode {
  /** 输出带资源状态标记的 article，保留调用方传入的 HTML 属性和内容。 */
  return h('article', { ...props, className: `${className ?? ''} ${css.card}`, 'data-resource-state': state }, children)
}

/** A shared, shrinkable scroll area: grid and list never stretch individual cards vertically. */
/** 中文：集合容器可收缩滚动，网格和列表不会把单张卡片强行拉高。 */
export function ResourceCollection({ view, className, children }: { view: 'grid' | 'list'; className?: string; children?: ReactNode }): ReactNode {
  /** 输出声明当前网格/列表视图的滚动容器，避免子卡片被统一拉伸。 */
  return h('div', { className: `${className ?? ''} ${css.collection}`, 'data-resource-view': view }, children)
}
