import { readSkillHeader } from './skill-files.js'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseSkillFrontmatter } from './skills-parse.js'
import { isDirectory } from './paths.js'
import { validateMcpJson } from './validate.js'
import { readManifest } from './manifests.js'
import type { LspSuiteConfig, McpServer, McpSuiteConfig, SuiteManifest, SuiteSkill, SuiteSurfaceCounts } from '../model/types.js'
import { componentDocuments, componentPath, firstComponentFile } from './component-files.js'

const DOT_DIRS = new Set(['.git', '.github', '.claude', '.cursor', '.kimi', '.plugin', '.sources', 'node_modules'])

async function declaredSkillDirs(root: string, declared: unknown, errors: string[]): Promise<string[]> {
  const values = Array.isArray(declared) ? declared : [declared]
  const dirs: string[] = []
  for (const value of values) {
    if (typeof value !== 'string' || value === '') {
      if (declared !== undefined) errors.push('skills: paths must be non-empty strings')
      continue
    }
    const cleaned = value.replace(/^\.\//, '')
    const path = await componentPath(root, cleaned, errors)
    if (path !== undefined) dirs.push(path)
  }
  return dirs
}

export async function discoverSkills(root: string, errors: string[], declared?: unknown): Promise<SuiteSkill[]> {
  const skills: SuiteSkill[] = []
  const rootSkill = join(root, 'SKILL.md')
  const rootName = root.split(/[\\/]/).at(-1) ?? 'plugin'
  const rootParsed = await parseOneSkill(rootSkill, root, rootName, errors)
  if (rootParsed !== undefined) skills.push(rootParsed)
  const skillsDirs = await declaredSkillDirs(root, declared, errors)
  if (declared === undefined) {
    const fallback = join(root, 'skills')
    if (await isDirectory(fallback)) skillsDirs.push(fallback)
  }
  const seen = new Set<string>(skills.map(skill => skill.name))

  const pushUnique = (skill: SuiteSkill | undefined): void => {
    if (skill === undefined || seen.has(skill.name)) return
    seen.add(skill.name)
    skills.push(skill)
  }
  for (const skillsDir of skillsDirs) {
    if (await isFile(skillsDir)) {
      pushUnique(await parseOneSkill(skillsDir, dirname(skillsDir), '', errors))
      continue
    }
    for (const name of await listMdFiles(skillsDir)) {
      pushUnique(await parseOneSkill(join(skillsDir, name), skillsDir, name.replace(/\.md$/, ''), errors))
    }

    if (await isFile(join(skillsDir, 'SKILL.md'))) {
      const name = skillsDir.split(/[\\/]/).at(-1) ?? ''
      pushUnique(await parseOneSkill(join(skillsDir, 'SKILL.md'), skillsDir, name, errors))
      continue
    }
    for (const child of await listChildDirs(skillsDir)) {
      const name = child.split(/[\\/]/).at(-1) ?? ''
      pushUnique(await parseOneSkill(join(child, 'SKILL.md'), child, name, errors))
    }

    for (const category of await listChildDirs(skillsDir)) {
      for (const child of await listChildDirs(category)) {
        const name = child.split(/[\\/]/).at(-1) ?? ''
        pushUnique(await parseOneSkill(join(child, 'SKILL.md'), child, name, errors))
      }
    }
  }
  return skills
}

const SKILL_PARSE_CACHE_CAP = 20_000
const skillParseCache = new Map<string, { mtimeMs: number; size: number; verdict: SuiteSkill | string }>()

async function parseOneSkill(file: string, directory: string, fallbackName: string, errors: string[]): Promise<SuiteSkill | undefined> {
  let info: import('node:fs').Stats | undefined
  try {
    info = await stat(file)
  } catch {
    return undefined
  }
  if (!info.isFile()) return undefined
  const stamp = { mtimeMs: info.mtimeMs, size: info.size }
  const cached = skillParseCache.get(file)
  let verdict: SuiteSkill | string
  if (cached !== undefined && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
    verdict = cached.verdict
  } else {
    let text: string
    try {
      text = await readSkillHeader(file)
    } catch (error) {
      errors.push(`skill "${fallbackName}": unreadable SKILL.md (${error instanceof Error ? error.message : String(error)})`)
      return undefined
    }
    const parsed = parseSkillFrontmatter(text, undefined)
    verdict =
      typeof parsed === 'string'
        ? parsed
        : {
            name: parsed.name,
            directory,
            file,
            description: parsed.description,
            ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
            invocation: parsed.invocation
          }
    if (skillParseCache.size >= SKILL_PARSE_CACHE_CAP) skillParseCache.clear()
    skillParseCache.set(file, { ...stamp, verdict })
  }
  if (typeof verdict === 'string') {
    errors.push(`skill "${fallbackName}": ${verdict}`)
    return undefined
  }
  return { ...verdict, directory }
}

export async function discoverMcp(root: string, errors: string[], manifest?: SuiteManifest): Promise<McpSuiteConfig | undefined> {
  const resolved = manifest ?? (await readManifest(root, errors, undefined))
  const layout = resolved?.layout
  const names =
    layout === 'zcode'
      ? ['.mcp.json']
      : layout === 'qoder'
        ? ['.mcp.json', 'mcp.json']
        : layout === 'github-copilot' || layout === 'universal'
          ? ['.mcp.json', '.github/mcp.json', 'mcp.json']
          : layout === 'codex' || layout === 'claude-code'
            ? ['.mcp.json', 'mcp.json']
            : layout === 'cursor'
              ? ['mcp.json']
              : ['mcp.json', '.mcp.json']
  const declared = resolved?.components?.mcpServers
  const fallback = layout === 'kimi' ? undefined : await firstComponentFile(root, names)
  const additive = layout === 'zcode' || layout === 'claude-code'
  const values =
    declared === undefined
      ? fallback === undefined
        ? []
        : [fallback]
      : [...(additive && fallback !== undefined ? [fallback] : []), ...(Array.isArray(declared) ? declared : [declared])]
  if (values.length === 0) return undefined
  const documents = await componentDocuments(root, values, errors)
  if (documents === undefined) return undefined
  const servers: Record<string, McpServer> = Object.create(null) as Record<string, McpServer>
  let schema = ''
  for (const document of documents) {
    const isBareFile = document.path === join(root, 'mcp.json')
    const strict = isBareFile && (layout === 'agent-plugin-v1' || (declared === undefined && layout !== 'cursor' && layout !== 'qoder'))
    const result = await validateMcpJson(root, document.value, { strict })
    errors.push(...result.errors)
    if (result.config === undefined) return undefined
    if (result.config !== undefined) {
      Object.assign(servers, result.config.servers)
      schema = result.config.schema
    }
  }
  return { schema, servers }
}

export async function countSurfaces(root: string, skills: SuiteSkill[], mcp: McpSuiteConfig | undefined, lsp?: LspSuiteConfig): Promise<SuiteSurfaceCounts> {
  let hooks = 0
  for (const relative of [join('hooks', 'hooks.json'), 'hooks.json']) {
    hooks += await countHookEntries(join(root, relative))
  }
  const commands = (await listMdFiles(join(root, 'commands'))).length
  const agents = (await listMdFiles(join(root, 'agents'))).length
  const lspCount = Object.keys(lsp?.servers ?? {}).length + (await discoverLspEntries(root)).length
  return {
    skills: skills.length,
    mcp: mcp === undefined ? 0 : Object.keys(mcp.servers).length,
    hooks,
    commands,
    agents,
    lsp: lspCount
  }
}

export interface LspEntry {
  name: string
  path: string
}

export async function discoverLspEntries(root: string): Promise<LspEntry[]> {
  const entries: LspEntry[] = []
  try {
    for (const entry of await readdir(join(root, '.claude-plugin', 'lsp'))) {
      if (entry.endsWith('.json')) entries.push({ name: entry.slice(0, -5), path: join(root, '.claude-plugin', 'lsp', entry) })
    }
  } catch {}
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/.test(entry.name)) continue
      const lspDir = join(root, entry.name, 'lsp')
      let names: string[]
      try {
        names = await readdir(lspDir)
      } catch {
        continue
      }
      for (const name of names) {
        entries.push({ name, path: join(lspDir, name) })
      }
    }
  } catch {}
  return entries
}

async function countHookEntries(path: string): Promise<number> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return 0
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return 0
    const hooks = (parsed as Record<string, unknown>)['hooks']
    if (typeof hooks !== 'object' || hooks === null) return 0
    return Object.values(hooks as Record<string, unknown>).reduce((total: number, entries: unknown) => total + (Array.isArray(entries) ? entries.length : 0), 0)
  } catch {
    return 0
  }
}

export async function listMdFiles(dir: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  return entries.filter(name => name.endsWith('.md')).sort()
}

async function listChildDirs(dir: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter(entry => entry.isDirectory() && !DOT_DIRS.has(entry.name) && !entry.name.startsWith('.')).map(entry => join(dir, entry.name))
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
