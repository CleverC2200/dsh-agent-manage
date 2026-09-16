/** 文件作用：提供用户面板 Markdown 条目的目录、解析、读写和删除基础能力。 */
/**
 * Shared persistence primitives for the market's user-authored panels:
 * skills, commands, and agent personas. Each panel owns one directory of
 * Markdown files under the plugin data root, parsed with the same frontmatter
 * rules the catalog uses, so user entries look exactly like suite entries to
 * the runtime mounts.
 * @module runtime/user-store
 */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'

/** Where user panel entries persist: `<userRoot>/user/<kind>/`. */
/** 按数据根和面板类型计算用户条目目录，隔离 skills/commands/agents。 */
export function userEntryDir(dataRoot: string, kind: 'skills' | 'commands' | 'agents'): string {
  return join(dataRoot, 'user', kind)
}

/** `[a-z][a-z0-9_-]*` — the grammar every panel entry name must satisfy. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const USER_ENTRY_NAME = /^[a-z][a-z0-9_-]*$/

/** The enablement frontmatter key shared by skills and commands. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export const DISABLED_KEY = 'disabled'

/** Parse full YAML metadata without flattening arrays, mappings, or multiline strings. */
/** 解析完整 YAML 元数据并保持数组、映射及多行字符串的结构。 */
export function parseFrontmatterRecord(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) {
    if (/^---(?:\r?\n|$)/.test(text)) throw new Error('Invalid frontmatter: missing closing delimiter')
    return {}
  }
  const doc = parseDocument(match[1])
  if (doc.errors.length > 0) throw new Error(`Invalid frontmatter: ${doc.errors[0]!.message}`)
  const value: unknown = doc.toJS({ maxAliasCount: 100 })
  if (value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Frontmatter must be a mapping')
  return value as Record<string, unknown>
}

/** Read one entry; strict runtime snapshots throw on I/O errors other than a vanished file. */
/** 读取并解析单个用户 Markdown 条目；strict 决定坏 frontmatter 是抛错还是跳过。 */
export async function readEntryFile(file: string, fallbackName: string, strict = false): Promise<UserEntryFile | undefined> {
  if (fallbackName !== '' && !USER_ENTRY_NAME.test(fallbackName)) return undefined
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
  let meta: Record<string, unknown>
  try {
    meta = parseFrontmatterRecord(text)
  } catch (error) {
    meta = { disabled: true, validationError: String(error) }
  }
  const parsed = parseSkillFrontmatter(text, fallbackName)
  const name = typeof parsed === 'string' ? fallbackName : typeof parsed.name === 'string' && parsed.name !== '' ? parsed.name : fallbackName
  return {
    fallbackName,
    name,
    file,
    text,
    body: stripFrontmatter(text),
    meta,
    ...(typeof parsed === 'string' ? {} : parsed)
  }
}

/** One parsed Markdown panel entry. */
/** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
export interface UserEntryFile {
  /** The file's base name (the entry identity). */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  fallbackName: string
  /** The frontmatter name when valid, else the fallback. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  name: string
  /** Absolute file path. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  file: string
  /** The raw file text, frontmatter included. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  text: string
  /** The body after frontmatter removal. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  body: string
  /** The shallow frontmatter record (description, hint, disabled, …). */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  meta: Record<string, unknown>
  /** Additional fields when the entry carried valid skill frontmatter. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  whenToUse?: string
  /** The strict-parse description when the frontmatter was valid YAML. */
  /** 中文：该注释补充对应运行时类型或配置契约的业务约束，输入输出以英文原文为准。 */
  description?: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

/** List `.md` entries; strict runtime snapshots propagate I/O errors instead of publishing partial inventories. */
/** 扫描目录内 Markdown 条目并稳定排序，坏文件按 strict 策略处理。 */
export async function listEntryFiles(dir: string, strict = false): Promise<UserEntryFile[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (error) {
    if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
  const found: UserEntryFile[] = []
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue
    const file = join(dir, entry)
    try {
      const info = await stat(file)
      if (!info.isFile()) continue
    } catch (error) {
      if (strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      continue
    }
    const parsed = await readEntryFile(file, entry.slice(0, -3), strict)
    if (parsed !== undefined) found.push(parsed)
  }
  return found
}

/** Write one panel entry; the name becomes `<name>.md`. */
/** 校验名称和 frontmatter 后写入用户条目文件。 */
export async function writeEntryFile(dir: string, name: string, text: string): Promise<void> {
  assertEntryName(name)
  parseFrontmatterRecord(text)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.md`), text, 'utf8')
}

/**
 * Enforce the entry-name grammar at every filesystem choke point. The name
 * is interpolated into `join(dir, name + '.md')`, so an unchecked name with
 * separators or `..` could address any `.md` file (or directory) on disk —
 * read, write, and delete all go through this guard.
 */
/** 拒绝路径穿越和不符合面板约定的条目名称。 */
function assertEntryName(name: string): void {
  if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}" — use lowercase letters, digits, dashes, or underscores, starting with a letter`)
}

/** Delete one panel entry file; missing files resolve silently. */
/** 删除一个已校验名称对应的用户条目文件。 */
export async function deleteEntryFile(dir: string, name: string): Promise<void> {
  assertEntryName(name)
  await rm(join(dir, `${name}.md`), { force: true })
}

/** Whether an entry file with that name already exists. */
/** 检查条目文件是否存在且为普通文件。 */
export async function entryExists(dir: string, name: string): Promise<boolean> {
  if (!USER_ENTRY_NAME.test(name)) return false
  try {
    await stat(join(dir, `${name}.md`))
    return true
  } catch {
    return false
  }
}

/** Serialize a frontmatter block from a shallow record (deterministic key order). */
/** 将元数据稳定序列化为 frontmatter，供编辑回显和文件写入复用。 */
export function serializeFrontmatter(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) return ''
  return `---\n${stringify(meta, { sortMapEntries: true })}---\n`
}
