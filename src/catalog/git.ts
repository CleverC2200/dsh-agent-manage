import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

export const DEFAULT_GIT_TIMEOUT_MS = 120_000

export interface GitOptions {
  proxy?: string

  insteadOf?: Record<string, string>

  timeoutMs?: number

  cloneRetry?: boolean
}

interface RunSpec {
  args: string[]
  options: GitOptions
  operation: string

  maxBuffer?: number
}

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

function gitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_HTTP_LOW_SPEED_LIMIT: '1000', GIT_HTTP_LOW_SPEED_TIME: '30' }
}

async function runGit({ args, options, operation, maxBuffer }: RunSpec): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS
  try {
    const { stdout } = await run('git', args, { timeout: timeoutMs, maxBuffer: maxBuffer ?? 10 * 1024 * 1024, env: gitEnv() })
    return stdout
  } catch (error) {
    throw gitError(operation, error)
  }
}

export async function gitClone(url: string, branch: string | undefined, dest: string, options: GitOptions = {}): Promise<void> {
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

    await attempt()
  }
}

export async function gitSync(dir: string, branch: string | undefined, options: GitOptions = {}): Promise<void> {
  const config = configArgs(options)
  await runGit({ args: [...config, '-C', dir, 'fetch', '--depth', '1', 'origin', branch ?? 'HEAD'], options, operation: 'fetch' })
  await runGit({ args: [...config, '-C', dir, 'reset', '--hard', 'FETCH_HEAD'], options, operation: 'reset' })
}

export async function gitHead(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

export async function gitCurrentBranch(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('rev-parse', error)
  }
}

export async function gitRemoteUrl(dir: string, timeoutMs: number = 30_000): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', dir, 'remote', 'get-url', 'origin'], { timeout: timeoutMs, env: gitEnv() })
    return stdout.trim()
  } catch (error) {
    throw gitError('remote', error)
  }
}

export async function gitSetRemoteUrl(dir: string, url: string, timeoutMs: number = 30_000): Promise<void> {
  try {
    await run('git', ['-C', dir, 'remote', 'set-url', 'origin', url], { timeout: timeoutMs, env: gitEnv() })
  } catch (error) {
    throw gitError('remote', error)
  }
}

export async function gitRemove(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

function gitError(operation: string, error: unknown): Error {
  if (error instanceof Error && 'stderr' in error && typeof (error as { stderr: unknown }).stderr === 'string') {
    const stderr = (error as { stderr: string }).stderr.trim()
    return new Error(`git ${operation} failed: ${stderr.split('\n').at(-1) ?? stderr}`)
  }
  return new Error(`git ${operation} failed: ${error instanceof Error ? error.message : String(error)}`)
}
