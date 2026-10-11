// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'

describe('MarkdownText renders the existing frozen real-layout skill corpus', () => {
  it('does not throw on any SKILL.md', () => {
    const files = ['agent-plugins', 'codex', 'cursor'].flatMap(name => {
      const corpus = JSON.parse(readFileSync(join(process.cwd(), `tests/fixtures/real-layouts/${name}.json`), 'utf8'))
      return Object.entries(corpus.files)
        .filter(([file]) => file.endsWith('SKILL.md'))
        .map(([file, text]) => ({ file: `${name}/${file}`, text: text as string }))
    })
    expect(files.length).toBeGreaterThan(0)
    const crashed: string[] = []
    for (const { file, text } of files) {
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      try {
        act(() => {
          root.render(h(MarkdownText, { text, labels: { code: { copyLabel: 'Copy', copiedLabel: 'Copied' }, footnotes: 'Footnotes' } }))
        })
        act(() => {
          root.unmount()
        })
      } catch {
        crashed.push(file)
      } finally {
        container.remove()
      }
    }
    expect(crashed, `crashed files: ${crashed.join(', ')}`).toEqual([])
  })
})
