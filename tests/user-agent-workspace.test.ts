// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { UserAgentWorkspace } from '../src/client/UserAgentWorkspace.js'
import { userAgentApi, type UserAgentView } from '../src/client/user-agent-api.js'
import { en, zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const pluginSource = {
  id: 'trusted-cube',
  preset: 'trusted-cube',
  name: 'Trusted plugin',
  enabled: true,
  publication: 'ready',
  prompt: 'PLUGIN_PROMPT',
  description: '',
  skills: [],
  origin: 'plugin',
  customized: false,
  revision: 1,
  defaultUnavailable: false,
  pluginSource: { sourceRef: 'trusted-cube', version: 'source-1' },
  cube: { sourceRef: 'trusted-cube', enabled: true }
} satisfies UserAgentView
it('opens an inline form, cancels without saving and starts an enabled Agent through the public host action', async () => {
  const saved = {
    id: 'b575551f-6614-4e1b-813a-640d881631c8',
    name: '销售助手',
    description: '个人配置',
    prompt: 'Sales persona<script>alert(1)</script>',
    enabled: true,
    revision: 1,
    origin: 'user' as const,
    preset: 'user-agent-sales',
    publication: 'ready' as const
  }
  vi.spyOn(userAgentApi, 'list').mockResolvedValue([saved])
  vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([])
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
    await act(async () => (element.querySelector('article button') as HTMLButtonElement).click())
    await act(async () => element.querySelector('summary')!.click())
    await click(zh.agentStart)
    expect(startAgent).toHaveBeenCalledExactlyOnceWith(saved.preset)
    expect(element.querySelector('nav')?.textContent).toBe('提示词SkillMCP')
    expect(element.querySelector('textarea')?.value).toBe(saved.prompt)
    expect(element.querySelector('script')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})

it('shows trusted plugin presets with a Cube switch and explicit personal copy', async () => {
  const source = pluginSource
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
  vi.spyOn(userAgentApi, 'cubeSources').mockResolvedValue([])
  vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([source])
  const toggle = vi.spyOn(userAgentApi, 'setPluginEnabled').mockResolvedValue({ ...source, enabled: false, publication: 'disabled' })
  const savePlugin = vi.spyOn(userAgentApi, 'savePlugin').mockResolvedValue({ ...source, prompt: 'CUSTOM_PLUGIN_PROMPT', customized: true })
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
    await act(async () =>
      [...element.querySelectorAll('button')].find(button => button.textContent?.includes('Trusted plugin') && button.textContent !== zh.agentCopyPersonal)!.click()
    )
    expect(element.querySelector('nav')?.textContent).toBe('提示词SkillMCP')
    const prompt = element.querySelector('textarea')!
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(prompt, 'CUSTOM_PLUGIN_PROMPT')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === zh.save)!.click())
    expect(savePlugin).toHaveBeenCalledExactlyOnceWith('trusted-cube', 'CUSTOM_PLUGIN_PROMPT')
    await act(async () => [...element.querySelectorAll('button')].find(button => button.textContent === zh.agentBack)!.click())
    await act(async () => (element.querySelector('article button') as HTMLButtonElement).click())
    await act(async () => element.querySelector('summary')!.click())
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

const enableOutcomes = [
  { name: 'ready in Chinese', copy: zh, initiallyEnabled: false, enabled: true, publication: 'ready', success: true },
  { name: 'ready in English', copy: en, initiallyEnabled: false, enabled: true, publication: 'ready', success: true },
  { name: 'disabled', copy: zh, initiallyEnabled: true, enabled: false, publication: 'disabled', success: false },
  { name: 'disable returned enabled', copy: zh, initiallyEnabled: true, enabled: true, publication: 'ready', success: false },
  { name: 'enable returned disabled', copy: zh, initiallyEnabled: false, enabled: false, publication: 'ready', success: false },
  { name: 'mount failed', copy: zh, initiallyEnabled: false, enabled: true, publication: 'failed', success: false },
  { name: 'request failed', copy: zh, initiallyEnabled: false, enabled: true, publication: 'ready', success: false, error: 'ENABLE_FAILED' }
] satisfies { name: string; copy: typeof zh; initiallyEnabled: boolean; enabled: boolean; publication: UserAgentView['publication']; success: boolean; error?: string }[]

it.each([false, true])('clears plugin enable guidance when refreshing the workspace, including a failed refresh: %s', async failed => {
  const list = vi.spyOn(userAgentApi, 'list').mockResolvedValueOnce([])
  if (failed) list.mockRejectedValueOnce(Error('REFRESH_FAILED'))
  else list.mockResolvedValueOnce([])
  vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([{ ...pluginSource, enabled: false }])
  vi.spyOn(userAgentApi, 'setPluginEnabled').mockResolvedValue(pluginSource)
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  try {
    await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => zh[key] })))
    await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
    expect(element.querySelector('[role="status"]')?.textContent).toBe(zh.agentPluginEnabled)
    await act(async () => element.querySelector<HTMLButtonElement>(`[aria-label="${zh.refresh}"]`)!.click())
    expect(element.querySelector('[role="status"]')).toBeNull()
    expect(element.querySelector('[role="alert"]')?.textContent ?? '').toBe(failed ? 'REFRESH_FAILED' : '')
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})

