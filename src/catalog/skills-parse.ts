import { parse as parseYaml } from 'yaml'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
}

export function isSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

export function normalizeSkillName(name: string): string | undefined {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? undefined : normalized
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
      case '1':
        return true
      case 'false':
      case 'no':
      case 'off':
      case '0':
        return false
      default:
        return undefined
    }
  }
  return undefined
}

export function parseSkillFrontmatter(text: string, expectedName: string | undefined): ParsedSkillFrontmatter | string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) return 'missing YAML frontmatter'
  let raw: unknown
  try {
    raw = parseYaml(match[1])
  } catch {
    raw = lenientFrontmatter(match[1])
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'frontmatter is not an object'
  const record = raw as Record<string, unknown>
  const rawName = record['name']
  const description = record['description']

  const name = typeof rawName === 'string' && !isSkillName(rawName) ? normalizeSkillName(rawName) : rawName
  if (name === undefined || typeof name !== 'string') return 'frontmatter name is missing or not kebab-case'
  if (expectedName !== undefined && name !== expectedName) return `frontmatter name "${rawName}" does not match skill directory "${expectedName}"`
  if (typeof description !== 'string' || description.trim() === '') return 'frontmatter description is missing or empty'

  const disableModel = parseBoolean(record['disable-model-invocation'])
  if (disableModel === undefined && record['disable-model-invocation'] !== undefined) {
    return 'invalid disable-model-invocation value'
  }
  const userInvocable = parseBoolean(record['user-invocable'])
  if (userInvocable === undefined && record['user-invocable'] !== undefined) {
    return 'invalid user-invocable value'
  }

  const whenToUse = typeof record['whenToUse'] === 'string' ? record['whenToUse'] : undefined
  return {
    name,
    description: description.trim(),
    ...(whenToUse === undefined ? {} : { whenToUse }),
    invocation: {
      modelInvocable: disableModel !== true,
      userInvocable: userInvocable !== false
    }
  }
}

function lenientFrontmatter(body: string): Record<string, unknown> {
  const record: Record<string, unknown> = {}
  for (const line of body.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const key = match[1]!
    if (record[key] === undefined) record[key] = match[2]!.trim()
  }
  return record
}

export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)
  return match === null ? text : text.slice(match[0].length)
}
