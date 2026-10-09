// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null, Input: () => null, Modal: () => null, Toast: () => null, Tooltip: () => null }))
vi.mock('../src/client/PluginWorkspace.js', () => ({ PluginWorkspace: () => null }))
vi.mock('../src/client/McpPluginCard.js', () => ({ McpPluginCard: () => null }))
vi.mock('../src/client/ui/BusyOverlay.js', () => ({ BusyOverlay: () => null }))
import { apply, missingPrimitives } from '../src/client/index.js'

describe('current settings surface', () => {
  it('contributes its resource workspace to the public Workbench directory and retains the settings card', () => {
    Object.defineProperty(globalThis, '__dshManageClientCss', { value: '.test-style { color: red; }', configurable: true })
    const entries: Record<string, unknown>[] = []
    const dispose: Array<() => void> = []
    const pages: unknown[] = []
    const effect = (callback: () => unknown) => {
      const result = callback()
      if (typeof result === 'function') dispose.push(result as () => void)
    }
    const slots = {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (entry: Record<string, unknown>) => {
        entries.push(entry)
        return () => {}
      }
    }
    apply({
      effect,
      locale: { register: () => {}, bind: () => key => key },
      remote: { credentials: {} as never },
      slots,
      inject: (_services, callback) =>
        callback({
          effect,
          agentWorkbench: {
            register: page => {
              pages.push(page)
              return () => {
                pages.splice(pages.indexOf(page), 1)
              }
            }
          },
          slots,
          settingsScope: { bind: () => ({ getSnapshot: () => ({ writable: true }), subscribe: () => () => {}, set: async () => {} }) }
        })
    })
    expect(entries.map(entry => entry['name'])).toEqual(['settings.plugin.item', 'main', 'settings.section'])
    expect(pages).toEqual([{ id: 'agent-plugin-workspace', label: expect.any(Function) }])
    expect(document.querySelector('[data-dsh-agent-plugins-market-entry]')).toBeNull()
    expect(document.querySelector('style[data-dsh-client="dsh-agent-manage"]')?.textContent).toContain('.test-style')
    expect(missingPrimitives({})).toEqual(['Button', 'Input', 'Modal', 'Toast', 'Tooltip'])
    for (const cleanup of dispose.reverse()) cleanup()
    expect(pages).toEqual([])
    expect(document.querySelector('style[data-dsh-client="dsh-agent-manage"]')).toBeNull()
    Reflect.deleteProperty(globalThis, '__dshManageClientCss')
  })
})
