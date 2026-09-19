/** Shared status icon used by market and MCP status filter tabs. */
/** 文件作用：为市场筛选标签提供统一的全部、已安装、未安装状态图标。 */
import { createElement as h, type ReactNode } from 'react'

export type StatusIconKind = 'all' | 'installed' | 'uninstalled'

export interface StatusIconProps {
  kind: StatusIconKind
}

/** An SVG status icon for the all/installed/uninstalled filter tabs. */
/** 中文：根据筛选类别返回对应的纯 SVG 图标，不改变筛选状态。 */
export function StatusIcon({ kind }: StatusIconProps): ReactNode {
  /** 根据筛选类别返回对应 SVG 图标，不承载筛选状态本身。 */
  const common = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true } as const
  if (kind === 'installed') {
    return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.5 }), h('path', { d: 'm5.5 8 1.7 1.7 3.4-3.4' }))
  }
  if (kind === 'uninstalled') {
    return h('svg', common, h('path', { d: 'M8 2v8m-3-3 3 3 3-3M3 13h10' }))
  }
  return h('svg', common, h('path', { d: 'M2.5 5 8 2.5 13.5 5 8 7.5 2.5 5Zm0 3L8 10.5 13.5 8M2.5 11 8 13.5 13.5 11' }))
}
