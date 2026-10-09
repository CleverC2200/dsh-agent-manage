import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { OverviewData } from '../src/client/api.js'

const http = vi.fn<typeof fetch>()
beforeEach(() => {
  vi.resetModules()
  http.mockReset()
  vi.stubGlobal('fetch', http)
})
afterEach(() => vi.unstubAllGlobals())
function deferred() {
  let resolve!: (data: OverviewData) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Response>((yes, no) => {
    resolve = data => yes(Response.json(data))
    reject = no
  })
  return { promise, resolve, reject }
}
function data(total: number): OverviewData {
  return { sources: [], suites: [], totals: { all: total, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }
}
it('reads a render snapshot without HTTP and shares a live request', async () => {
  const resource = await import('../src/client/features/market/market-resource.js')
  resource.readOverview()
  resource.readOverview()
  expect(http).not.toHaveBeenCalled()
  const response = deferred()
  http.mockReturnValue(response.promise)
  const first = resource.loadOverview().promise
  expect(resource.loadOverview().promise).toBe(first)
  response.resolve(data(1))
  await expect(first).resolves.toEqual(data(1))
  expect(resource.readOverview().initial).toEqual(data(1))
  expect(http).toHaveBeenCalledTimes(1)
})
for (const fails of [false, true]) {
  for (const latestFirst of [false, true]) {
    it(`invalidation publishes the latest overview when obsolete ${fails ? 'failure' : 'success'} finishes ${latestFirst ? 'last' : 'first'}`, async () => {
      const resource = await import('../src/client/features/market/market-resource.js')
      const old = deferred()
      const latest = deferred()
      http.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
      const oldRead = resource.loadOverview().promise
      resource.invalidateOverview()
      const latestRead = resource.loadOverview().promise
      if (latestFirst) {
        latest.resolve(data(2))
        await expect(latestRead).resolves.toEqual(data(2))
      }
      if (fails) old.reject(new Error('obsolete'))
      else old.resolve(data(1))
      if (!latestFirst) latest.resolve(data(2))
      await expect(latestRead).resolves.toEqual(data(2))
      await expect(oldRead).resolves.toEqual(data(2))
      expect(resource.readOverview().initial).toEqual(data(2))
      expect(http).toHaveBeenCalledTimes(2)
    })
  }
}
it('a current failure remains observable and permits an explicit new request', async () => {
  const resource = await import('../src/client/features/market/market-resource.js')
  http.mockRejectedValueOnce(new Error('current failure')).mockResolvedValueOnce(Response.json(data(3)))
  await expect(resource.loadOverview().promise).rejects.toThrow('current failure')
  await expect(resource.loadOverview().promise).resolves.toEqual(data(3))
})

for (const obsoleteFails of [false, true])
  it(`an obsolete ${obsoleteFails ? 'failure' : 'success'} follows the latest failure without an automatic retry`, async () => {
    const resource = await import('../src/client/features/market/market-resource.js')
    const old = deferred()
    const latest = deferred()
    http.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const oldRead = resource.loadOverview().promise
    resource.invalidateOverview()
    const latestRead = resource.loadOverview().promise
    latest.reject(new Error('latest failure'))
    await expect(latestRead).rejects.toThrow('latest failure')
    const oldResult = expect(oldRead).rejects.toThrow('latest failure')
    if (obsoleteFails) old.reject(new Error('obsolete failure'))
    else old.resolve(data(1))
    await oldResult
    expect(resource.readOverview().initial.totals.all).toBe(0)
    expect(http).toHaveBeenCalledTimes(2)
  })
