/** 文件作用：维护所有工作区标签共享的网格/列表显示偏好，并同步到 localStorage。 */
import { useSyncExternalStore } from 'react'

export type WorkspaceView = 'grid' | 'list'
const KEY = 'dsh-agent-plugins-market:view'
const listeners = new Set<() => void>()
let view: WorkspaceView = 'grid'
let initialized = false

/** 首次读取持久化视图偏好；存储不可用时回退到当前会话状态。 */
function snapshot(): WorkspaceView {
  /** 首次读取持久化视图偏好；存储不可用时回退到当前会话状态。 */
  if (!initialized && typeof window !== 'undefined') {
    initialized = true
    try { view = window.localStorage.getItem(KEY) === 'list' ? 'list' : 'grid' } catch { /* Session state still works without storage. */ /* 中文：无法访问存储时仍保留当前会话选择。 */ }
  }
  return view
}

/** 更新共享视图并尽力持久化，随后通知所有面板重新渲染。 */
function setView(next: WorkspaceView): void {
  /** 更新共享视图并尽力持久化，随后通知所有面板重新渲染。 */
  view = next
  initialized = true
  try { window.localStorage.setItem(KEY, next) } catch { /* Keep the selection for this session. */ /* 中文：持久化失败时不影响本次会话的显示模式。 */ }
  listeners.forEach(listener => listener())
}

/** 订阅本地变更和跨标签页 storage 事件，返回卸载清理函数。 */
function subscribe(listener: () => void): () => void {
  /** 订阅本地变更和跨标签页 storage 事件，返回卸载清理函数。 */
  listeners.add(listener)
  /** 过滤无关的 storage 变化并刷新共享视图快照，避免其他键触发面板重渲染。 */
  const onStorage = (event: StorageEvent): void => {
    /** 仅响应本工作区键，确保其他 localStorage 变化不触发面板刷新。 */
    if (event.key !== KEY && event.key !== null) return
    initialized = false
    snapshot()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

/** All workspace tabs share one persisted display preference. Search and filters remain tab-specific. */
/** 暴露 React 订阅值和设置器，供各面板共享同一显示模式。 */
export function useWorkspaceView(): readonly [WorkspaceView, typeof setView] {
  /** 暴露 React 订阅值和设置器，供各面板共享同一显示模式。 */
  return [useSyncExternalStore(subscribe, snapshot, () => 'grid'), setView]
}
