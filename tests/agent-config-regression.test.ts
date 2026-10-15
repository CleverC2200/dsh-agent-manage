// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UserAgentWorkspace } from '../src/client/UserAgentWorkspace.js'
import { userAgentApi, type UserAgentView } from '../src/client/user-agent-api.js'
import { agentSourceApi } from '../src/client/agent-source-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const plugin: UserAgentView = {
  id: 'gea-readonly',
  preset: 'gea-readonly',
  name: '销售计划Agent',
  description: '销售计划配置包',
  prompt: 'SAVED_PROMPT',
  enabled: true,
  publication: 'ready',
  revision: 1,
  origin: 'plugin',
  pluginSource: { sourceRef: 'gea-readonly', version: 'internal-revision' },
  cube: { sourceRef: 'gea-readonly', enabled: true }
}
let element: HTMLDivElement
let root: ReturnType<typeof createRoot>
const click = async (label: string) =>
  act(async () => {
    const button = [...element.querySelectorAll('button')].find(row => row.textContent === label || row.getAttribute('aria-label') === label)
    if (!button) throw Error(`Missing button: ${label}`)
    button.click()
  })
beforeEach(async () => {
  vi.spyOn(userAgentApi, 'list').mockResolvedValue([])
  vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([plugin])
  vi.spyOn(userAgentApi, 'cubeSources').mockResolvedValue([])
  element = document.createElement('div')
  document.body.append(element)
  root = createRoot(element)
  await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => zh[key], startAgent: async () => {} })))
  await act(async () => (element.querySelector('article button') as HTMLButtonElement).click())
})
afterEach(async () => {
  await act(async () => root.unmount())
  element.remove()
  vi.restoreAllMocks()
})
it('cancels an existing prompt edit by returning to the list without writing the draft', async () => {
  const save = vi.spyOn(userAgentApi, 'savePlugin')
  const prompt = element.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(prompt, 'UNSAVED_PROMPT')
    prompt.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click(zh.cancel)
  expect(element.querySelector('nav')).toBeNull()
  expect(save).not.toHaveBeenCalled()
  await act(async () => (element.querySelector('article button') as HTMLButtonElement).click())
  expect(element.querySelector('textarea')?.value).toBe('SAVED_PROMPT')
})
it('renders the fixed Cube as an enabled visible switch with the same styling as Agent enablement', async () => {
  const agentSwitch = element.querySelector('[role="switch"]')!
  await click(zh.agentMcp)
  const switches = element.querySelectorAll('[role="switch"]')
  const cubeSwitch = switches[switches.length - 1]
  expect(cubeSwitch.getAttribute('aria-checked')).toBe('true')
  expect(cubeSwitch.className).toBe(agentSwitch.className)
  expect(cubeSwitch.className).not.toBe('')
  expect(element.textContent).toContain(zh.agentMcpUsed)
  expect(element.textContent).not.toContain(zh.agentPluginMcpFixed)
})

it('closes configuration sources on cancel without reading or importing a source', async () => {
  await click(zh.agentBack)
  vi.spyOn(agentSourceApi, 'list').mockResolvedValue([])
  const acquire = vi.spyOn(agentSourceApi, 'acquire')
  const imported = vi.spyOn(agentSourceApi, 'import')
  await click(zh.agentSources)
  expect(element.querySelector('fieldset')).not.toBeNull()
  await click(zh.cancel)
  expect(element.querySelector('fieldset')).toBeNull()
  expect(element.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false')
  expect(acquire).not.toHaveBeenCalled()
  expect(imported).not.toHaveBeenCalled()
})

it('opens the new Agent form above all Agent rows and focuses its name', async () => {
  await click(zh.agentBack)
  await click(zh.agentAdd)
  const form = element.querySelector('form')!
  const firstRow = element.querySelector('article')!
  expect(form.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expect(document.activeElement).toBe(form.querySelector('input'))
})

it('keeps source revision information in a disclosure instead of cluttering Agent rows', async () => {
  const info = element.querySelector('details details') as HTMLDetailsElement
  expect(info).not.toBeNull()
  await act(async () => info.querySelector('summary')!.click())
  expect(info.open).toBe(true)
  expect(info.textContent).toContain('gea-readonly')
  expect(info.textContent).toContain('internal-revision')
})
it('closes the add form when an imported Agent update opens configuration sources', async () => {
  await click(zh.agentBack)
  const imported = {
    ...plugin,
    id: 'personal-import',
    origin: 'user' as const,
    source: {
      sourceId: 'team',
      suiteId: 'helper',
      resourceKey: 'suite',
      kind: 'local' as const,
      url: '/team',
      base: { name: plugin.name, description: '', prompt: plugin.prompt, skills: [] }
    }
  }
  vi.mocked(userAgentApi.list).mockResolvedValue([imported])
  vi.spyOn(agentSourceApi, 'list').mockResolvedValue([])
  vi.spyOn(agentSourceApi, 'preview').mockResolvedValue({ changed: false, token: 'unchanged-preview', agentId: imported.id, conflicts: [] })
  vi.spyOn(agentSourceApi, 'cancel').mockResolvedValue({ cancelled: true })
  await click(zh.refresh)
  await click(zh.agentAdd)
  await click(zh.agentSourceSync)
  expect(element.querySelectorAll('form')).toHaveLength(1)
  expect(element.querySelector('fieldset')).not.toBeNull()
})
