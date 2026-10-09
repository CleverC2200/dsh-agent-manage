/** One operation lease per asynchronous workflow; nested requests cannot dismiss another lease. 中文：每个异步流程持有独立租约，并发请求不会互相提前关闭遮罩。 */
/** 文件作用：维护跨面板共享的异步操作租约，供 BusyOverlay 统一显示和释放阻塞层。 */
export interface BusyOperation {
  id: number
  target: HTMLElement | null
}
const pending = new Map<number, BusyOperation>()
const listeners = new Set<() => void>()
let nextId = 0
let snapshot: readonly BusyOperation[] = []

/** 将当前租约快照广播给所有订阅者，驱动共享遮罩刷新。 */
function publish(): void {
  snapshot = [...pending.values()]
  listeners.forEach(listener => listener())
}

/** 选择最上层可见对话框，否则退回工作区根节点作为遮罩目标。 */
export function operationTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.getClientRects().length > 0)
  return dialogs.at(-1) ?? document.querySelector<HTMLElement>('[data-agent-plugins-workspace]')
}

/** 创建一笔独立租约并返回幂等释放函数，避免并发请求互相结束遮罩。 */
export function beginBusyOperation(target = operationTarget()): () => void {
  const id = ++nextId
  pending.set(id, { id, target })
  publish()
  return () => {
    if (pending.delete(id)) publish()
  }
}

/** 用租约包裹异步工作，保证成功和异常路径都会释放忙碌状态。 */
export async function withBusyOperation<T>(work: () => Promise<T>): Promise<T> {
  const end = beginBusyOperation()
  try {
    return await work()
  } finally {
    end()
  }
}

/** 注册外部订阅者，并返回移除订阅的清理函数。 */
export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
/** 返回 React 外部 store 所需的稳定只读租约快照。 */
export function busySnapshot(): readonly BusyOperation[] {
  return snapshot
}
