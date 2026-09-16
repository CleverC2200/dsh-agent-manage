/**
 * Error boundary for untrusted preview content.
 *
 * Skill/command/agent bodies and hook/LSP JSON are third-party content; a
 * renderer throw must degrade to a plain-text fallback instead of unmounting
 * the whole settings section (React has no built-in boundary).
 *
 * 文件作用：隔离第三方技能、命令、Hook 和 LSP 预览渲染异常。
 * 业务职责：把单条不可信内容的渲染失败降级为可读提示，保持整个市场设置区继续可用。
 */
import { createElement as h, Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error) => ReactNode
}

interface State {
  error: Error | undefined
}

/** 组件边界：隔离预览渲染错误，向父面板输出稳定的降级节点。 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined }

  /** 将 React 捕获的渲染异常写入边界状态，触发降级视图。 */
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  /** 记录预览异常的诊断上下文，不让异常冒泡卸载整个设置区。 */
  override componentDidCatch(error: Error, info: unknown): void {
    console.warn('[dsh-agent-plugins-market] preview render failed:', error, info)
  }

  /** 按错误状态选择自定义回退内容或统一的纯文本提示。 */
  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return this.props.fallback === undefined
        ? h('pre', { className: 'dsh-agent-plugins-fallback' }, `预览渲染失败：${this.state.error.message}`)
        : this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}
