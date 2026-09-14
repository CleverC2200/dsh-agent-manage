import { expect, it } from 'vitest'
import { restrictGeaMcp, type GeaScopeAgent, type GeaScopeHost } from '../src/runtime/gea-mcp-scope.js'

const tool = 'mcp__gea_gateway__query_business_data_123'
function fixture() {
  const listeners = new Map<string, Set<() => void>>()
  const emit = (event: string) => [...(listeners.get(event) ?? [])].forEach(fn => fn())
  const names = new Set([tool, 'read'])
  const agents: GeaScopeAgent[] = []
  const presets = new Map<GeaScopeAgent['ctx'], string>()
  const restrictions = new Map<GeaScopeAgent, Set<string[]>>()
  let guard: Parameters<GeaScopeHost['tools']['guard']>[0] | undefined
  const host: GeaScopeHost = {
    agents: { list: () => agents },
    agentPresets: { composedPreset: ctx => presets.get(ctx) },
    tools: {
      schemas: () => [...names].map(name => ({ name })),
      guard: fn => {
        guard = fn
        return () => {
          guard = undefined
        }
      }
    },
    on: (event, fn) => {
      const group = listeners.get(event) ?? new Set()
      listeners.set(event, group)
      group.add(fn)
      return () => {
        group.delete(fn)
      }
    }
  }
  const add = (preset?: string) => {
    const masks = new Set<string[]>()
    const agent: GeaScopeAgent = {
      ctx: {
        tools: {
          restrict: ({ deny }) => {
            expect(deny.every(name => names.has(name))).toBe(true)
            masks.add(deny)
            emit('tools/change')
            return () => {
              masks.delete(deny)
              emit('tools/change')
            }
          }
        }
      }
    }
    restrictions.set(agent, masks)
    if (preset) presets.set(agent.ctx, preset)
    agents.push(agent)
    emit('agent/created')
    return agent
  }
  return {
    host,
    add,
    names,
    emit,
    presets,
    agents,
    visible: (agent: GeaScopeAgent) => [...names].filter(name => [...restrictions.get(agent)!].every(mask => !mask.includes(name))),
    denial: (agent?: GeaScopeAgent, name = tool) => guard?.({ name, agent })
  }
}

it('only permits the forecast preset, hides schemas elsewhere and rejects unscoped or stale calls', () => {
  const f = fixture()
  const other = f.add('code')
  const forecast = f.add('gea-readonly')
  const stop = restrictGeaMcp(f.host, 'gea-readonly')
  expect(f.visible(other)).toEqual(['read'])
  expect(f.visible(forecast)).toContain(tool)
  expect(f.denial(other)).toContain('GEA MCP')
  expect(f.denial()).toContain('GEA MCP')
  expect(f.denial(forecast)).toBeUndefined()
  expect(f.denial(other, 'read')).toBeUndefined()
  expect(f.denial(other, 'gea_sales_plan_read')).toContain('GEA MCP')
  expect(f.denial(forecast, 'gea_sales_plan_read')).toBeUndefined()
  const unknown = f.add()
  expect(f.visible(unknown)).toEqual(['read'])
  expect(f.denial(unknown)).toContain('GEA MCP')
  stop()
  expect(f.visible(other)).toContain(tool)
})

it('tracks new tools, logout/login, preset switches and agent disposal without event recursion', () => {
  const f = fixture()
  const stop = restrictGeaMcp(f.host, 'gea-readonly')
  const agent = f.add('code')
  f.names.add('mcp__gea_gateway__lightrag_query_456')
  f.emit('tools/change')
  expect(f.visible(agent)).toEqual(['read'])
  f.presets.set(agent.ctx, 'gea-readonly')
  f.emit('agent-preset/selected')
  expect(f.visible(agent)).toHaveLength(3)
  f.presets.set(agent.ctx, 'code')
  f.emit('agent-preset/selected')
  expect(f.visible(agent)).toEqual(['read'])
  f.names.delete(tool)
  f.emit('tools/change')
  f.names.add(tool)
  f.emit('tools/change')
  expect(f.visible(agent)).toEqual(['read'])
  f.agents.pop()
  f.emit('agent/disposed')
  expect(f.visible(agent)).toHaveLength(3)
  stop()
})
