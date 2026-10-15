/** 文件作用：串联扫描策略链，保证识别、产出和终止策略可解释且不静默丢失。 */
/**
 * Source scan pipeline: a servlet-filter-style strategy chain with
 * classloader-delegation semantics.
 *
 * The chain owns one question — "which suite roots does this checkout
 * declare?" — that several discovery shapes can answer: a marketplace
 * manifest listing entries, nested plugin directories, or a flat collection
 * of skill directories. Each filter either resolves the checkout (short-
 * circuiting the chain) or abstains with a reason, forwarding to the next
 * filter. The last filter is terminal: it always answers, so a checkout
 * never falls off the end silently.
 *
 * Resolution requires *productive* output: a filter that recognizes the
 * layout but yields zero suites is an abstention, not a hit. That is the
 * bug class this pipeline exists to prevent — a parseable marketplace whose
 * entries all fail to resolve used to short-circuit the scan into an empty
 * result with no fallback and no diagnostic.
 *
 * Filter order is parent-first delegation, most specific shape first. Every
 * attempt is recorded on the result, so callers can surface why a source
 * resolved the way it did.
 */
import type { Suite } from '../model/types.js'

/** One filter's work context: the checkout and its identity. */
export interface ScanContext {
  marketplacePath?: string
  /** Absolute path of the source checkout. */
  checkout: string
  /** The configured source id suites will be attributed to. */
  sourceId: string
  /** The dimension being scanned. */
  dimension: 'user' | 'project'
  /** The source's own URL, when known; used by self-reference handling. */
  sourceUrl?: string
  /** Diagnostics accumulated across the chain (append-only). */
  notes: string[]
}

/** Why a filter did not resolve the checkout. */
export type ScanAbstentionReason = string

/** The outcome of one filter (or the whole chain) for one checkout. */
export type ScanResolution = { kind: 'resolved'; suites: Suite[] } | { kind: 'abstain'; reason: ScanAbstentionReason }

/** The rest of the chain beyond the filter that holds it. */
export interface ScanChain {
  /** Hand the checkout to the next filter; terminal when none remain. */
  /** 中文：把当前 checkout 交给下一个扫描策略，并返回解析或放弃结果。 */
  next(context: ScanContext): Promise<ScanResolution>
}

/** One strategy in the source scan chain. */
export interface ScanFilter {
  /** Stable filter name, recorded on every attempt. */
  readonly name: string
  /** Either resolve the checkout or forward to `chain.next`. */
  /** 中文：执行当前扫描策略；命中则产出套件，否则返回可解释的放弃原因。 */
  doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution>
}

/** One recorded chain attempt. */
export interface ScanAttempt {
  filter: string
  outcome: 'resolved' | 'abstain'
  /** Suites produced when resolved; the abstention reason otherwise. */
  detail: string
  /** Suite ids produced, when resolved. */
  suiteIds: string[]
}

/** The full outcome of scanning one checkout. */
export interface ScanResult {
  marketplacePath?: string
  suites: Suite[]
  attempts: ScanAttempt[]
  /** Human-readable diagnostics: dropped entries, broken manifests, fallbacks taken. */
  notes: string[]
}

/** Drive one checkout through the filter chain, recording every attempt. */
/** 按策略顺序运行扫描链；首个有产出的解析结果胜出，末端策略必须回答。 */
export async function runScanChain(filters: readonly ScanFilter[], context: ScanContext): Promise<ScanResult> {
  const attempts: ScanAttempt[] = []
  const notes = context.notes
  /** 中文：按索引递归执行扫描策略，记录每次委托并在末端给出结果。 */
  const run = async (index: number): Promise<ScanResolution> => {
    const filter = filters[index]
    if (filter === undefined) {
      // Terminal: the chain must always answer. A checkout that reaches the
      // end declares nothing this manager understands.
      // 中文：末端必须给出答案；走到末端表示没有可识别布局，不能静默掉出扫描链。
      return { kind: 'resolved', suites: [] }
    }
    /** 中文：判断策略是否真正产出套件；空结果必须继续交给后续策略。 */
    const productive = (resolution: ScanResolution): resolution is { kind: 'resolved'; suites: Suite[] } => resolution.kind === 'resolved' && resolution.suites.length > 0
    // A filter that delegates has no answer of its own: recording its
    // delegation as an abstention keeps the attempt trace complete.
    // 中文：转发策略本身没有最终答案，记录 abstain 才能保留完整尝试链。
    let delegated = false
    const remaining: ScanChain = {
      next: _ctx => {
        delegated = true
        return run(index + 1)
      }
    }
    const resolution = await filter.doScan(context, remaining)
    // A delegated resolution was already recorded by the inner filter that
    // produced it: mark this filter's delegation and pass the answer through.
    // 中文：下游已记录最终结果，当前策略只补 delegation 轨迹并透传结果。
    if (delegated) {
      attempts.push({ filter: filter.name, outcome: 'abstain', detail: 'delegated', suiteIds: [] })
      return resolution
    }
    const hit = productive(resolution)
    attempts.push({
      filter: filter.name,
      outcome: hit ? 'resolved' : 'abstain',
      detail: hit ? `${resolution.suites.length} suite(s)` : resolution.kind === 'abstain' ? resolution.reason : '0 suite(s)',
      suiteIds: hit ? resolution.suites.map(suite => suite.id) : []
    })
    if (!hit) {
      if (resolution.kind === 'abstain') {
        notes.push(`filter "${filter.name}" abstained: ${resolution.reason}`)
      } else {
        notes.push(`filter "${filter.name}" recognized the checkout but produced no suites; falling through`)
      }
      // Recognized but unproductive: later strategies still get their chance.
      // 中文：识别布局但没有产出时视为 abstain，让后续策略继续尝试。
      return run(index + 1)
    }
    return resolution
  }
  const resolution = await run(0)
  return {
    suites: resolution.kind === 'resolved' ? resolution.suites : [],
    attempts,
    notes,
    ...(context.marketplacePath === undefined ? {} : { marketplacePath: context.marketplacePath })
  }
}
