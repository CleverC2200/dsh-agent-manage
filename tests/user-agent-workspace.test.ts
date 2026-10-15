// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { UserAgentWorkspace } from '../src/client/UserAgentWorkspace.js'
import { userAgentApi } from '../src/client/user-agent-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('opens an inline form, cancels without saving and starts an enabled Agent through the public host action', async () => {
  const saved = {
    id: 'b575551f-6614-4e1b-813a-640d881631c8',
    name: '销售助手',
    description: '个人配置',
    prompt: 'Sales persona',
    enabled: true,
    revision: 1,
    origin: 'user' as const,
    preset: 'user-agent-sales',
    publication: 'ready' as const
  }
  vi.spyOn(userAgentApi, 'list').mockResolvedValue([saved])
  vi.spyOn(userAgentApi, 'cubeSources').mockResolvedValue([])
  const save = vi.spyOn(userAgentApi, 'save')
  vi.spyOn(userAgentApi, 'select').mockResolvedValue({ preset: saved.preset })
  const startAgent = vi.fn(async () => {})
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => zh[key], startAgent })))
    const click = async (label: string) =>
      act(async () => {
        const button = [...element.querySelectorAll('button')].find(button => button.textContent === label)
        if (!button) throw Error(`Missing button: ${label}`)
        button.click()
      })
    await click(zh.agentAdd)
    expect(element.querySelector('form')).not.toBeNull()
    await click(zh.cancel)
    expect(save).not.toHaveBeenCalled()
    expect(element.querySelector('form')).toBeNull()
    await click(zh.agentStart)
    expect(startAgent).toHaveBeenCalledExactlyOnceWith(saved.preset)
    await act(async () => (element.querySelector('article button') as HTMLButtonElement).click())
    expect(element.querySelector('nav')?.textContent).toBe('提示词SkillMCP')
    expect(element.querySelector('textarea')?.value).toBe('Sales persona')
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})

it('shows trusted plugin presets with a Cube switch and explicit personal copy', async () => {
  const source = { sourceRef: 'trusted-cube', name: 'Trusted plugin', enabled: true, available: true }
  const copied = {
    id: 'a7e2da91-cac0-4093-9b8e-61123a67be90',
    name: 'Trusted plugin',
    description: '',
    prompt: 'COPIED_PROMPT',
    enabled: true,
    revision: 1,
    skills: [],
    origin: 'user' as const,
    preset: 'user-agent-copy',
    publication: 'ready' as const,
    cube: { sourceRef: 'trusted-cube', enabled: true }
  }
  vi.spyOn(userAgentApi, 'list').mockResolvedValue([])
  vi.spyOn(userAgentApi, 'cubeSources').mockResolvedValue([source])
  const toggle = vi.spyOn(userAgentApi, 'setPluginCubeEnabled').mockResolvedValue([{ ...source, enabled: false, available: false }])
  const copy = vi.spyOn(userAgentApi, 'copyPlugin').mockResolvedValue(copied)
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => zh[key], startAgent: async () => {} })))
    expect(element.textContent).toContain(zh.agentPluginPresets)
    const row = element.querySelector('article')!
    expect(row.textContent).toContain('Trusted plugin')
    expect(row.textContent).not.toContain(zh.panelEditTitle)
    expect(row.textContent).not.toContain(zh.agentMcpRemove)
    await act(async () => (row.querySelector('[role="switch"]') as HTMLButtonElement).click())
    expect(toggle).toHaveBeenCalledExactlyOnceWith('trusted-cube', false)
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === zh.agentCopyPersonal)!.click())
    expect(copy).toHaveBeenCalledExactlyOnceWith('trusted-cube')
    expect(element.querySelector('textarea')?.value).toBe('COPIED_PROMPT')
    expect(element.textContent).toContain(zh.agentPersonal)
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})
