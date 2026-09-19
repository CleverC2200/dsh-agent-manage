/** 文件作用：解析用户/项目存储根、来源路径和安全 ID，统一目录边界。 */
/**
 * Root path resolution for the two install dimensions.
 *
 * User dimension: `~/.dsh/agent-plugins/` (or `$DSH_HOME/agent-plugins`).
 * Project dimension: `<projectRoot>/.dsh/agent-plugins/`, where the project
 * root is the nearest ancestor containing `.git`.
 *
 * Everything the plugin persists lives under one root per dimension —
 * `.sources/` (checkouts) and `state.json` (install state) alongside `data/`
 * (suite `${PLUGIN_DATA}` directories) and `overrides/` (MCP configuration
 * rewrites) — so no sibling `agent-plugins-data` root exists.
 */
/** 中文：该注释补充对应业务契约、数据边界或实现约束，具体输入输出以英文原文为准。 */
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Source checkouts live under `<dimensionRoot>/.sources/<sourceId>/`. */
/** 中文：该注释补充对应业务契约、数据边界或实现约束，具体输入输出以英文原文为准。 */
export const SOURCES_DIR_NAME = '.sources'

/** Per-suite mutable data directory (the `${PLUGIN_DATA}` placeholder). */
/** 中文：该注释补充对应业务契约、数据边界或实现约束，具体输入输出以英文原文为准。 */
export const DATA_DIR_NAME = 'data'

export const STATE_FILE_NAME = 'state.json'

/** Expand a leading `~/` (or `~\` on Windows) to the home directory; other values pass through. */
/** 展开 `~` 和 `$DSH_HOME`，把用户输入转换为绝对路径候选。 */
export function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Resolve the harness home (`$DSH_HOME` or `~/.dsh`). */
/** 解析宿主 DSH_HOME，缺省使用用户主目录下的 .dsh。 */
export function resolveDshHome(): string {
  return process.env.DSH_HOME === undefined ? join(homedir(), '.dsh') : resolve(process.env.DSH_HOME)
}

/** Resolve the canonical user-dimension root. Legacy overrides are migration inputs only. */
/** 解析用户维度插件根目录，统一来源 checkout、状态和数据路径。 */
export function resolveUserRoot(_configUserRoot?: string): string {
  return join(resolveDshHome(), 'agent-plugins')
}

/**
 * Resolve the suite data root hosting `${PLUGIN_DATA}` directories and the
 * MCP overrides. Defaults under the user root so the whole plugin persists
 * into one directory. Legacy overrides are migration inputs only.
 */
/** 解析插件数据根目录，兼容显式配置并保持用户根边界。 */
export function resolveDataRoot(_configDataRoot?: string, _configUserRoot?: string): string {
  return join(resolveUserRoot(), 'data')
}

/** Resolve a project root from a workspace cwd: nearest ancestor with `.git`. */
/** 向上查找最近包含 .git 的项目根；找不到时返回当前目录。 */
export async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

/** Resolve the project-dimension suite root for a workspace cwd. */
/** 规范化 cwd 后解析项目根，处理相对路径和不存在路径。 */
export async function resolveProjectRoot(cwd: string): Promise<string> {
  return join(await findProjectRoot(cwd), '.dsh', 'agent-plugins')
}

/** Source checkout directory for one source id. */
/** 返回来源 checkout 父目录。 */
export function sourcesDir(dimensionRoot: string): string {
  return join(dimensionRoot, SOURCES_DIR_NAME)
}

/** Source checkout directory for one source id. */
/** 返回指定 sourceId 的 checkout 目录。 */
export function sourceCheckoutDir(dimensionRoot: string, sourceId: string): string {
  return join(sourcesDir(dimensionRoot), sourceId)
}

/** Per-suite data directory for `${PLUGIN_DATA}`. */
/** 返回限定套件的数据目录，并保留 source/suite 命名边界。 */
export function suiteDataDir(dataRoot: string, suiteId: string): string {
  return join(dataRoot, DATA_DIR_NAME, suiteId)
}

/**
 * Suite-qualified key: `${sourceId}/${suiteId}`. Suite ids are unique within a
 * source only (two sources may both ship a suite named "utils"), so every
 * state, override, data-directory, and mount key must be source-scoped — a
 * bare suite id silently collides across sources.
 */
/** 组合来源 ID 与套件 ID，避免不同来源同名套件发生冲突。 */
export function qualifiedSuiteId(sourceId: string, suiteId: string): string {
  return `${sourceId}/${suiteId}`
}

/** Async existence probe that follows symlinks for a final component. */
/** 判断路径是否为目录，不存在或 stat 失败返回 false。 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** Async existence probe for any entry (file, directory, symlink). */
/** 判断任意文件系统路径是否存在。 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** Sanitize a plugin or server id into `[a-z0-9-]` (lowercased). */
/** 将来源/套件标识清洗为安全稳定的目录片段。 */
export function sanitizeId(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/-{2,}/g, '-')
  return cleaned === '' ? 'unnamed' : cleaned
}

/** Archive extensions stripped from a URL basename before id derivation. */
/** 中文：该注释补充对应业务契约、数据边界或实现约束，具体输入输出以英文原文为准。 */
const ARCHIVE_SUFFIX_PATTERN = /\.(zip|tgz|tar\.gz|tar)$/i

/** Strip a trailing `.git` or archive suffix (`plugin-0.1.zip` → `plugin-0-1`). */
/** 去除 git/仓库常见后缀，得到源名称候选。 */
function stripSourceSuffix(base: string): string {
  if (base.endsWith('.git')) base = base.slice(0, -4)
  return base.replace(ARCHIVE_SUFFIX_PATTERN, '')
}

/** Derive a source id from a repository URL or local path: last path segment, `.git` stripped. */
/** 从 URL 推导人类可读 sourceId，并按规则清洗。 */
export function deriveSourceId(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  const base = trimmed.split(/[/\\]/).at(-1) ?? ''
  return sanitizeId(stripSourceSuffix(base))
}

/**
 * Derive candidate source ids from a git URL or local path, most preferred
 * first: the sanitized basename, then an owner-prefixed variant (`owner-repo`)
 * for remote URLs so same-named repositories from different owners
 * (`cloudflare/skills`, `mattpocock/skills`) degrade to readable ids instead
 * of numeric suffixes. Local paths yield the basename only.
 */
/** 生成 sourceId 候选序列，供冲突消解和历史兼容使用。 */
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
