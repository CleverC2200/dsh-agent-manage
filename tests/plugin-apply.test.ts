import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'

interface RegisteredTool {
  name: string
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dsh-agent-plugins-market host entry', () => {
  it('does not register a redundant agent_plugins model tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    const registrations: RegisteredTool[] = []
    const cleanups: Array<() => void> = []
    const tools = {
      register: (definition: RegisteredTool) => {
        registrations.push(definition)
        return () => {}
      }
    }
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.length === 1 && services.includes('tools')) callback({ tools, effect: (effect: () => () => void) => cleanups.push(effect()) })
        if (services.includes('webServer')) callback({ effect: () => {} })
      },
      skills: {
        registerProvider: (create: (control: { signal: AbortSignal; invalidate: () => void }) => unknown) => {
          create({ signal: new AbortController().signal, invalidate: () => {} })
          return () => {}
        }
      },
      effect: (effect: () => () => void) => cleanups.push(effect()),
      on: () => () => {},
      logger: { warn: () => {} }
    }

    await apply(context as never)

    expect(registrations.map(tool => tool.name)).not.toContain('agent_plugins')
    // Dispose the instance: a live plugin keeps reconciling and would leak
    // calls into the next test's RuntimeReconciler spy.
    cleanups.forEach(cleanup => cleanup())
  })
})
