// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentSkills } from '../src/client/AgentSkills.js'
import { userAgentApi, type UserAgentView } from '../src/client/user-agent-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('cancels inline additions and preserves personal Skill edits after saving fails', async () => {
  const agent: UserAgentView = {
    id: 'b575551f-6614-4e1b-813a-640d881631c8',
    name: 'A',
    description: '',
    prompt: 'A',
    enabled: true,
    revision: 1,
    origin: 'user',
    preset: 'user-agent-a',
    publication: 'ready',
    skills: [{ kind: 'personal', name: 'my-skill', description: 'My instructions', content: 'KEEP_THIS_DRAFT', enabled: true }]
  }
  vi.spyOn(userAgentApi, 'skillCatalog').mockResolvedValue([{ name: 'original-skill', provider: 'suite', description: 'Original instructions' }])
  const save = vi.spyOn(userAgentApi, 'saveSkills').mockRejectedValue(Error('DISK_UNAVAILABLE'))
  const saved = vi.fn()
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const click = async (label: string) =>
    act(async () => {
      const button = [...element.querySelectorAll('button')].find(row => row.textContent === label)
      if (!button) throw Error(`Missing button: ${label}`)
      button.click()
    })
  try {
    await act(async () => root.render(createElement(AgentSkills, { agent, t: key => zh[key], onSaved: saved })))
    await click(zh.agentSkillAdd)
    expect(element.querySelector('select')?.options.length).toBe(2)
    await click(zh.cancel)
    expect(save).not.toHaveBeenCalled()
    expect(element.querySelector('form')).toBeNull()
    await click(zh.agentSkillEdit)
    await act(async () => element.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(element.querySelector('[role=alert]')?.textContent).toContain('DISK_UNAVAILABLE')
    expect(element.querySelector('textarea')?.value).toBe('KEEP_THIS_DRAFT')
    expect(saved).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})
