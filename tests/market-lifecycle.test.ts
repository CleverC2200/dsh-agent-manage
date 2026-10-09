// @vitest-environment jsdom
import { act, createElement as h, StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MarketSection } from '../src/client/MarketSection.js'
import { invalidateOverview } from '../src/client/features/market/market-resource.js'
import { busySnapshot } from '../src/client/ui/busy-operation.js'
import type { Translate } from '../src/client/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const t: Translate = key => key
afterEach(() => vi.unstubAllGlobals())
it('StrictMode render starts no HTTP or busy lease and the committed effects share one read', async () => {
  invalidateOverview()
  let respond!: (response: Response) => void
  const http = vi.fn<typeof fetch>(
    () =>
      new Promise(resolve => {
        respond = resolve
      })
  )
  vi.stubGlobal('fetch', http)
  const section = h(StrictMode, null, h(MarketSection, { t }))
  renderToString(section)
  expect(http).not.toHaveBeenCalled()
  expect(busySnapshot()).toHaveLength(0)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(section))
    expect(http).toHaveBeenCalledTimes(1)
    await act(async () => respond(Response.json({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] })))
    expect(host.textContent).toContain('nav')
    expect(busySnapshot()).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
