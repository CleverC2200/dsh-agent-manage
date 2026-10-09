// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginWorkspace } from '../src/client/PluginWorkspace.js'
import { UserPanelSurface } from '../src/client/ui/UserPanelSurface.js'
import { invalidateOverview } from '../src/client/features/market/market-resource.js'
import { userPanelRoute, userPanelMutationRoute, MARKET_ROUTES } from '../src/contracts/market.js'
import type { UserPanelEntry } from '../src/client/api.js'
import type { Translate } from '../src/client/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: Translate = key => key
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  window.history.replaceState(null, '', '/')
  vi.unstubAllGlobals()
})
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(yes => {
    resolve = yes
  })
  return { promise, resolve }
}
function entry(name: string): UserPanelEntry {
  return {
    id: name,
    name,
    description: name,
    origin: 'user',
    rawText: '---\ndescription: ' + name + '\n---\nBody',
    metadata: {},
    content: 'Body',
    path: '/user/' + name + '.md',
    disabled: false
  }
}
async function click(label: string) {
  const button = [...document.body.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
for (const workspace of [true, false]) {
  for (const saveFirst of [false, true]) {
    it(`${workspace ? 'workspace tabs' : 'direct kind changes'} preserve the new list when the old save finishes ${saveFirst ? 'first' : 'last'}`, async () => {
      invalidateOverview()
      const save = deferred()
      const commands = deferred()
      let skillReads = 0
      const http = vi.fn<typeof fetch>(url => {
        if (url === MARKET_ROUTES.overview)
          return Promise.resolve(Response.json({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }))
        if (url === userPanelRoute('skills')) return Promise.resolve(Response.json({ entries: [entry(++skillReads === 1 ? 'original skill' : 'obsolete skill')] }))
        if (url === userPanelRoute('commands')) return commands.promise
        if (url === userPanelMutationRoute('skills', 'update', 'original skill')) return save.promise
        return Promise.reject(new Error('Unexpected HTTP route: ' + String(url)))
      })
      vi.stubGlobal('fetch', http)
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
      await act(async () => root!.render(workspace ? h(PluginWorkspace, { t }) : h(UserPanelSurface, { t, kind: 'skills' })))
      if (workspace) await click('workspaceTabSkills')
      await click('original skill')
      await click('panelSave')
      if (workspace) await click('workspaceTabCommands')
      else await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'commands' })))
      if (saveFirst) await act(async () => save.resolve(Response.json({ ok: true })))
      await act(async () => commands.resolve(Response.json({ entries: [entry('current command')] })))
      if (!saveFirst) await act(async () => save.resolve(Response.json({ ok: true })))
      expect(host.textContent).toContain('/current command')
      expect(host.textContent).not.toContain('obsolete skill')
      expect(skillReads).toBe(1)
    })
  }
}
it('a save waiting on its follow-up read cannot close the new kind editor', async () => {
  const oldRefresh = deferred()
  let skillReads = 0
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(url => {
      if (url === userPanelRoute('skills')) return ++skillReads === 1 ? Promise.resolve(Response.json({ entries: [entry('original skill')] })) : oldRefresh.promise
      if (url === userPanelRoute('commands')) return Promise.resolve(Response.json({ entries: [entry('current command')] }))
      if (url === userPanelMutationRoute('skills', 'update', 'original skill')) return Promise.resolve(Response.json({ ok: true }))
      return Promise.reject(new Error('Unexpected HTTP route: ' + String(url)))
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'skills' })))
  await click('original skill')
  await click('panelSave')
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'commands' })))
  await click('/current command')
  await act(async () => oldRefresh.resolve(Response.json({ entries: [entry('obsolete skill')] })))
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('current command')
  expect(host.textContent).not.toContain('obsolete skill')
})

it('an old kind save failure does not publish an error or disturb the new list', async () => {
  const save = deferred()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(url => {
      if (url === userPanelRoute('skills')) return Promise.resolve(Response.json({ entries: [entry('original skill')] }))
      if (url === userPanelRoute('commands')) return Promise.resolve(Response.json({ entries: [entry('current command')] }))
      if (url === userPanelMutationRoute('skills', 'update', 'original skill')) return save.promise
      return Promise.reject(new Error('Unexpected HTTP route: ' + String(url)))
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'skills' })))
  await click('original skill')
  await click('panelSave')
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'commands' })))
  await act(async () => save.resolve(Response.json({ error: 'obsolete save error' }, { status: 500 })))
  expect(host.textContent).toContain('/current command')
  expect(host.textContent).not.toContain('obsolete save error')
  expect(host.textContent).not.toContain('panelWorking')
})
it('an old kind deletion cannot close the current kind confirmation', async () => {
  const deletion = deferred()
  let deletionStarted = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(url => {
      if (url === userPanelRoute('skills')) return Promise.resolve(Response.json({ entries: [entry('original skill')] }))
      if (url === userPanelRoute('commands')) return Promise.resolve(Response.json({ entries: [entry('current command')] }))
      if (url === userPanelMutationRoute('skills', 'delete')) {
        deletionStarted = true
        return deletion.promise
      }
      return Promise.reject(new Error('Unexpected HTTP route: ' + String(url)))
    })
  )
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'skills' })))
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="panelDelete"]')!.click())
  await click('confirmDelete')
  expect(deletionStarted).toBe(true)
  await act(async () => root!.render(h(UserPanelSurface, { t, kind: 'commands' })))
  await act(async () => host!.querySelector<HTMLButtonElement>('button[aria-label="panelDelete"]')!.click())
  const currentConfirmation = document.querySelector('[role="dialog"]')
  expect(currentConfirmation).not.toBeNull()
  await act(async () => deletion.resolve(Response.json({ ok: true })))
  expect(document.querySelector('[role="dialog"]')).toBe(currentConfirmation)
})
