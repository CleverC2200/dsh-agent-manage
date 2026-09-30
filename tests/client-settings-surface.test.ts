// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null, Input: () => null, Modal: () => null, Toast: () => null, Tooltip: () => null }))
vi.mock('../src/client/PluginWorkspace.js', () => ({ PluginWorkspace: () => null }))
vi.mock('../src/client/McpPluginCard.js', () => ({ McpPluginCard: () => null }))
vi.mock('../src/client/ui/BusyOverlay.js', () => ({ BusyOverlay: () => null }))
import { apply, missingPrimitives } from '../src/client/index.js'

describe('current settings surface', () => {
  it('registers exactly the formal workspace and settings card without a DOM page fallback', () => {
    const entries: Record<string, unknown>[] = []
    const dispose: Array<() => void> = []
    const slots = {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (entry: Record<string, unknown>) => {
        entries.push(entry)
        return () => {}
      }
    }
    apply({
      effect: callback => {
        const result = callback()
        if (typeof result === 'function') dispose.push(result as () => void)
      },
      locale: { register: () => {}, bind: () => key => key },
      remote: { credentials: {} as never },
      slots,
      inject: (_services, callback) =>
        callback({ slots, settingsScope: { bind: () => ({ getSnapshot: () => ({ writable: true }), subscribe: () => () => {}, set: async () => {} }) } })
    })
    expect(entries.map(entry => entry['name'])).toEqual(['settings.plugin.item', 'settings.section'])
    expect(document.querySelector('[data-dsh-agent-plugins-market-entry]')).toBeNull()
    expect(missingPrimitives({})).toEqual(['Button', 'Input', 'Modal', 'Toast', 'Tooltip'])
    for (const cleanup of dispose.reverse()) cleanup()
  })
})
