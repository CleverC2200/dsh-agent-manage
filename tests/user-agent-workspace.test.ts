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
