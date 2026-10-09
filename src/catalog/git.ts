/** 文件作用：以无 shell 的方式执行 Git 克隆、同步、查询和删除，并统一诊断。 */
/**
 * Git operations for repository sources: clone, sync, head, remote-url, remove.
 *
 * Every operation runs `git` through `execFile` without a shell, so a source
 * URL or branch can never interpolate into a command string. Failures carry
 * the stderr tail as the message; the manager surfaces them as source errors.
 *
 * Network tuning rides one {@link GitOptions} object: a proxy, `insteadOf`
 * URL rewrites (mirror acceleration), a per-operation timeout, and one
 * automatic retry for network-flaky clones. Low-speed guards
 * (`GIT_HTTP_LOW_SPEED_*`) fail a stalled transfer early instead of burning
 * the whole timeout.
 */
import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const DEFAULT_GIT_TIMEOUT_MS = 120_000

/** Network tuning applied to every remote-touching git invocation. */
export interface GitOptions {
  /** Value for `http.proxy` / `https.proxy` (e.g. `http://127.0.0.1:7890`). */
  proxy?: string
  /** URL-prefix rewrites, git `insteadOf` semantics: `{'https://github.com/': 'https://mirror/https://github.com/'}`. */
  insteadOf?: Record<string, string>
  /** Timeout per git invocation; defaults to 120s. */
  timeoutMs?: number
  /** Retry a failed clone once (network flake); default true. */
  cloneRetry?: boolean
}

interface RunSpec {
  args: string[]
  options: GitOptions
  operation: string
  /** Payload-carrying commands need a larger stdout/stderr buffer. */
  maxBuffer?: number
}

/** 把代理、insteadOf、低速保护等选项转换为 Git 配置参数。 */
function configArgs(options: GitOptions): string[] {
  const args: string[] = []
  if (options.proxy !== undefined && options.proxy !== '') {
    args.push('-c', `http.proxy=${options.proxy}`, '-c', `https.proxy=${options.proxy}`)
  }
  for (const [from, to] of Object.entries(options.insteadOf ?? {})) {
    if (from === '' || to === '') continue
    args.push('-c', `url.${to}.insteadOf=${from}`)
  }
  return args
}

/** 构造带低速阈值的 Git 环境，阻止网络操作无限挂起。 */
function gitEnv(): NodeJS.ProcessEnv {
  // Fail early on a stalled transfer; the timeout then catches the remainder.
  // 中文：低速传输先触发失败，剩余异常再由总超时兜底，避免无限等待。
  return { ...process.env, GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '30' }
}

/** 通过 execFile 无 shell 执行 Git，统一超时、重试和 stderr 诊断。 */
async function runGit({ args, options, operation, maxBuffer }: RunSpec): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  try {
    const { stdout } = await run('git', args, { timeout: timeoutMs, maxBuffer: maxBuffer ?? 10 * 1024 * 1024, env: gitEnv() })
    return stdout
  } catch (error) {
    throw gitError(operation, error)
  }
}

/** Clone a source (depth 1, optional branch) into a not-yet-existing directory. */
/** 克隆来源 checkout，可选分支并应用网络重试和代理配置。 */
export async function gitClone(url: string, branch: string | undefined, dest: string, options: GitOptions = {}): Promise<void> {
  /** 中文：执行一次 Git clone 尝试，返回命令输出并由外层统一处理重试。 */
  const attempt = (): Promise<string> =>
    runGit({
      args: [...configArgs(options), 'clone', '--depth', '1', '--no-tags', ...(branch === undefined ? [] : ['--branch', branch]), '--', url, dest],
      options,
      operation: 'clone'
    })
  const retry = options.cloneRetry !== false
  try {
    await attempt()
  } catch (error) {
    if (!retry) throw error
    // One retry: transient network failures are the dominant clone failure
    // mode; `git clone` cleans its partial target before failing.
    // 中文：只重试一次瞬时网络错误，部分目录由 git 清理后再重新克隆。
    await attempt()
  }
}

/**
 * Shallow-friendly update: fetch depth 1 into FETCH_HEAD and hard-reset.
 * `git pull --ff-only` on shallow clones can refuse with history-divergence
 * errors; fetch+reset is idempotent and always lands on the remote tip. The
 * local checkout is plugin-managed, so discarding working-tree drift is the
 * intended semantics.
 */
/** 拉取并快进/重置来源 checkout，保持扫描目录与远端分支同步。 */
export async function gitSync(dir: string, branch: string | undefined, options: GitOptions = {}): Promise<void> {
  const config = configArgs(options)
  await runGit({ args: [...config, '-C', dir, 'fetch', '--depth', '1', 'origin', branch ?? 'HEAD'], options, operation: 'fetch' })
  await runGit({ args: [...config, '-C', dir, 'reset', '--hard', 'FETCH_HEAD'], options, operation: 'reset' })
}

/** Read the checked-out HEAD commit. */
/** 读取 checkout 当前 commit，作为扫描和缓存证据。 */
export async function gitHead(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

/** Read the checked-out branch name (`HEAD` when detached). */
/** 读取 checkout 当前分支；detached HEAD 返回 Git 原值。 */
export async function gitCurrentBranch(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

/** Read the checkout's `origin` remote URL; throws when the directory is not a git repository. */
/** 读取 origin URL，供源身份和刷新路径判断使用。 */
export async function gitRemoteUrl(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('remote', error)
  }
}

/** Point the checkout's `origin` at a new URL (download-region rerouting). */
/** 更新 checkout 的 origin URL，调用方负责授权和业务状态变更。 */
export async function gitSetRemoteUrl(dir: string, url: string, timeoutMs: number = 30_000): Promise<void> {
  try {
    await run('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { timeout: timeoutMs, env: gitEnv() })
  } catch (error) {
    throw gitError('remote', error)
  }
}

/** Remove a source checkout tree entirely. */
/** 删除来源 checkout 目录，目标由调用方解析为受控路径。 */
export async function gitRemove(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/** 将 Git 异常转换为带操作名和 stderr 尾部的用户可读错误。 */
function gitError(operation: string, error: unknown): Error {
  if (error instanceof Error && 'stderr' in error && typeof (error as { stderr: unknown }).stderr === 'string') {
    const stderr = (error as { stderr: string }).stderr.trim()
    return new Error(`git ${operation} failed: ${stderr.split('\n').at(-1) ?? stderr}`)
  }
  return new Error(`git ${operation} failed: ${error instanceof Error ? error.message : String(error)}`)
}
