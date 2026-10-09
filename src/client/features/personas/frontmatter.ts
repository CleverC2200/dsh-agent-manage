/** 文件作用：解析并局部更新 persona/agent Markdown 的 YAML frontmatter，保留未知字段、注释和正文。 */
import { isMap, parseDocument } from 'yaml'

/** Parse an editable document without flattening nested YAML or discarding comments. 中文：解析可编辑文档时保留嵌套 YAML 与原有注释。 */
export function frontmatter(text: string) {
  /** 提取 YAML 文档和 Markdown 正文，同时校验 frontmatter 的闭合与映射结构。 */
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (/^(?:\uFEFF)?---\r?\n/.test(text) && match === null) throw new Error('Unclosed YAML frontmatter')
  const document = parseDocument(match?.[1] ?? '')
  if (document.errors.length > 0) throw new Error(document.errors[0]!.message)
  if (document.contents !== null && !isMap(document.contents)) throw new Error('Frontmatter must be a YAML mapping')
  return { document, body: match === null ? text : text.slice(match[0].length), matched: match !== null }
}

/** 将 YAML 元数据规范化为表单字段，兼容 reasoning_effort 的历史别名。 */
export function readRoleFields(text: string): { model: string; provider: string; tools: string; reasoningEffort: string } {
  const { document } = frontmatter(text)
  const fields = (document.toJS() ?? {}) as Record<string, unknown>
  for (const key of ['reasoning_effort', 'reasoningEffort']) {
    if (fields[key] !== undefined && (typeof fields[key] !== 'string' || (fields[key] as string).trim() === '')) throw new Error(`${key} must be a non-empty string`)
  }
  const effort = typeof fields.reasoning_effort === 'string' ? fields.reasoning_effort.trim() : undefined
  const alias = typeof fields.reasoningEffort === 'string' ? fields.reasoningEffort.trim() : undefined
  if (effort !== undefined && alias !== undefined && effort !== alias) throw new Error('reasoning_effort and reasoningEffort conflict')
  return {
    reasoningEffort: effort ?? alias ?? '',
    model: typeof fields.model === 'string' ? fields.model : '',
    provider: typeof fields.provider === 'string' ? fields.provider : '',
    tools: Array.isArray(fields.tools) ? fields.tools.join(', ') : typeof fields.tools === 'string' ? fields.tools : ''
  }
}

/** Store the canonical effort key and remove its alias so execution cannot see conflicting values. */
/** 写入规范的 reasoning_effort 键并删除别名，避免运行时读到冲突配置。 */
export function updateRoleReasoning(text: string, value: string): string {
  const { document, body, matched } = frontmatter(text)
  if (!matched && value === '') return text
  document.delete('reasoningEffort')
  if (value === '') document.delete('reasoning_effort')
  else document.set('reasoning_effort', value)
  return `---\n${document.toString()}---\n${body}`
}

/** Change only the selected key; retain unknown keys, comments, scalar types and Markdown body. */
/** 只更新指定元数据键，保留其余键、注释、标量类型和 Markdown 正文。 */
export function updateFrontmatter(text: string, key: string, value: unknown): string {
  const { document, body, matched } = frontmatter(text)
  if (value === undefined || value === '') {
    if (!matched) return text
    document.delete(key)
  } else {
    document.set(key, value)
  }
  return `---\n${document.toString()}---\n${body}`
}
