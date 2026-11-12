import { readSkillHeader } from '../catalog/skill-files.js'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDocument, stringify } from 'yaml'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'

export function userEntryDir(dataRoot: string, kind: 'skills' | 'commands' | 'agents'): string {
  return join(dataRoot, 'user', kind)
}

export const USER_ENTRY_NAME = /^[a-z][a-z0-9_-]*$/

export const DISABLED_KEY = 'disabled'

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

export async function readEntryFile(file: string, fallbackName: string, strict = false, metadataOnly = false): Promise<UserEntryFile | undefined> {
  if (fallbackName !== '' && !USER_ENTRY_NAME.test(fallbackName)) return undefined
  let text: string
  try {
    text = metadataOnly ? await readSkillHeader(file) : await readFile(file, 'utf8')
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

export interface UserEntryFile {
  fallbackName: string

  name: string

  file: string

  text: string

  body: string

  meta: Record<string, unknown>

  whenToUse?: string

  description?: string
  invocation?: { modelInvocable: boolean; userInvocable: boolean }
}

export async function listEntryFiles(dir: string, strict = false, metadataOnly = false): Promise<UserEntryFile[]> {
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
    const parsed = await readEntryFile(file, entry.slice(0, -3), strict, metadataOnly)
    if (parsed !== undefined) found.push(parsed)
  }
  return found
}

export async function writeEntryFile(dir: string, name: string, text: string): Promise<void> {
  assertEntryName(name)
  parseFrontmatterRecord(text)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${name}.md`), text, 'utf8')
}

function assertEntryName(name: string): void {
  if (!USER_ENTRY_NAME.test(name)) throw new Error(`invalid entry name "${name}" — use lowercase letters, digits, dashes, or underscores, starting with a letter`)
}

export async function deleteEntryFile(dir: string, name: string): Promise<void> {
  assertEntryName(name)
  await rm(join(dir, `${name}.md`), { force: true })
}

export async function entryExists(dir: string, name: string): Promise<boolean> {
  if (!USER_ENTRY_NAME.test(name)) return false
  try {
    await stat(join(dir, `${name}.md`))
    return true
  } catch {
    return false
  }
}

export function serializeFrontmatter(meta: Record<string, unknown>): string {
  if (Object.keys(meta).length === 0) return ''
  return `---\n${stringify(meta, { sortMapEntries: true })}---\n`
}
