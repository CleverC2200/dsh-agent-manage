/** 文件作用：解析 SKILL.md frontmatter，统一技能名称、描述和调用策略。 */
/**
 * SKILL.md frontmatter parsing shared by suite discovery (summaries) and the
 * skill provider (full definitions).
 *
 * Parses the open YAML object dsh-skill documents: required `name` and
 * `description`, optional `whenToUse`, and the two invocation controls
 * (`disable-model-invocation`, `user-invocable`) with the same boolean forms
 * and fail-closed behavior as the shipped filesystem provider.
 */
import { parse as parseYaml } from 'yaml'
import type { SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  whenToUse?: string
  invocation: SkillInvocationPolicy
}

/** Kebab-case skill names only, matching the shipped provider's rule. */
/** 判断技能名是否满足宿主可寻址的基础命名约束。 */
export function isSkillName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

/**
 * Normalize a display-style skill name into kebab-case (e.g. "Presentations"
 * → "presentations"), or `undefined` when nothing usable remains.
 */
/** 清洗并校验技能名，非法或清洗为空时返回 undefined。 */
export function normalizeSkillName(name: string): string | undefined {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized === '' ? undefined : normalized
}

/** 将 YAML 布尔、字符串和数字形式收窄为可选 boolean。 */
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

/**
 * Parse skill frontmatter with the shipped provider's fail-closed semantics.
 * @returns the parsed frontmatter, or a rejection string explaining why the
 *   skill must be dropped from discovery.
 */
/** 解析 SKILL.md frontmatter，校验必填字段和调用策略；错误返回诊断文本。 */
export function parseSkillFrontmatter(text: string, expectedName: string | undefined): ParsedSkillFrontmatter | string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null) return 'missing YAML frontmatter'
  let raw: unknown
  try {
    raw = parseYaml(match[1])
  } catch {
    // Claude Code-authored frontmatter sometimes carries unquoted `: `
    // sequences in prose fields, which strict YAML rejects. A lenient
    // line-based fallback recovers the standard fields first-occurrence
    // wins; values that still fail the field checks below drop the skill.
    // 中文：先用宽松逐行回退恢复标准字段；仍不满足字段约束的技能最终失败关闭。
    raw = lenientFrontmatter(match[1])
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'frontmatter is not an object'
  const record = raw as Record<string, unknown>
  const rawName = record['name']
  const description = record['description']
  // Codex plugins ship display names in `name` (e.g. "Presentations"); the
  // skill identity is its kebab form, so normalize instead of dropping.
  // 中文：Codex 的展示名可含大写和空格，统一转为 kebab 名而不是直接丢弃。
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

/** Lenient frontmatter recovery for prose fields with embedded `: `. */
/** 对缺失 frontmatter 的兼容读取，仅用于生成摘要，不替代严格校验。 */
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

/** Strip the frontmatter block, returning the instruction body. */
/** 去除 frontmatter，返回技能正文供运行时执行和展示。 */
export function stripFrontmatter(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text)
  return match === null ? text : text.slice(match[0].length)
}
