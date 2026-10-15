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
  const imported = vi.spyOn(agentSourceApi, 'import').mockResolvedValue({
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
    expect(imported).toHaveBeenCalledExactlyOnceWith({ sourceId: 'team', suiteId: 'helper', resourceKey: 'suite' }, expect.any(AbortSignal))
    expect(onImported).toHaveBeenCalledOnce()
    expect(element.querySelector('[role=status]')?.textContent).toBe(zh.agentSourceImported)
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})

it('shows three-way conflicts, cancels without a write and applies an explicit upstream choice', async () => {
  const agent = {
    id: 'imported-agent',
    name: '团队助手',
    description: '',
    prompt: 'local',
    enabled: true,
    revision: 2,
    customized: true,
    origin: 'user' as const,
    preset: 'user-agent-imported',
    publication: 'ready' as const,
    defaultUnavailable: false,
    source: {
      sourceId: 'team',
      suiteId: 'helper',
      resourceKey: 'suite',
      url: '/team',
      kind: 'local' as const,
      base: { name: '团队助手', description: '', prompt: 'base', skills: [] }
    },
    skills: []
  }
  vi.spyOn(agentSourceApi, 'list').mockResolvedValue([
    { id: 'team', url: '/team', kind: 'local', candidates: [{ suiteId: 'helper', resourceKey: 'suite', name: '团队助手', description: '' }], errors: [] }
  ])
  vi.spyOn(agentSourceApi, 'preview').mockResolvedValue({
    token: 'preview-token',
    changed: true,
    agentId: agent.id,
    conflicts: [{ key: 'prompt', base: 'base', local: 'local', upstream: 'upstream' }]
  })
  const cancel = vi.spyOn(agentSourceApi, 'cancel').mockResolvedValue({ cancelled: true })
  const commit = vi.spyOn(agentSourceApi, 'commit').mockResolvedValue({ ...agent, prompt: 'upstream', revision: 3 })
  const onImported = vi.fn(async () => {})
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const click = (label: string) =>
    act(async () => {
      const button = [...element.querySelectorAll('button')].find(row => row.textContent === label)
      if (!button) throw Error(`Missing ${label}`)
      button.click()
    })
  try {
    await act(async () => root.render(createElement(AgentSources, { t: key => zh[key], onImported, agents: [agent], initialSyncId: agent.id })))
    expect(agentSourceApi.preview).toHaveBeenCalledWith(agent.id, expect.any(AbortSignal))
    expect(element.textContent).toContain(zh.agentSourceConflicts)
    expect([...element.querySelectorAll('pre')].map(row => row.textContent)).toEqual(['base', 'local', 'upstream'])
    await click(zh.cancel)
    expect(cancel).toHaveBeenCalledExactlyOnceWith('preview-token')
    expect(commit).not.toHaveBeenCalled()
    await click(zh.agentSourceSync)
    await act(async () => {
      const choice = [...element.querySelectorAll('select')].find(row => row.required)!
      choice.value = 'upstream'
      choice.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(zh.agentSourceApply)
    expect(commit).toHaveBeenCalledWith({ token: 'preview-token', resolutions: { prompt: { choice: 'upstream' } } }, expect.any(AbortSignal))
    expect(onImported).toHaveBeenCalledOnce()
    expect(element.querySelector('[role=status]')?.textContent).toBe(zh.agentSourceUpdated)
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
  }
})
