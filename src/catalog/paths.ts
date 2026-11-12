import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const SOURCES_DIR_NAME = '.sources'

export const DATA_DIR_NAME = 'data'

export const STATE_FILE_NAME = 'state.json'

export function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

export function resolveDshHome(): string {
  return process.env.DSH_HOME === undefined ? join(homedir(), '.dsh') : resolve(process.env.DSH_HOME)
}

export function resolveUserRoot(): string {
  return join(resolveDshHome(), 'agent-plugins')
}

export function resolveDataRoot(): string {
  return join(resolveUserRoot(), 'data')
}

export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

export async function resolveProjectRoot(cwd: string): Promise<string> {
  return join(await findProjectRoot(cwd), '.dsh', 'agent-plugins')
}

export function sourcesDir(dimensionRoot: string): string {
  return join(dimensionRoot, SOURCES_DIR_NAME)
}

export function sourceCheckoutDir(dimensionRoot: string, sourceId: string): string {
  return join(sourcesDir(dimensionRoot), sourceId)
}

export function suiteDataDir(dataRoot: string, suiteId: string): string {
  return join(dataRoot, DATA_DIR_NAME, suiteId)
}

export function qualifiedSuiteId(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export function sanitizeId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/-{2,}/g, '-')
  return cleaned === '' ? 'unnamed' : cleaned
}

const ARCHIVE_SUFFIX_PATTERN = /\.(zip|tgz|tar\.gz|tar)$/i

function stripSourceSuffix(base: string): string {
  if (base.endsWith('.git')) base = base.slice(0, -4)
  return base.replace(ARCHIVE_SUFFIX_PATTERN, '')
}

export function deriveSourceId(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const base = trimmed.split(/[/\\]/).at(-1) ?? ''
  return sanitizeId(stripSourceSuffix(base))
}

export function deriveSourceIdCandidates(url: string): string[] {
  const trimmed = url.trim().replace(/\/+$/, '')
  const base = stripSourceSuffix(trimmed.split(/[/\\]/).at(-1) ?? '')
  const primary = sanitizeId(base)
  const isRemote = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || /^[\w.-]+@[\w.-]+:/.test(trimmed)
  const candidates = [primary]
  if (isRemote) {
    const hostPath = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[\w.-]+@([\w.-]+):/, '$1/')
    const segments = hostPath.split(/[/\\]/).filter(Boolean)
    if (segments.length >= 2) {
      const owner = sanitizeId(segments[segments.length - 2]!)
      if (owner !== '' && owner !== primary) candidates.push(`${owner}-${primary}`)
    }
  }
  return [...new Set(candidates)]
}
