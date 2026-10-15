/** 文件作用：实现 marketplace、嵌套根和扁平集合扫描策略及条目解析链。 */
/**
 * Scan strategies and the marketplace-entry handler chain.
 *
 * Three filters answer the source scan question, most specific first
 * (classloader-style parent-first delegation):
 *
 * 1. `MarketplaceStrategy` — a Claude Code (`.claude-plugin/`) or Codex
 *    (`.agents/plugins/`) marketplace manifest. Dialects are tried in
 *    precedence order and each must prove productive (≥1 suite) before it
 *    wins, so a shadowed dialect can still carry the scan when the
 *    higher-precedence one yields nothing. Marketplace entries resolve
 *    through a per-entry handler chain: local paths, self-references
 *    (the entry points back at this very source), and remote references
 *    (URL or GitHub `repo` shorthand). Unclaimed entries are diagnosed,
 *    never silently dropped.
 * 2. `RootedStrategy` — nested plugin roots carrying a suite manifest or
 *    skill files, up to four levels deep.
 * 3. `FlatCollectionsStrategy` — the terminal fallback: manifest-less
 *    `<root>/<name>/SKILL.md` collections.
 */
import { readdir, realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { isDirectory, sanitizeId } from './paths.js'
import type { Suite, SuiteComponents, SuiteDimension, SuiteManifest } from '../model/types.js'
import { componentDeclarations, detectManifest, readManifest, readMarketplaces, syntheticManifestName, type MarketplaceEntry } from './manifests.js'
import { countSurfaces, discoverMcp, discoverSkills, listMdFiles } from './surfaces.js'
import { discoverMarkdownResources } from './component-files.js'
import { discoverSuiteHooks, discoverSuiteLsp, discoverSystemPrompt } from './suite-components.js'
import type { ScanChain, ScanContext, ScanFilter, ScanResolution, ScanResult } from './scan-pipeline.js'
import { runScanChain } from './scan-pipeline.js'

export { repoName } from './manifests.js'
export { listMdFiles, discoverLspEntries, type LspEntry } from './surfaces.js'
export type { MarketplaceEntry } from './manifests.js'

const CONTAINER_DIRS = ['plugins', 'external_plugins', 'skills'] as const
const DOT_DIRS = new Set(['.git', '.github', '.claude', '.cursor', '.kimi', '.plugin', '.sources', 'node_modules'])

export interface SuiteHint extends SuiteComponents {
  layout?: import('../model/layouts.js').ManifestKind
  name?: string
  version?: string
  description?: string
  /** Inline `lspServers` declared on the marketplace entry itself (Claude Code). */
  lspServers?: unknown
}

interface SuiteRoot {
  dir?: string
  hint?: SuiteHint
  remoteUrl?: string
}

// ---------------------------------------------------------------------------
// Marketplace entry resolution: a handler chain over entry `source` shapes.
// ---------------------------------------------------------------------------

/** Normalized resolution of one marketplace entry inside its checkout. */
export type EntryResolution = { kind: 'local'; dir: string } | { kind: 'remote'; url: string } | { kind: 'unclaimed'; reason: string } | { kind: 'rejected'; reason: string }

interface EntryContext {
  checkout: string
  entry: MarketplaceEntry
}

interface EntryChain {
  /** 中文：把当前 marketplace 条目交给链上的下一个解析器继续处理。 */
  next(context: EntryContext): EntryResolution | Promise<EntryResolution>
}

/** One handler in the marketplace-entry chain. */
export interface EntryHandler {
  name: string
  /** 中文：尝试解析一个条目；无法处理时通过 chain 继续委托。 */
  handle(context: EntryContext, chain: EntryChain): EntryResolution | Promise<EntryResolution>
}

/**
 * Canonical `https://host/owner/repo` form of a git URL, for equality
 * comparisons between a source's configured URL and an entry's remote.
 */
/** 归一化 Git URL 的协议、尾部斜杠和 .git 后缀，便于 self-reference 比较。 */
export function canonicalGitUrl(url: string): string {
  let value = url.trim()
  // scp-like ssh shorthand: git@github.com:owner/repo(.git)
  // 中文：先把 scp 风格 SSH 地址转为可比较的 HTTPS 形式。
  const scp = /^git@([^:/]+):(.+)$/.exec(value)
  if (scp !== null) value = `https://${scp[1]}/${scp[2]}`
  value = value.replace(/^ssh:\/\//, 'https://').replace(/^git:\/\//, 'https://')
  try {
    const parsed = new URL(value)
    const path = decodeURIComponent(parsed.pathname)
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`
  } catch {
    // Not an absolute URL; normalize the trailing bits only.
    // 中文：非绝对 URL 不推断主机，只做尾部规范化以避免误认远程源。
    return value.replace(/\/+$/, '').replace(/\.git$/, '')
  }
}

/** GitHub shorthand `{ source: 'github', repo: 'owner/repo' }` → web URL. */
/** 从 marketplace entry 的 repo 字段解析 GitHub URL。 */
function githubRepoUrl(record: Record<string, unknown>): string | undefined {
  if (record['source'] !== 'github' && record['source'] !== 'github-release') return undefined
  if (typeof record['repo'] !== 'string' || record['repo'] === '') return undefined
  return `https://github.com/${record['repo']}`
}

/** The remote URL an entry points at, across every dialect's shape. */
/** 提取 entry 的远程 URL 或 GitHub repo shorthand。 */
export function entryRemoteUrl(entry: MarketplaceEntry): string | undefined {
  if (typeof entry.source === 'string') return undefined
  if (entry.source === null || typeof entry.source !== 'object') return undefined
  const record = entry.source as Record<string, unknown>
  if (typeof record['url'] === 'string' && record['url'] !== '') return record['url']
  return githubRepoUrl(record)
}

/** 解析 marketplace entry 的本地相对路径，并确认目标位于 checkout 内。 */
async function claimLocal(checkout: string, declaredPath: string): Promise<EntryResolution> {
  const dir = resolve(checkout, declaredPath)
  // Containment guard: a relative entry must stay inside the checkout.
  // 中文：本地 entry 必须留在 checkout 内，越界 verdict 具有权威性，不能交给后续 handler 改判。
  if (dir !== checkout && !dir.startsWith(`${checkout}/`)) {
    // `rejected`: the handler positively identified a local path, but the
    // path escapes the checkout. Its verdict is authoritative — later
    // handlers must not reinterpret it as something else.
    return { kind: 'rejected', reason: `path "${declaredPath}" escapes the checkout` }
  }
  try {
    const [realCheckout, realDir] = await Promise.all([realpath(checkout), realpath(dir)])
    if (realDir !== realCheckout && !realDir.startsWith(`${realCheckout}/`)) {
      return { kind: 'rejected', reason: `path "${declaredPath}" escapes the checkout through a symlink` }
    }
  } catch {
    return { kind: 'rejected', reason: `path "${declaredPath}" is missing or unreadable` }
  }
  return { kind: 'local', dir }
}

/** 生成未认领 entry 的诊断结果，确保条目不会静默丢失。 */
function unclaimed(reason: string): EntryResolution {
  return { kind: 'unclaimed', reason }
}

/** String source: a checkout-relative path (Claude Code `"./skills/x"` form). */
const STRING_PATH_HANDLER: EntryHandler = {
  name: 'local-string-path',
  /** 本地路径处理器：仅认领存在且未越界的目录。 */
  async handle(context): Promise<EntryResolution> {
    const source = context.entry.source
    if (typeof source !== 'string') return unclaimed('source is not a path string')
    return claimLocal(context.checkout, source)
  }
}

/** Object source with `path`: Codex `{ source: 'local', path }` and Claude `{ path }`. */
const OBJECT_PATH_HANDLER: EntryHandler = {
  name: 'local-object-path',
  /** self-reference 处理器：把指向当前 source 的条目映射到 checkout 根。 */
  async handle(context): Promise<EntryResolution> {
    const source = context.entry.source
    if (source === null || typeof source !== 'object') return unclaimed('source is not an object')
    const record = source as Record<string, unknown>
    if (entryRemoteUrl(context.entry) !== undefined) return unclaimed('path belongs to a remote source')
    if (typeof record['path'] !== 'string' || record['path'] === '') return unclaimed('object source carries no path')
    return claimLocal(context.checkout, record['path'])
  }
}

/** Remote entries: `{ url }` (Claude/Codex) and `{ source: 'github', repo }` shorthand. */
const REMOTE_URL_HANDLER: EntryHandler = {
  name: 'remote-url',
  /** 远程处理器：输出待下载/克隆的远程解析结果。 */
  handle(context): EntryResolution {
    const url = entryRemoteUrl(context.entry)
    if (url === undefined) return unclaimed('source carries no resolvable remote url or repo')
    return { kind: 'remote', url }
  }
}

const ENTRY_HANDLERS: readonly EntryHandler[] = [STRING_PATH_HANDLER, OBJECT_PATH_HANDLER, REMOTE_URL_HANDLER]

/**
 * Resolve one marketplace entry's source against its checkout. Self-
 * references (an entry pointing back at this very source, as Claude Code
 * ships for single-repo marketplaces) resolve to the local checkout so the
 * repo's own manifest and surfaces are scanned directly.
 */
/** 按本地、自引用、远程顺序解析单个 marketplace entry，并保留失败诊断。 */
export async function resolveMarketplaceEntry(checkout: string, entry: MarketplaceEntry, sourceUrl: string | undefined): Promise<EntryResolution> {
  const remoteUrl = entryRemoteUrl(entry)
  if (sourceUrl !== undefined && remoteUrl !== undefined && canonicalGitUrl(remoteUrl) === canonicalGitUrl(sourceUrl) && (await isDirectory(checkout))) {
    const source = entry.source
    return typeof source === 'object' && source !== null && typeof source.path === 'string' ? claimLocal(checkout, source.path) : { kind: 'local', dir: checkout }
  }
  let lastReason = 'no handler claimed the entry'
  for (const handler of ENTRY_HANDLERS) {
    const resolution = await handler.handle({ checkout, entry }, { next: () => unclaimed(lastReason) })
    if (resolution.kind === 'rejected') return resolution
    if (resolution.kind !== 'unclaimed') return resolution
    lastReason = resolution.reason
  }
  return { kind: 'unclaimed', reason: lastReason }
}

// ---------------------------------------------------------------------------
// Marketplace strategy
// ---------------------------------------------------------------------------

/** Read one checkout through marketplace manifests, dialect by dialect. */
export class MarketplaceStrategy implements ScanFilter {
  readonly name = 'marketplace'

  /** 读取 marketplace 方言并逐条解析；有产出才终止策略链。 */
  async doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution> {
    const marketplaces = await readMarketplaces(context.checkout, context.notes)
    for (const marketplace of marketplaces) {
      const roots = await this.marketplaceRoots(context, marketplace.entries)
      if (roots.length === 0) {
        context.notes.push(`marketplace ${marketplace.path}: no entry resolved (all ${marketplace.entries.length} dropped or remote)`)
        continue
      }
      const suites = await Promise.all(
        roots.map(async root =>
          root.dir === undefined ? remoteSuite(context.sourceId, context.dimension, root) : readSuite(root.dir, context.sourceId, context.dimension, root.hint, context.notes)
        )
      )
      const resolved = suites.filter((suite): suite is Suite => suite !== undefined)
      if (resolved.length === 0) {
        context.notes.push(`marketplace ${marketplace.path}: every resolved entry failed to parse a manifest`)
        continue
      }
      // A productive dialect wins; supplement with containers it did not list.
      // 中文：有产出的方言获胜，再补充其未显式列出的容器目录。
      context.marketplacePath = marketplace.path
      for (const container of CONTAINER_DIRS) {
        const containerDir = join(context.checkout, container)
        if (!(await isDirectory(containerDir))) continue
        for (const child of await listChildDirs(containerDir)) {
          if (roots.some(root => root.dir === child) || !(await hasSuiteManifest(child))) continue
          const extra = await readSuite(child, context.sourceId, context.dimension, undefined, context.notes)
          if (extra !== undefined) resolved.push(extra)
        }
      }
      return { kind: 'resolved', suites: resolved }
    }
    if (marketplaces.length > 0) {
      context.notes.push('no marketplace dialect produced suites; falling through to rooted discovery')
    }
    return chain.next(context)
  }

  /** 将已解析 marketplace entries 转换为可读 suite roots，并聚合条目诊断。 */
  private async marketplaceRoots(context: ScanContext, entries: readonly MarketplaceEntry[]): Promise<SuiteRoot[]> {
    const roots: SuiteRoot[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
      const hint: SuiteHint = {
        ...componentDeclarations(entry),
        layout: entry.layout,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        // Claude Code declares LSP servers inline on the marketplace entry
        // (typescript-lsp & co. ship no manifest at all).
        // 中文：Claude marketplace entry 可直接携带 LSP 声明，即使目标目录没有 manifest。
        ...(entry.lspServers !== undefined ? { lspServers: entry.lspServers } : {})
      }
      const resolution = await resolveMarketplaceEntry(context.checkout, entry, context.sourceUrl)
      if (resolution.kind === 'unclaimed' || resolution.kind === 'rejected') {
        context.notes.push(`marketplace entry "${String(entry.name ?? '<unnamed>')}": ${resolution.reason}`)
        continue
      }
      if (resolution.kind === 'remote') {
        const entryName = typeof entry.name === 'string' && entry.name !== '' ? entry.name : resolution.url
        // Dedupe by entry name, not URL: one remote repo can host several
        // plugins that each appear as their own marketplace entry.
        // 中文：按 entry 名去重而非 URL，因为同一远程仓库可承载多个插件。
        if (entryName !== undefined && !seen.has(entryName)) {
          roots.push({ hint, remoteUrl: resolution.url })
          seen.add(entryName)
        }
        continue
      }
      roots.push(...(await collectRoots(resolution.dir, hint, seen)))
    }
    return roots
  }
}

// ---------------------------------------------------------------------------
// Rooted and flat-collection strategies
// ---------------------------------------------------------------------------

/** Read nested plugin roots up to four levels deep. */
export class RootedStrategy implements ScanFilter {
  readonly name = 'rooted'

  /** 深度受限发现嵌套 plugin 根；至少有套件产出才视为命中。 */
  async doScan(context: ScanContext, chain: ScanChain): Promise<ScanResolution> {
    if (await hasSuiteManifest(context.checkout)) {
      const suite = await readSuite(context.checkout, context.sourceId, context.dimension, undefined, context.notes)
      return suite === undefined ? chain.next(context) : { kind: 'resolved', suites: [suite] }
    }
    const found = await collectRoots(context.checkout, undefined, new Set())
    if (found.length === 0) return chain.next(context)
    const suites = await Promise.all(
      found.map(async root =>
        root.dir === undefined ? remoteSuite(context.sourceId, context.dimension, root) : readSuite(root.dir, context.sourceId, context.dimension, root.hint, context.notes)
      )
    )
    const resolved = suites.filter((suite): suite is Suite => suite !== undefined)
    return resolved.length === 0 ? chain.next(context) : { kind: 'resolved', suites: resolved }
  }
}

/** Terminal fallback: manifest-less flat `<child>/SKILL.md` collections. */
export class FlatCollectionsStrategy implements ScanFilter {
  readonly name = 'flat-collections'

  /** 终端策略：把扁平技能集合转换为合成套件，永远返回结果。 */
  async doScan(context: ScanContext): Promise<ScanResolution> {
    // A declared suite has already been evaluated by rooted discovery.
    // Reinterpreting its children would bypass a rejected manifest.
    // 中文：已声明套件由 rooted 策略负责；扁平回退不能绕过被拒绝的 manifest。
    if (await hasSuiteManifest(context.checkout)) return { kind: 'resolved', suites: [] }
    const collection: SuiteRoot[] = []
    for (const child of await listChildDirs(context.checkout)) {
      if (await hasSkillFiles(child)) collection.push({ dir: child })
    }
    if (collection.length === 0) {
      context.notes.push('checkout declares no recognizable plugin shape')
      return { kind: 'resolved', suites: [] }
    }
    const suites = await Promise.all(
      collection.map(async root =>
        root.dir === undefined ? remoteSuite(context.sourceId, context.dimension, root) : readSuite(root.dir, context.sourceId, context.dimension, root.hint, context.notes)
      )
    )
    return { kind: 'resolved', suites: suites.filter((suite): suite is Suite => suite !== undefined) }
  }
}

/** The default chain, most specific first with a terminal fallback. */
/** 返回按 marketplace、rooted、flat 顺序排列的默认扫描策略。 */
export function defaultScanFilters(): readonly ScanFilter[] {
  return [new MarketplaceStrategy(), new RootedStrategy(), new FlatCollectionsStrategy()]
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Discover every suite under one source checkout. */
/** 扫描来源 checkout 并返回规范化套件列表，诊断随结果保留。 */
export async function discoverSuitesInSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension, sourceUrl?: string): Promise<Suite[]> {
  const result = await scanSource(checkoutDir, sourceId, dimension, sourceUrl)
  return result.suites
}

/** Scan one checkout through the filter chain with full diagnostics. */
/** 运行默认扫描链并输出 roots、suites、notes，作为来源级发现入口。 */
export async function scanSource(checkoutDir: string, sourceId: string, dimension: SuiteDimension, sourceUrl?: string): Promise<ScanResult> {
  return runScanChain(defaultScanFilters(), { checkout: checkoutDir, sourceId, dimension, ...(sourceUrl !== undefined ? { sourceUrl } : {}), notes: [] })
}

// ---------------------------------------------------------------------------
// Shared root/manifest plumbing
// ---------------------------------------------------------------------------

/**
 * Collect nested plugin roots up to four levels deep. Sibling subtrees are
 * traversed concurrently (readdir/stat are I/O-bound); results concat in
 * deterministic lexicographic order because each level maps children in
 * order before flattening.
 */
/** 递归收集受深度限制的 suite roots，按真实路径去重。 */
async function collectRoots(dir: string, hint: SuiteHint | undefined, seen: Set<string>, depth = 0): Promise<SuiteRoot[]> {
  if (depth > 4 || seen.has(dir)) return []
  // An entry carrying inline LSP declarations is a suite by declaration alone
  // (official CC lsp plugins ship only a README), but only at the marketplace
  // entry root — never deeper, so containers cannot self-declare.
  // 中文：携带 inline LSP 的 marketplace 根仅凭声明即可成为套件，但容器深层不得自声明。
  if ((await hasSuiteManifest(dir)) || (await hasSkillFiles(dir)) || (hint !== undefined && Object.keys(componentDeclarations(hint)).length > 0 && depth === 0)) {
    seen.add(dir)
    return [{ dir, hint }]
  }
  const children = await listChildDirs(dir)
  const nested = await Promise.all(children.map(child => collectRoots(child, hint, seen, depth + 1)))
  return nested.flat()
}

/** Whether a directory carries any known suite manifest. */
/** 判断目录是否带可识别 manifest。 */
export async function hasSuiteManifest(dir: string): Promise<boolean> {
  return (await detectManifest(dir)) !== undefined
}

/** Whether a directory carries skill files in the flat or bundled shape. */
/** 判断目录是否存在可作为技能表面的 Markdown 文件。 */
export async function hasSkillFiles(dir: string): Promise<boolean> {
  if (await isFile(join(dir, 'SKILL.md'))) return true
  const skillsDir = join(dir, 'skills')
  if (!(await isDirectory(skillsDir))) return false
  if ((await listMdFiles(skillsDir)).length > 0) return true
  for (const child of await listChildDirs(skillsDir)) {
    if (await isFile(join(child, 'SKILL.md'))) return true
  }
  return false
}

/** 列出普通子目录并过滤符号链接，保护扫描边界。 */
async function listChildDirs(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter(entry => entry.isDirectory() && !DOT_DIRS.has(entry.name) && !entry.name.startsWith('.')).map(entry => join(dir, entry.name))
}

/** Read one suite root into the normalized shape, or undefined when no manifest parses. */
/** 读取单个 suite root 的 manifest 和各 surface，单项错误写入 notes 后继续。 */
export async function readSuite(root: string, sourceId: string, dimension: SuiteDimension, hint: SuiteHint | undefined, notes: string[] = []): Promise<Suite | undefined> {
  const errors: string[] = []
  const declaredManifest = await hasSuiteManifest(root)
  let manifest = declaredManifest ? await readManifest(root, errors, hint) : await syntheticManifest(root)
  if (declaredManifest && (manifest === undefined || errors.length > 0)) {
    notes.push(...errors, `suite ${root}: rejected declared manifest`)
    return undefined
  }
  // A declaration-only suite (official CC lsp plugins ship just a README):
  // the marketplace entry's inline lspServers are its manifest.
  if (manifest === undefined && hint !== undefined && Object.keys(componentDeclarations(hint)).length > 0) {
    const name = hint.name ?? syntheticManifestName(root)
    manifest = {
      layout: hint.layout ?? 'claude-code',
      components: componentDeclarations(hint),
      path: '',
      id: sanitizeId(name),
      name,
      ...(hint.version === undefined ? {} : { version: hint.version }),
      ...(hint.description === undefined ? {} : { description: hint.description })
    }
  }
  if (manifest === undefined) return undefined
  let declared = manifest.components?.skills
  if (declared !== undefined && (manifest.layout === 'claude-code' || manifest.layout === 'codex') && (await isDirectory(join(root, 'skills')))) {
    declared = ['skills', ...(Array.isArray(declared) ? declared : [declared])]
  }
  const skills = await discoverSkills(root, errors, declared)
  if (manifest.layout === 'skill-collection' && skills.length === 0) {
    notes.push(...errors)
    return undefined
  }
  const mcp = await discoverMcp(root, errors, manifest)
  // Effective component declarations include marketplace fallbacks and manifest overrides.
  const lsp = await discoverSuiteLsp(root, manifest, errors)
  const hooks = await discoverSuiteHooks(root, manifest, errors)
  const resources = {
    commands: await discoverMarkdownResources(
      root,
      'commands',
      manifest.components?.commands,
      manifest.path,
      errors,
      manifest.layout === 'cursor' ? ['.md', '.mdc', '.markdown', '.txt'] : ['.md']
    ),
    agents: await discoverMarkdownResources(root, 'agents', manifest.components?.agents, manifest.path, errors)
  }
  const systemPrompt = await discoverSystemPrompt(root, manifest, errors)
  const surfaces = await countSurfaces(root, skills, mcp, lsp)
  surfaces.commands = resources.commands.length
  surfaces.agents = resources.agents.length
  surfaces.hooks = Object.values(hooks?.events ?? {}).reduce((count, groups) => count + groups.reduce((sum, group) => sum + group.hooks.length, 0), 0)
  return {
    resources,
    ...(hooks === undefined ? {} : { hooks }),
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    sourceId,
    id: manifest.id,
    root,
    manifest,
    skills,
    ...(mcp === undefined ? {} : { mcp }),
    ...(lsp === undefined ? {} : { lsp }),
    surfaces,
    dimension,
    enabled: false,
    errors
  }
}

/** Metadata-only suite for a marketplace entry whose content is remote. */
/** 为待远程获取的 entry 创建占位套件，不伪装为已扫描成功。 */
function remoteSuite(sourceId: string, dimension: SuiteDimension, root: SuiteRoot): Suite {
  const name = root.hint?.name ?? 'remote-plugin'
  return {
    sourceId,
    id: sanitizeId(name),
    root: '',
    manifest: {
      layout: 'remote',
      path: '',
      id: sanitizeId(name),
      name,
      version: root.hint?.version,
      description: root.hint?.description
    },
    skills: [],
    surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension,
    enabled: false,
    remote: { url: root.remoteUrl ?? '' },
    errors: []
  }
}

/** Manifest-less directories still produce a synthetic suite identity. */
/** 为无 manifest 但有内容的根生成最小合成 manifest。 */
async function syntheticManifest(root: string): Promise<SuiteManifest | undefined> {
  if (!(await hasSkillFiles(root))) return undefined
  const name = syntheticManifestName(root)
  return {
    layout: 'skill-collection',
    path: join(root, 'SKILL.md'),
    id: sanitizeId(name),
    name
  }
}

/** 判断路径是否为普通文件，失败时返回 false。 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
