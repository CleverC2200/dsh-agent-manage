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
// Keep the current generation result after settlement so obsolete callers also observe its failure.
// 中文：保留当前代已完成的结果，让旧调用者也能观察当前失败，不隐式重试。
let generationOverview: Promise<OverviewData> | undefined

/** Read cached UI state without starting I/O during render. */
/** 中文：只读缓存快照，渲染阶段不发起请求。 */
export function readOverview(): { initial: OverviewData; revalidating: boolean } {
  return { initial: cachedOverview ?? EMPTY_OVERVIEW, revalidating: cachedOverview === undefined }
}

let generation = 0

/** Share one request per generation; obsolete callers follow the latest request. */
/** 中文：每代共享一次请求，失效前的调用者等待最新结果。 */
export function loadOverview(): { initial: OverviewData; revalidating: boolean; promise: Promise<OverviewData> } {
  if (inflightOverview === undefined) {
    const requestGeneration = generation
    const request = fetchOverview()
      .then(
        data => {
          if (requestGeneration !== generation) return generationOverview ?? loadOverview().promise
          cachedOverview = data
          return data
        },
        error => {
          if (requestGeneration !== generation) return generationOverview ?? loadOverview().promise
          throw error
        }
      )
      .finally(() => {
        if (inflightOverview === request) inflightOverview = undefined
      })
    inflightOverview = request
    generationOverview = request
  }
  return { ...readOverview(), promise: inflightOverview }
}

/** Invalidate both the cache and ownership of an older in-flight request. */
/** 中文：同时失效缓存和旧请求的结果归属。 */
export function invalidateOverview(): void {
  generation++
  cachedOverview = undefined
  inflightOverview = undefined
  generationOverview = undefined
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