for (const entry of ['list', 'editor']) {
  it.each(enableOutcomes)(`${entry} shows plugin enable guidance only after a ready enable: $name`, async outcome => {
    const source = { ...pluginSource, enabled: outcome.initiallyEnabled }
    vi.spyOn(userAgentApi, 'list').mockResolvedValue([])
    vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([source])
    const toggle = vi.spyOn(userAgentApi, 'setPluginEnabled')
    if (outcome.error) toggle.mockRejectedValue(Error(outcome.error))
    else toggle.mockResolvedValue({ ...source, enabled: outcome.enabled, publication: outcome.publication })
    const startAgent = vi.fn(async () => {})
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    try {
      await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => outcome.copy[key], startAgent, surface: 'settings' })))
      if (entry === 'editor') await act(async () => element.querySelector<HTMLButtonElement>('article button')!.click())
      await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      expect(toggle).toHaveBeenCalledExactlyOnceWith(source.id, !source.enabled)
      expect(element.querySelector('[role="status"]')?.textContent ?? '').toBe(outcome.success ? outcome.copy.agentPluginEnabled : '')
      if (outcome.error) expect(element.querySelector('[role="alert"]')?.textContent).toBe(outcome.error)
      expect(element.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe(String(outcome.error ? source.enabled : outcome.enabled))
      expect(element.querySelector('h2')?.textContent).toBe(entry === 'editor' ? source.name : outcome.copy.agentConfiguration)
      expect(startAgent).not.toHaveBeenCalled()
    } finally {
      await act(async () => root.unmount())
      element.remove()
      vi.restoreAllMocks()
    }
  })

  it(`${entry} clears previous enable guidance while the next toggle is pending and preserves its failure`, async () => {
    const source = { ...pluginSource, enabled: false, publication: 'disabled' as const }
    vi.spyOn(userAgentApi, 'list').mockResolvedValue([])
    vi.spyOn(userAgentApi, 'pluginAgents').mockResolvedValue([source])
    let rejectToggle!: (error: Error) => void
    const pending = new Promise<UserAgentView>((_, reject) => {
      rejectToggle = reject
    })
    const toggle = vi.spyOn(userAgentApi, 'setPluginEnabled').mockResolvedValueOnce(pluginSource).mockReturnValueOnce(pending)
    const element = document.createElement('div')
    document.body.append(element)
    const root = createRoot(element)
    try {
      await act(async () => root.render(createElement(UserAgentWorkspace, { t: key => zh[key] })))
      if (entry === 'editor') await act(async () => element.querySelector<HTMLButtonElement>('article button')!.click())
      await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      expect(element.querySelector('[role="status"]')?.textContent).toBe(zh.agentPluginEnabled)
      await act(async () => element.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
      expect(toggle).toHaveBeenLastCalledWith(source.id, false)
      expect(element.querySelector('[role="status"]')).toBeNull()
      expect(element.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled).toBe(true)
      await act(async () => rejectToggle(Error('DISABLE_FAILED')))
      expect(element.querySelector('[role="alert"]')?.textContent).toBe('DISABLE_FAILED')
      expect(element.querySelector('[role="status"]')).toBeNull()
    } finally {
      await act(async () => root.unmount())
      element.remove()
      vi.restoreAllMocks()
    }
  })
}
