// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentSources } from '../src/client/AgentSources.js'
import { agentSourceApi } from '../src/client/agent-source-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('cancels a source form without acquiring or importing and refreshes the Agent list after explicit import', async () => {
  vi.spyOn(agentSourceApi, 'list').mockResolvedValue([
    { id: 'team', url: '/team', kind: 'local', candidates: [{ suiteId: 'helper', resourceKey: 'suite', name: '团队助手', description: '可定制配置' }], errors: [] }
  ])
  const acquire = vi.spyOn(agentSourceApi, 'acquire')
  const imported = vi
    .spyOn(agentSourceApi, 'import')
    .mockResolvedValue({
      id: 'agent',
      name: '团队助手',
      description: '',
      prompt: 'help',
      enabled: true,
      revision: 1,
      customized: false,
      origin: 'user',
      preset: 'user-agent-team',
      publication: 'ready'
    })
  const onImported = vi.fn(async () => {})
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const click = async (label: string) =>
    act(async () => {
      const button = [...element.querySelectorAll('button')].find(value => value.textContent === label)
      if (!button) throw Error(`Missing ${label}`)
      button.click()
    })
  try {
    await act(async () => root.render(createElement(AgentSources, { t: key => zh[key], onImported })))
    await click(zh.cancel)
    expect(acquire).not.toHaveBeenCalled()
    expect(imported).not.toHaveBeenCalled()
    await click(zh.agentSourceImport)
    expect(imported).toHaveBeenCalledExactlyOnceWith({ sourceId: 'team', suiteId: 'helper', resourceKey: 'suite' })
    expect(onImported).toHaveBeenCalledOnce()
    expect(element.querySelector('[role=status]')?.textContent).toBe(zh.agentSourceImported)
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})
