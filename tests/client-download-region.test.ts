// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { McpPluginCard, type McpEnhanceScopeFace } from '../src/client/McpPluginCard.js'
import css from '../src/client/market.module.css'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ IconChevronDownOutline14: undefined }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function fixture() {
  let region: 'auto' | 'global' | 'china' = 'auto'
  const listeners = new Set<() => void>()
  const setRegion = vi.fn(async (next: 'global' | 'china') => {
    region = next
    for (const listener of listeners) listener()
  })
  const scope: McpEnhanceScopeFace = {
    enhanced: () => true,
    writable: () => true,
    region: () => region,
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setEnhanced: async () => {},
    setRegion
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      h(McpPluginCard, {
        scope,
        t: key => key,
        probe: async () => ({ backend: 'builtin', hostClient: { available: true, version: 'test' }, downloadRegion: { setting: 'auto', effective: 'china' } })
      })
    )
  )
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
  const button = (key: string) => [...host.querySelectorAll('button')].find(b => b.textContent === key)!
  return {
    button,
    setRegion,
    host,
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    }
  }
}

describe('download region switching', () => {
  it('reflects saved choices in both directions without reopening or replacing the initial probe', async () => {
    const f = await fixture()
    try {
      expect(f.button('regionChina').className).toBe(css.regionSegOn)
      await act(async () => f.button('regionGlobal').click())
      expect(f.setRegion).toHaveBeenLastCalledWith('global')
      expect(f.button('regionGlobal').className).toBe(css.regionSegOn)
      await act(async () => f.button('regionChina').click())
      expect(f.setRegion).toHaveBeenLastCalledWith('china')
      expect(f.button('regionChina').className).toBe(css.regionSegOn)
      await act(async () => f.button('regionGlobal').click())
      expect(f.button('regionGlobal').className).toBe(css.regionSegOn)
    } finally {
      await f.close()
    }
  })
  it('keeps the saved selection and displays write failures, then permits retry', async () => {
    const f = await fixture()
    try {
      f.setRegion.mockRejectedValueOnce(new Error('save failed'))
      await act(async () => f.button('regionGlobal').click())
      expect(f.host.textContent).toContain('save failed')
      expect(f.button('regionChina').className).toBe(css.regionSegOn)
      expect(f.button('regionGlobal').disabled).toBe(false)
      await act(async () => f.button('regionGlobal').click())
      expect(f.host.textContent).not.toContain('save failed')
      expect(f.button('regionGlobal').className).toBe(css.regionSegOn)
    } finally {
      await f.close()
    }
  })
})
