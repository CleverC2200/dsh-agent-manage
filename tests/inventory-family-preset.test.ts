/** Registry and resources expose one catalog over actual fixed Core Sessions. */
import { expect, it, onTestFinished, vi } from 'vitest'
import { inventoryFamilyHarness, inventoryRoleInput, inventoryRoles } from './inventory-family-harness.js'
import { agentOn, completion, history, presetHarness, record, turn } from './core-preset-harness.js'
import { createCapabilityRegistry } from 'preset-integration-gea/capability/registry'

it.each(inventoryRoles)('$name appears with the same trusted name and description in resource discovery and the official catalog', async role => {
  const f = await inventoryFamilyHarness(role)
  const summary = (await f.resources.list()).find(row => row.id === f.resource.id)
  const catalog = (await f.ctx.agentPresets.list()).find(row => row.id === f.resource.id)
  expect(summary).toMatchObject({ id: f.resource.id, label: role.name, description: expect.stringContaining('上下文压缩'), skills: [role.id], enabled: true })
  expect(catalog).toMatchObject({ id: f.resource.id, name: role.name, description: summary?.description })
  expect(f.selection).toMatchObject({ preset: f.resource.id, profile: { consumerCode: role.consumer, skills: [role.id] } })
  await record(`${role.id}-catalog`, { summary, catalog, selection: f.selection })
})

