// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentSkills } from '../src/client/AgentSkills.js'
import { SkillDirectoryImport } from '../src/client/SkillDirectoryImport.js'
import { userAgentApi, type UserAgentView } from '../src/client/user-agent-api.js'
import { zh } from '../src/client/locales.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('keeps a folder choice on cancellation, surfaces picker failures, and invalidates candidates on a new choice', async () => {
  const pick = vi.fn().mockResolvedValueOnce('/first').mockResolvedValueOnce(null).mockRejectedValueOnce(Error('Chooser failed')).mockResolvedValueOnce('/second')
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick })
  const fetch = vi.fn().mockResolvedValue(Response.json({ token: 'selection', candidates: [{ name: 'first', path: '.', description: 'First' }], errors: [] }))
  vi.stubGlobal('fetch', fetch)
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const agent: UserAgentView = { id: 'a', name: 'A', description: '', prompt: '', enabled: true, revision: 1, origin: 'user', preset: 'a', publication: 'ready', skills: [] }
  const click = async (label: string) =>
    act(async () => {
      const button = [...element.querySelectorAll('button')].find(row => row.textContent === label)
      if (!button) throw Error(label)
      button.click()
    })
  try {
    await act(async () => root.render(createElement(SkillDirectoryImport, { agent, kind: 'local', t: key => zh[key], onSaved: vi.fn(), onClose: vi.fn() })))
    await click(zh.agentSkillPickFolder)
    await click(zh.agentSkillAcquire)
    expect(element.querySelector('select')).not.toBeNull()
    await click(zh.agentSkillPickFolder)
    expect(element.textContent).toContain('/first')
    expect(element.querySelector('select')).not.toBeNull()
    await click(zh.agentSkillPickFolder)
    expect(element.querySelector('[role=alert]')?.textContent).toBe('Chooser failed')
    await click(zh.agentSkillPickFolder)
    expect(element.textContent).toContain('/second')
    expect(element.querySelector('select')).toBeNull()
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
  }
})
it('opens the ZIP chooser from its named button and acquires the selected file bytes', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ token: 'zip-selection', candidates: [], errors: [] }))
  vi.stubGlobal('fetch', fetch)
  const element = document.createElement('div')
  document.body.append(element)
  const root = createRoot(element)
  const agent: UserAgentView = { id: 'a', name: 'A', description: '', prompt: '', enabled: true, revision: 1, origin: 'user', preset: 'a', publication: 'ready', skills: [] }
  try {
    await act(async () => root.render(createElement(SkillDirectoryImport, { agent, kind: 'zip', t: key => zh[key], onSaved: vi.fn(), onClose: vi.fn() })))
    const input = element.querySelector<HTMLInputElement>('input[type=file]')!
    expect(input.hidden).toBe(true)
    const open = vi.spyOn(input, 'click')
    await act(async () => [...element.querySelectorAll('button')].find(row => row.textContent === zh.agentSkillPickZip)!.click())
    expect(open).toHaveBeenCalledOnce()
    Object.defineProperty(input, 'files', { value: [new File(['zip-bytes'], '验收.zip', { type: 'application/zip' })] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(element.textContent).toContain('验收.zip')
    await act(async () => {
      ;[...element.querySelectorAll('button')].find(row => row.textContent === zh.agentSkillAcquire)!.click()
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    })
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({ kind: 'zip', data: btoa('zip-bytes') })
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
it('previews Git file conflicts and commits the user’s explicit local choice', async () => {
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
    skills: [{ kind: 'personal', name: 'git-skill', description: 'Git', content: 'BODY', enabled: true }]
  }
  const view = {
    directoryId: 'directory-distinct-from-agent',
    name: 'git-skill',
    cwd: '/owned/workcopy',
    entry: '.',
    revision: 0,
    source: { kind: 'git', url: 'file:///fixture/repo', commit: 'a'.repeat(40) },
    files: [{ path: 'SKILL.md', size: 20, binary: false, executable: false }],
    changes: []
  }
  let committed: unknown
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path.endsWith('/catalog')) return Response.json([])
    if (path.endsWith('/open')) return Response.json(view)
    if (path.endsWith('/read')) return Response.json({ path: 'SKILL.md', data: 'BODY', encoding: 'utf8', fileVersion: 'a'.repeat(64) })
    if (path.endsWith('/source-preview')) {
      expect(JSON.parse(String(init?.body))).toEqual({ id: agent.id, name: 'git-skill' })
      return Response.json({
        token: 'preview',
        id: agent.id,
        name: 'git-skill',
        changed: true,
        commit: 'b'.repeat(40),
        conflicts: [{ key: 'file:SKILL.md', base: 'BASE', local: 'LOCAL', upstream: 'UPSTREAM' }]
      })
    }
    if (path.endsWith('/source-commit')) {
      committed = JSON.parse(String(init?.body))
      return Response.json({ ...view, revision: 1 })
    }
    if (path.endsWith('/source-cancel')) return Response.json(null)
    if (path.endsWith('/agents')) return Response.json([agent])
    throw Error(`Unexpected request ${path}`)
  })
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
    await act(async () => root.render(createElement(AgentSkills, { agent, t: key => zh[key], onSaved: vi.fn() })))
    await click(zh.agentSkillEdit)
    await click('检查 Skill 来源更新')
    expect(element.textContent).toContain('LOCAL')
    expect(element.textContent).toContain('UPSTREAM')
    const select = element.querySelector('select')!
    await act(async () => {
      select.value = 'local'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click('应用来源更新')
    expect(committed).toEqual({ token: 'preview', resolutions: { 'file:SKILL.md': { choice: 'local' } } })
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
  }
})
it('imports only the chosen folder Skill and requires an explicit duplicate replacement', async () => {
  const pick = vi.fn().mockResolvedValue('/owned/input')
  vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick })
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
    skills: [{ kind: 'personal', name: 'duplicate-skill', description: 'Existing', content: 'Keep', enabled: true }]
  }
  const requests: Array<{ path: string; value: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const value = init?.body ? JSON.parse(String(init.body)) : {}
    requests.push({ path, value })
    if (path.endsWith('/catalog')) return Response.json([])
    if (path.endsWith('/acquire'))
      return Response.json({
        token: 'selection',
        candidates: [
          { name: 'duplicate-skill', path: 'one', description: 'First' },
          { name: 'second-skill', path: 'two', description: 'Second' }
        ],
        errors: []
      })
    if (path.endsWith('/import')) return Response.json(agent)
    if (path.endsWith('/cancel')) return Response.json(null)
    throw Error(`Unexpected request ${path}`)
  })
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
    await act(async () => root.render(createElement(AgentSkills, { agent, t: key => zh[key], onSaved: vi.fn() })))
    await click(zh.agentSkillAdd)
    await click('从文件夹导入')
    expect(element.querySelector('input[name=folderPath]')).toBeNull()
    await click(zh.agentSkillPickFolder)
    expect(pick).toHaveBeenCalledOnce()
    expect(element.textContent).toContain('/owned/input')
    await click('读取可导入 Skill')
    expect(requests.find(row => row.path.endsWith('/acquire'))?.value).toEqual({ kind: 'local', path: '/owned/input' })
    expect(requests.some(row => row.path.endsWith('/import'))).toBe(false)
    expect([...element.querySelectorAll('button')].find(row => row.textContent === '导入所选 Skill')?.disabled).toBe(true)
    await act(async () => element.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
    await click('导入所选 Skill')
    expect(requests.find(row => row.path.endsWith('/import'))?.value).toEqual({ id: agent.id, token: 'selection', path: 'one', replace: true })
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
  }
})
it('edits an attached file through the Skill tab and applies it through the shared HTTP actions', async () => {
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
    skills: [{ kind: 'personal', name: 'manual-skill', description: 'Manual editing', content: 'Read references/data.txt', enabled: true }]
  }
  const view = {
    id: agent.id,
    name: 'manual-skill',
    cwd: '/owned/workcopy',
    entry: '.',
    revision: 0,
    files: [
      { path: 'SKILL.md', size: 100, binary: false, executable: false },
      { path: 'references/data.txt', size: 13, binary: false, executable: false }
    ],
    changes: []
  }
  let written = false
  let applied = false
  let external = ''
  const requests: Array<{ path: string; value: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const value = init?.body ? JSON.parse(String(init.body)) : {}
    requests.push({ path, value })
    if (path.endsWith('/catalog')) return Response.json([])
    if (path.endsWith('/open')) return Response.json(view)
    if (path.endsWith('/read'))
      return Response.json({
        path: value.path,
        data: value.path === 'SKILL.md' ? 'Read references/data.txt' : external || (written ? 'MANUAL_REFERENCE' : 'BEFORE_MANUAL'),
        encoding: 'utf8',
        fileVersion: written ? 'b'.repeat(64) : 'a'.repeat(64)
      })
    if (path.endsWith('/write')) {
      written = true
      return Response.json({ ...view, revision: 1, changes: [{ path: 'references/data.txt', kind: 'modified' }] })
    }
    if (path.endsWith('/apply')) {
      applied = true
      return Response.json({ ...view, revision: 2 })
    }
    if (path.endsWith('/agents')) return Response.json([agent])
    throw Error(`Unexpected request ${path}`)
  })
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
    await act(async () => root.render(createElement(AgentSkills, { agent, t: key => zh[key], onSaved: vi.fn() })))
    await click(zh.agentSkillEdit)
    await click('references/data.txt')
    const textarea = element.querySelector('textarea')!
    expect(textarea.value).toBe('BEFORE_MANUAL')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'MANUAL_REFERENCE')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('写入文件')
    expect(element.textContent).toContain('有未应用修改')
    expect(applied).toBe(false)
    await click('应用修改')
    expect(applied).toBe(true)
    external = 'AGENT_REFERENCE'
    await click('刷新变更')
    expect(textarea.value).toBe('AGENT_REFERENCE')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'KEEP_LOCAL_DRAFT')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    external = 'LATER_AGENT_REFERENCE'
    await click('刷新变更')
    expect(textarea.value).toBe('KEEP_LOCAL_DRAFT')
    expect(requests.find(row => row.path.endsWith('/write'))?.value).toMatchObject({
      path: 'references/data.txt',
      data: 'MANUAL_REFERENCE',
      encoding: 'utf8',
      fileVersion: 'a'.repeat(64),
      revision: 0
    })
    expect(requests.find(row => row.path.endsWith('/apply'))?.value).toEqual({ id: agent.id, name: 'manual-skill', revision: 1 })
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.unstubAllGlobals()
  }
})
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
  vi.stubGlobal('fetch', async (path: string) => {
    if (path.endsWith('/open'))
      return Response.json({
        id: agent.id,
        name: 'my-skill',
        cwd: '/owned/workcopy',
        entry: '.',
        revision: 0,
        files: [{ path: 'SKILL.md', size: 20, binary: false, executable: false }],
        changes: []
      })
    if (path.endsWith('/read')) return Response.json({ path: 'SKILL.md', data: 'KEEP_THIS_DRAFT', encoding: 'utf8', fileVersion: 'a'.repeat(64) })
    if (path.endsWith('/write')) return Response.json({ error: 'DISK_UNAVAILABLE' }, { status: 400 })
    throw Error(`Unexpected request ${path}`)
  })
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
    await act(async () => {
      const textarea = element.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'KEEP_THIS_DRAFT_UPDATED')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(zh.agentSkillWriteFile)
    expect(element.querySelector('[role=alert]')?.textContent).toContain('DISK_UNAVAILABLE')
    expect(element.querySelector('textarea')?.value).toBe('KEEP_THIS_DRAFT_UPDATED')
    expect(saved).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    element.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
