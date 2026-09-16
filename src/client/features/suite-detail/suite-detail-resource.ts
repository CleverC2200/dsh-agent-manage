/** Request-order guard for asynchronously loaded suite detail content. */
/** 文件作用：为详情弹窗提供最新请求保护，防止较慢的旧响应覆盖当前套件内容。 */

/** A small monotonic guard that invalidates stale detail responses. */
/** 中文：用单调递增序号标记详情请求，旧响应可被统一判定为失效。 */
export interface LatestRequestGuard {
  /** 为下一次详情加载分配递增请求编号。 */
  next(): number
  /** 使当前在途详情响应全部失效。 */
  invalidate(): void
  /** 判断请求编号是否仍代表当前详情内容。 */
  isCurrent(requestId: number): boolean
}

/** Create a request guard for one detail modal instance. */
/** 中文：为一个详情弹窗实例创建独立的请求序号守卫。 */
export function createLatestRequestGuard(): LatestRequestGuard {
  /** 创建单调递增的请求序号，并提供失效和当前性判断。 */
  let revision = 0
  return {
    // next 为一次加载分配新序号；invalidate 通过递增序号使在途响应失效。
    // 中文：next 分配编号，invalidate 让旧请求失效，isCurrent 只放行最新响应。
    next: () => ++revision,
    invalidate: () => {
      // 中文：递增版本号，使所有已经发出的请求立即变成过期响应。
      revision++
    },
    // 中文：只有编号与当前版本一致的响应才允许写回详情状态。
    isCurrent: requestId => requestId === revision
  }
}
