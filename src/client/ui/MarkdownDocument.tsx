/** 文件作用：把 Markdown 正文和 YAML 元数据分开预览，避免 frontmatter 被当成正文展示。 */
import { createElement as h, type ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '../index.js'
import { frontmatter } from '../features/personas/frontmatter.js'
import css from './detail.module.css'

/** 递归把 YAML 标量、数组和对象转成安全的 React 展示节点，并防止循环引用。 */
function metadataValue(value: unknown, depth = 0, parents = new Set<object>()): ReactNode {
  if (value === null || value === undefined) return h('span', null, 'null')
  if (typeof value !== 'object') return h('span', null, String(value))
  if (parents.has(value)) return h('span', null, '[Circular]')
  const next = new Set(parents).add(value)
  if (depth >= 12) return h('span', null, '[...]')
  if (Array.isArray(value))
    return h(
      'div',
      { className: css.values },
      value.map((item, index) => h('span', { className: css.value, key: index }, metadataValue(item, depth + 1, next)))
    )
  return h(
    'dl',
    { className: css.metadata },
    Object.entries(value).flatMap(([key, item]) => [h('dt', { key: `${key}-key` }, key), h('dd', { key }, metadataValue(item, depth + 1, next))])
  )
}

/** Render YAML metadata separately without exposing frontmatter as Markdown body text. */
/** 中文：元数据单独展示，Markdown 正文只接收去除 frontmatter 后的 body。 */
export function MarkdownDocument({ text, t }: { text: string; t: Translate }): ReactNode {
  /** 解析文档元数据并渲染 Markdown 正文；解析失败时返回可定位的错误提示。 */
  let parsed: ReturnType<typeof frontmatter>
  let metadata: Record<string, unknown> | null
  try {
    parsed = frontmatter(text)
    metadata = parsed.document.toJS({ maxAliasCount: 100 }) as Record<string, unknown> | null
  } catch (error) {
    return h('div', { role: 'alert', className: css.error }, t('personaMetadataInvalid'), ' ', error instanceof Error ? error.message : String(error))
  }
  return h(
    'div',
    { className: css.preview },
    metadata && Object.keys(metadata).length ? h('section', { className: css.section }, h('h3', { className: css.heading }, t('detailMetadata')), metadataValue(metadata)) : null,
    h(MarkdownText, { text: parsed.body, labels: { code: { copyLabel: t('mdCodeCopy'), copiedLabel: t('mdCodeCopied') }, footnotes: t('mdFootnotes') } })
  )
}
