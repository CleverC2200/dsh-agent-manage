import { beforeEach, expect, it, vi } from 'vitest'
import type { OverviewData } from '../src/client/api.js'
const fetchOverview = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ fetchOverview, fetchSourceProgress: vi.fn() }))
beforeEach(() => {
  vi.resetModules()
  fetchOverview.mockReset()
})
function deferred() {
  let resolve!: (data: OverviewData) => void
  let reject!: (error: Error) => void
  const promise = new Promise<OverviewData>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function data(total: number): OverviewData {
  return { sources: [], suites: [], totals: { all: total, installed: 0, enabled: 0 }, roots: { user: '', data: '' }, unmanaged: [] }
}
it('reads a render snapshot without I/O and shares a live request', async () => {
  const resource = await import('../src/client/features/market/market-resource.js')
  resource.readOverview()
  resource.readOverview()
  expect(fetchOverview).not.toHaveBeenCalled()
  const response = deferred()
  fetchOverview.mockReturnValue(response.promise)
  const first = resource.loadOverview().promise
  expect(resource.loadOverview().promise).toBe(first)
  expect(fetchOverview).toHaveBeenCalledTimes(1)
  response.resolve(data(1))
  await expect(first).resolves.toEqual(data(1))
  expect(resource.readOverview().initial).toEqual(data(1))
})
for (const fails of [false, true]) it(`invalidation replaces an old request and ignores its late ${fails ? 'error' : 'result'}`, async () => {
  const resource = await import('../src/client/features/market/market-resource.js')
  const old = deferred(), latest = deferred()
  fetchOverview.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
  const oldRead = resource.loadOverview().promise
  resource.invalidateOverview()
  const latestRead = resource.loadOverview().promise
  if (fails) old.reject(new Error('obsolete')); else old.resolve(data(1))
  await Promise.resolve()
  expect(resource.loadOverview().promise).toBe(latestRead)
  expect(fetchOverview).toHaveBeenCalledTimes(2)
  latest.resolve(data(2))
  await expect(latestRead).resolves.toEqual(data(2))
  await expect(oldRead).resolves.toEqual(data(2))
  expect(resource.readOverview().initial).toEqual(data(2))
})
it('a current failure remains observable and permits a new request', async () => {
  const resource = await import('../src/client/features/market/market-resource.js')
  fetchOverview.mockRejectedValueOnce(new Error('current failure')).mockResolvedValueOnce(data(3))
  await expect(resource.loadOverview().promise).rejects.toThrow('current failure')
  await expect(resource.loadOverview().promise).resolves.toEqual(data(3))
})
