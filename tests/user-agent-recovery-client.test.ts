// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentRecovery } from '../src/client/AgentRecovery.js'
import { userAgentApi } from '../src/client/user-agent-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('offers explicit configuration recovery without enabling or rewriting a default', async () => {
  const agent = {
    id: '98ea492c-eed1-46b3-bc10-56dbb3dcb060',
    name: 'Archived',
    description: '',
    prompt: 'original',
    skills: [],
    revision: 1,
    enabled: false,
    deletedAt: '2026-10-15T00:00:00.000Z',
    origin: 'user' as const,
    preset: 'user-agent-archived',
    publication: 'deleted' as const,
    defaultUnavailable: true
  }
  const restored = { ...agent, deletedAt: undefined, publication: 'disabled' as const }
  const restore = vi.spyOn(userAgentApi, 'restore').mockResolvedValue(restored)
  const enabled = vi.spyOn(userAgentApi, 'setEnabled')
  const changed = vi.fn()
  const choose = vi.fn()
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(createElement(AgentRecovery, { agent, t: key => zh[key], onChanged: changed, onChooseAnother: choose })))
    expect(node.textContent).toContain(zh.agentDefaultUnavailable)
    const button = [...node.querySelectorAll('button')].find(row => row.textContent === zh.agentRestore)!
    await act(async () => button.click())
    expect(restore).toHaveBeenCalledExactlyOnceWith(agent.id)
    expect(enabled).not.toHaveBeenCalled()
    expect(changed).toHaveBeenCalledWith(restored)
    await act(async () => [...node.querySelectorAll('button')].find(row => row.textContent === zh.agentChooseAnother)!.click())
    expect(choose).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    node.remove()
    vi.restoreAllMocks()
  }
})