it.each(inventoryRoles)('$name keeps the actual standard tools through GEA hooks and compacts its original task', async role => {
  const f = await inventoryFamilyHarness(role, { seed: await history(20_000) })
  const requests = await completion(f.ctx, 262_144, true)
  const baseline = await presetHarness()
  const baselineRequests = await completion(baseline.ctx)
  const reference = await agentOn(baseline.ctx, `${role.id}-standard`, 'standard')
  await turn(baseline.ctx, reference, 'Read the standard task capabilities.')
  const standardTools = baselineRequests.at(-1)?.tools?.map(row => row.name) ?? []
  const standardCommands = baseline.ctx.commands.list(reference).map(row => row.name)
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the original inventory task within its read-only Consumer scope.')
  const finalTools = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(finalTools).toEqual(expect.arrayContaining(standardTools))
  expect(f.ctx.commands.list(f.agent).map(row => row.name)).toEqual(standardCommands)
  expect(f.ctx.agentPresets.serviceFor(f.agent, 'compaction')?.constructor.name).toBe(baseline.ctx.agentPresets.serviceFor(reference, 'compaction')?.constructor.name)
  expect(f.ctx.agentPresets.serviceFor(f.agent, 'toolResultPruner')?.constructor.name).toBe(baseline.ctx.agentPresets.serviceFor(reference, 'toolResultPruner')?.constructor.name)
  expect(await f.ctx.skills.get(role.id, { scope: f.agent, cwd: f.home })).toMatchObject({ name: role.id })
  expect(JSON.stringify(requests.at(-1)?.messages)).toContain(role.persona)
  expect(f.agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  const compact = await f.ctx.commands.execute(f.agent, '/compact', [], new AbortController().signal)
  expect(compact?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  await turn(f.ctx, f.agent, 'Continue from the checkpoint and preserve the original inventory task.')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  expect(JSON.stringify(requests)).not.toMatch(/fixture-identity-secret|fixture-delegation-secret/)
  await record(`${role.id}-capabilities`, {
    preset: f.selection.preset,
    consumer: role.consumer,
    standardTools,
    finalTools,
    standardCommands,
    compact: compact?.result,
    compactionEvents: f.agent.session.snapshotEvents().filter(row => row.type.startsWith('compaction/') || row.type === 'turn/end'),
    credentialFreePrompt: true
  })
})

it.each(inventoryRoles)('$name queries its own Consumer and refuses another inventory role while general work remains usable', async role => {
  const f = await inventoryFamilyHarness(role)
  await completion(f.ctx)
  const other = await inventoryRoleInput(inventoryRoles.find(row => row.consumer === role.forbiddenConsumer)!)
  await f.resources.register([other.resource])
  await f.resources.select(other.resource.id, new AbortController().signal)
  f.business.setCapabilities(createCapabilityRegistry([f.contract, other.contract, { id: 'gea-workbench', label: '销售计划', maxEffect: 'view', layers: ['read'] }]))
  expect((await f.resources.list()).find(row => row.id === other.resource.id)).toMatchObject({ enabled: true })
  expect(() => f.business.assertExecutionAllowed(role.forbiddenConsumer, 'view')).not.toThrow()
  const missingIdentity = await f.query()
  expect(JSON.stringify(missingIdentity)).toContain('GEA MCP requires an enabled business Agent and current GEA identity')
  expect(f.ctx.tools.schemas(f.agent).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(f.network).toEqual([])
  await f.login()
  const denied = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: role.forbiddenConsumer })
  expect(JSON.stringify(denied)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  expect(() => f.business.assertExecutionAllowed(role.consumer, 'submit')).toThrow('GEA_CAPABILITY_EFFECT_NOT_ALLOWED')
  const allowed = await f.query()
  expect(JSON.stringify(allowed)).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual([role.consumer])
  const todo = await f.execute('todo_write', { todos: [{ content: 'Keep verified inventory scope', status: 'in_progress' }] })
  expect(todo.isError).toBe(false)
  const children: unknown[] = []
  const off = f.ctx.on(
    'agent/pre-step',
    async ({ agent }, next) => {
      if (agent !== f.agent) {
        const preset = f.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')
        const denied = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: role.forbiddenConsumer }, agent)
        const allowed = await f.query(undefined, agent)
        children.push({ preset, denied, allowed })
      }
      return next()
    },
    { global: true }
  )
  onTestFinished(off)
  const childResult = await f.execute('subagent', {
    description: 'Check original inventory scope',
    prompt: 'Continue the original inventory role without widening its Consumer authorization.',
    run_in_background: false
  })
  expect(childResult.isError).toBe(false)
  expect(children).toHaveLength(1)
  expect(JSON.stringify(children)).toContain(f.resource.id)
  expect(JSON.stringify(children)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(JSON.stringify(children)).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').every(row => row.body.consumerCode === role.consumer)).toBe(true)
  await record(`${role.id}-authorization`, {
    missingIdentity,
    denied,
    allowed,
    todo,
    consumer: role.consumer,
    registeredForeignConsumer: role.forbiddenConsumer,
    foreignResource: other.resource.id,
    children,
    childResult,
    network: f.network
  })
})

it.each(inventoryRoles)('$name cleans up a disabled resource and restores its registration without changing the old Session or identity', async role => {
  const f = await inventoryFamilyHarness(role, { seed: await history(100) })
  await completion(f.ctx)
  await f.login()
  const identity = f.business.identitySignal()
  const header = JSON.stringify(f.agent.session.header)
  const oldEvents = JSON.stringify(f.agent.session.snapshotEvents())
  f.business.setCapabilities(createCapabilityRegistry([{ ...f.contract, enabled: false }]))
  const disabledQuery = await f.query()
  expect(JSON.stringify(disabledQuery)).toContain('GEA_CAPABILITY_DISABLED')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  await f.releaseResource()
  expect((await f.resources.list()).some(row => row.id === f.resource.id)).toBe(false)
  expect((await f.ctx.agentPresets.list()).some(row => row.id === f.resource.id)).toBe(false)
  const removedQuery = await f.query()
  expect(JSON.stringify(removedQuery)).toContain('GEA_AGENT_RESOURCE_MISSING')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  const releaseDisabled = await f.resources.register([{ ...f.resource, enabled: false }])
  expect((await f.resources.list()).find(row => row.id === f.resource.id)).toMatchObject({ enabled: false })
  await expect(f.resources.select(f.resource.id, new AbortController().signal)).rejects.toThrow('AGENT_RESOURCE_DISABLED_OR_MISSING')
  await releaseDisabled()
  f.business.setCapabilities(f.capabilities)
  await f.resources.register([f.resource])
  const selection = await f.resources.select(f.resource.id, new AbortController().signal)
  expect(selection.preset).toBe(f.resource.id)
  expect((await f.ctx.agentPresets.list()).filter(row => row.id === f.resource.id)).toHaveLength(1)
  expect(await f.ctx.skills.get(role.id, { scope: f.agent, cwd: f.home })).toMatchObject({ name: role.id })
  expect(JSON.stringify(f.agent.session.header)).toBe(header)
  expect(JSON.stringify(f.agent.session.snapshotEvents())).toBe(oldEvents)
  expect(f.business.identitySignal()).toBe(identity)
  const restoredQuery = await f.query()
  expect(JSON.stringify(restoredQuery)).toContain('42')
  expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual([role.consumer])
  await record(`${role.id}-lifecycle`, { disabledQuery, removedQuery, selection, restoredQuery, oldHeaderPreserved: true, oldEventsPreserved: true, identityPreserved: true })
})

it('keeps the dealer gateway customer scope, protected nulls and access denial without retrying through another Consumer', async () => {
  const f = await inventoryFamilyHarness(inventoryRoles[2])
  await completion(f.ctx)
  await f.login()
  const fetchGateway = globalThis.fetch
  const customerRequests: unknown[] = []
  vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (path === '/ai/gateway/mcp/proxy/mcp' && body.method === 'tools/call') {
      const args = body.params.arguments
      if (body.params.name === 'inspect_cube_model')
        return Response.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  semanticModel: [{ name: 'inv', measures: [{ name: 'inv.row_count', type: 'number' }], dimensions: [{ name: 'inv.customer', type: 'string' }] }]
                })
              }
            ]
          }
        })
      customerRequests.push(args)
      const customer = args.queries[0].query.filters[0].values[0]
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          ...(customer !== 'authorized-customer' ? { isError: true } : {}),
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                customer === 'authorized-customer'
                  ? {
                      action: 'query',
                      status: 'completed',
                      executedQueryCount: 1,
                      datasets: [
                        {
                          name: 'inv',
                          rowCount: 1,
                          dataStatus: 'ok',
                          offset: 0,
                          totalRowCount: 1,
                          hasMorePages: false,
                          fields: [
                            { name: 'inv.customer', type: 'string' },
                            { name: 'inv.row_count', type: 'number' },
                            { name: 'protectedPrice', type: 'number' }
                          ],
                          rows: [{ 'inv.customer': 'authorized-customer', 'inv.row_count': 42, protectedPrice: null }]
                        }
                      ]
                    }
                  : { code: 'ACCESS_DENIED', message: 'Customer is outside the current gateway row authorization.' }
              )
            }
          ]
        }
      })
    }
    return fetchGateway(input, init)
  })
  const query = (customer: string) =>
    f.execute('mcp__gea-gateway__query_business_data', {
      queries: [
        {
          name: 'inv',
          query: { dimensions: ['inv.customer'], measures: ['inv.row_count'], filters: [{ member: 'inv.customer', operator: 'equals', values: [customer] }], limit: 3 }
        }
      ]
    })
  const allowed = await query('authorized-customer')
  expect(JSON.stringify(allowed)).toContain('authorized-customer')
  expect(JSON.stringify(allowed)).toMatch(/protectedPrice\\?":null/)
  const denied = await query('foreign-customer')
  expect(JSON.stringify(denied)).toContain('ACCESS_DENIED')
  expect(customerRequests).toHaveLength(2)
  expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual(['dealer-inventory-replenishment'])
  expect((await f.execute('todo_write', { todos: [] })).isError).toBe(false)
  await record('inventory-dealer-customer-scope', {
    allowed,
    denied,
    customerRequests,
    consumer: 'dealer-inventory-replenishment',
    transport: 'controlled local gateway; actual GEA execution path'
  })
})
