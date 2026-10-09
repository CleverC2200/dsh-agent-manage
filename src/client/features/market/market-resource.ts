/** Market overview cache, invalidation, and source-progress resource helpers. */
/** 文件作用：管理市场概览的共享缓存、失效和数据源变更进度轮询，避免多个视图重复请求。 */
import { fetchOverview, fetchSourceProgress, type OverviewData, type SourceProgress } from '../../api.js'

/** UI state emitted while a source mutation is in flight. */
/** 中文：数据源变更期间向编辑弹窗报告当前步骤或错误。 */
export interface SourceProgressState {
  step: string | undefined
  error: string | undefined
}

const EMPTY_OVERVIEW: OverviewData = { sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }

let cachedOverview: OverviewData | undefined
let inflightOverview: Promise<OverviewData> | undefined

/** Load the last overview immediately and revalidate one shared request. */
/** 中文：优先返回缓存快照，同时共享一次重新校验请求。 */
export function loadOverview(): { initial: OverviewData; revalidating: boolean; promise: Promise<OverviewData> } {
  /** 返回可立即渲染的缓存，并共享同一个正在进行的概览请求。 */
  const initial = cachedOverview ?? EMPTY_OVERVIEW
  if (inflightOverview === undefined) {
    inflightOverview = fetchOverview()
      .then(data => {
        cachedOverview = data
        return data
      })
      .finally(() => {
        inflightOverview = undefined
      })
  }
  return { initial, revalidating: cachedOverview === undefined, promise: inflightOverview }
}

/** Invalidate the shared overview after a mutating action. */
/** 中文：新增、删除或修改来源后清空共享概览缓存。 */
export function invalidateOverview(): void {
  /** 清除概览缓存，使下一次加载重新向服务端校验数据源和套件。 */
  cachedOverview = undefined
}

/**
 * Poll source mutation progress until stopped. Poll failures remain silent
 * because the add-source request is authoritative for mutation success.
 */
/** 中文：轮询仅用于展示过程，成功与否以新增来源主请求为准。 */
export function startSourceProgressPolling(
  report: (state: SourceProgressState) => void,
  resolveStep: (step: SourceProgress['step']) => string = step => step
): { stop: () => void } {
  /** 以低频轮询源变更进度，返回可取消的停止句柄。 */
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  /** 拉取一次源变更进度；组件卸载或请求失败时保持轮询安全可停止。 */
  const tick = async (): Promise<void> => {
    // 每一轮先检查停止标记，避免组件卸载后继续上报进度。
    if (stopped) return
    try {
      const progress = await fetchSourceProgress()
      if (!stopped && progress.active) report({ step: resolveStep(progress.step), error: undefined })
    } catch {
      // Transient poll failures are ignored; the add request reports real errors.
      // 中文：进度轮询失败只视为暂态，真正的新增失败仍由主请求返回。
    }
    if (!stopped)
      timer = setTimeout(() => {
        void tick()
      }, 800)
  }
  timer = setTimeout(() => {
    void tick()
  }, 400)
  return {
    stop: () => {
      // 中文：停止后取消后续定时器，并让已返回的进度结果不再上报。
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
