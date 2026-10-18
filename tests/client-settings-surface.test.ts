// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Button: () => null, Input: () => null, Modal: () => null, Toast: () => null, Tooltip: () => null }))
vi.mock('../src/client/PluginWorkspace.js', () => ({ PluginWorkspace: () => null }))
vi.mock('../src/client/McpPluginCard.js', () => ({ McpPluginCard: () => null }))
vi.mock('../src/client/ui/BusyOverlay.js', () => ({ BusyOverlay: () => null }))
import { apply, missingPrimitives } from '../src/client/index.js'

describe('current settings surface', () => {
  it('contributes its resource workspace to the public Workbench directory and closes settings only after native editing opens', async () => {
    Object.defineProperty(globalThis, '__dshManageClientCss', { value: '.test-style { color: red; }', configurable: true })
    const entries: Record<string, unknown>[] = []
    const dispose: Array<() => void> = []
    const pages: unknown[] = []
    const namespaces: string[] = []
    const openAgentSession = vi.fn().mockResolvedValue(undefined)
    const components = new Map()
    const effect = (callback: () => unknown) => {
      const result = callback()
      if (typeof result === 'function') dispose.push(result as () => void)
    }
    const slots = {
      inject: (_name: string, callback: () => unknown) => callback(),
      register: (entry: Record<string, unknown>, component: unknown) => {
        entries.push(entry)
        components.set(entry.name, component)
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
            openAgentSession,
            register: page => {
              pages.push(page)
              return () => {
                pages.splice(pages.indexOf(page), 1)
              }
            }
          },
          slots,
          settingsScope: {
            bind: ({ namespace }: { namespace: string }) => {
              namespaces.push(namespace)
              return { getSnapshot: () => ({ writable: true }), subscribe: () => () => {}, set: async () => {} }
            }
          }
        })
    })
    expect(entries.map(entry => entry['name'])).toEqual(['settings.plugin.item', 'main', 'settings.section'])
    expect(namespaces).toEqual(['dsh-agent-manage'])
    expect(entries.find(entry => entry['name'] === 'settings.plugin.item')?.['key']).toBe('dsh-agent-manage')
    expect(pages).toEqual([{ id: 'agent-plugin-workspace', label: expect.any(Function) }])
    expect(document.querySelector('[data-dsh-agent-plugins-market-entry]')).toBeNull()
    expect(document.querySelector('style[data-dsh-client="dsh-agent-manage"]')?.textContent).toContain('.test-style')
    expect(document.querySelector('style[data-dsh-client="dsh-agent-manage"]')?.getAttribute('data-plugin')).toBe('dsh-agent-manage')
    expect(missingPrimitives({})).toEqual(['Button', 'Input', 'Modal', 'Toast', 'Tooltip'])
    const close = vi.fn()
    const section = components.get('settings.section')({ close })
    const session = { sessionId: 'editor', preset: 'skill-directory-editor', cwd: '/owned/workcopy', draft: 'Edit this Skill.' }
    await section.props.openEditor(session)
    expect(openAgentSession).toHaveBeenCalledWith(session)
    expect(close).toHaveBeenCalledTimes(1)
    openAgentSession.mockRejectedValueOnce(Error('NATIVE_SESSION_UNAVAILABLE'))
    await expect(section.props.openEditor(session)).rejects.toThrow('NATIVE_SESSION_UNAVAILABLE')
    expect(close).toHaveBeenCalledTimes(1)
    for (const cleanup of dispose.reverse()) cleanup()
    expect(pages).toEqual([])
    expect(document.querySelector('style[data-dsh-client="dsh-agent-manage"]')).toBeNull()
    Reflect.deleteProperty(globalThis, '__dshManageClientCss')
  })
})
