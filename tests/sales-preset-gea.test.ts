/** Sales roles pass the actual Core Session and GEA Host authorization interfaces. */
import { expect, it } from 'vitest'
import { agentOn, completion, history, record, turn } from './core-preset-harness.js'
import { baseInventoryHarness } from './base-inventory-harness.js'
import { MINIMAL_SYSTEM_PROMPT } from '../src/runtime/standard-preset.js'
import { salesRoleInput, salesRoles } from './sales-role-input.js'

it.each(salesRoles)('$name keeps its catalog identity and complete standard capabilities in the actual Session', async role => {
  const f = await baseInventoryHarness({ ...(await salesRoleInput(role.id)), sessionId: role.id + '-capabilities' })
  const requests = await completion(f.ctx)
  const baseline = await agentOn(f.ctx, role.id + '-standard', 'standard')
  const expectedTools = f.ctx.tools
    .schemas(baseline)
    .map(row => row.name)
    .filter(name => !name.startsWith('gea_'))
    .sort()
  const summary = (await f.resources.list()).find(row => row.id === role.id)!
  expect(summary.label).toBe(role.name)
  const catalog = (await f.ctx.agentPresets.list()).find(row => row.id === role.id)!
  expect(catalog).toMatchObject({ name: role.name, description: summary.description })
  expect(summary.description).toContain('上下文压缩')
  expect(f.selection).toMatchObject({ preset: role.id, profile: { consumerCode: role.consumer } })
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the selected sales task using its original business scope.')
  const final = requests.at(-1)!
  expect(final.tools?.map(row => row.name)).toEqual(expect.arrayContaining(expectedTools))
  expect(f.ctx.commands.list(f.agent).map(row => row.name)).toEqual(f.ctx.commands.list(baseline).map(row => row.name))
  expect(f.ctx.agentPresets.serviceFor(f.agent, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  expect(f.ctx.agentPresets.serviceFor(f.agent, 'toolResultPruner')).toBeDefined()
  expect(JSON.stringify(final.messages)).toContain(role.persona)
  const businessPrompt = await f.ctx.systemPrompt.assemble({ scope: f.agent, agent: f.agent } as never)
  expect(businessPrompt.contexts).toEqual([])
  expect(businessPrompt.sections).toHaveLength(1)
  expect(businessPrompt.sections[0].text.startsWith(MINIMAL_SYSTEM_PROMPT + '\n\n')).toBe(true)
  expect(
    f.agent.session
      .snapshotEvents()
      .filter(event => event.type === 'user/message')
      .some(event => event.data.source.kind === 'runtime-context' || event.data.source.kind === 'agent-instructions')
  ).toBe(false)
  if (role.skill) for (const skill of f.selection.profile!.skills) expect(await f.ctx.skills.get(skill, { scope: f.agent, cwd: f.home })).toMatchObject({ name: skill })
  expect((await f.execute('todo_write', { todos: [{ content: '核对销售范围', status: 'in_progress' }] })).isError).toBe(false)
  const file = f.home + '/sales.txt'
  expect((await f.execute('write', { file_path: file, content: role.name })).isError).toBe(false)
  expect(JSON.stringify(await f.execute('read', { file_path: file }))).toContain(role.name)
  await record(role.id + '-capabilities', {
    selection: f.selection,
    summary,
    catalog,
    standardTools: expectedTools,
    finalTools: final.tools?.map(row => row.name),
    commands: f.ctx.commands.list(f.agent),
    skillAvailability: summary.missingSkills
  })
})

it.each(salesRoles)('$name automatically and manually compacts its actual business Session and continues the task', async role => {
  const f = await baseInventoryHarness({ ...(await salesRoleInput(role.id)), sessionId: role.id + '-compact', seed: await history(20_000) })
  const requests = await completion(f.ctx, 262_144, true)
  await f.login()
  await turn(f.ctx, f.agent, 'Continue the original task with the current Consumer and read-only query scope.')
  expect(f.agent.session.snapshotEvents().map(row => row.type)).toContain('compaction/summary')
  expect(requests.at(-1)?.messages.some(message => message.content.some(block => block.text?.includes('CHECKPOINT: preserve original task')))).toBe(true)
  const compact = await f.ctx.commands.execute(f.agent, '/compact', [], new AbortController().signal)
  expect(compact?.result).toMatchObject({ kind: 'success', text: expect.stringMatching(/^Compacted/) })
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  await record(role.id + '-compaction', {
    compact: compact?.result,
    events: f.agent.session.snapshotEvents().filter(row => row.type.startsWith('compaction/') || row.type === 'turn/end'),
    finalTools: requests.at(-1)?.tools?.map(row => row.name)
  })
})

it.each(salesRoles)('$name executes authorized queries and rejects undeclared Consumer and business writes through actual Host gates', async role => {
  const f = await baseInventoryHarness({ ...(await salesRoleInput(role.id)), sessionId: role.id + '-authorization' })
  await completion(f.ctx)
  const missingIdentity = await f.query()
  expect(JSON.stringify(missingIdentity)).toContain('GEA MCP requires an enabled business Agent and current GEA identity')
  expect(f.ctx.tools.schemas(f.agent).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(f.network).toEqual([])
  await f.login()
  const wrongConsumer = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: 'dealer-inventory-replenishment' })
  expect(JSON.stringify(wrongConsumer)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toEqual([])
  const allowed = await f.query()
  expect(JSON.stringify(allowed)).toContain('42')
  expect(f.network.find(row => row.path === '/ai/gateway/session')?.body.consumerCode).toBe(role.consumer)
  const priorRequests = f.network.length
  const writeTool = await f.execute('gea_workbench_apply', { action: 'approve', confirmed: true })
  expect(JSON.stringify(writeTool)).toContain('GEA_BUSINESS_TOOL_NOT_ALLOWED')
  expect(f.network).toHaveLength(priorRequests)
  let cross: unknown
  let nativeRead: unknown
  if (role.consumer === 'aps') {
    const { toolConsumer } = await import('preset-integration-gea/host/business-identity')
    expect(toolConsumer(f.ctx, f.business, f.agent.id, 'sales_forecast')).toBe('sales_forecast')
    cross = await f.query('sales_forecast')
    expect(JSON.stringify(cross)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
    expect(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode)).toEqual(['aps'])
    expect(() => f.business.assertExecutionAllowed('aps', 'submit')).toThrow('GEA_CAPABILITY_EFFECT_NOT_ALLOWED')
    expect(JSON.stringify(await f.execute('gea_sales_plan_read', { kind: 'list', query: { periodId: 'offline-period' } }))).toContain('GEA_BUSINESS_TOOL_NOT_ALLOWED')
  } else {
    nativeRead = await f.execute('gea_sales_plan_read', { kind: 'list', query: { periodId: 'offline-period', orderType: 'M', pageSize: 5 } })
    expect(JSON.stringify(nativeRead)).toContain('offline-plan')
    const beforeSubmit = f.network.length
    await expect(f.business.salesPlanSubmit({}, new AbortController().signal)).rejects.toThrow('GEA_HTTP_503：当前环境尚未配置销售计划重提服务，请联系管理员')
    expect(f.network).toHaveLength(beforeSubmit)
  }
  const todo = await f.execute('todo_write', { todos: [] })
  expect(todo.isError).toBe(false)
  await record(role.id + '-authorization', { missingIdentity, wrongConsumer, allowed, cross, nativeRead, writeTool, todo, network: f.network })
})

it.each(salesRoles)('$name keeps disabled resources unavailable and leaves the original resource data unchanged', async role => {
  const input = await salesRoleInput(role.id)
  const f = await baseInventoryHarness({ ...input, sessionId: role.id + '-owner' })
  const { readFile } = await import('node:fs/promises')
  const { resolve } = await import('node:path')
  const source = resolve(input.resource!.root, input.resource!.prompt!)
  const original = await readFile(source)
  const index = await readFile(resolve(f.home, 'selected-resources.json'))
  const releaseDisabled = await f.resources.register([{ ...input.resource!, id: 'disabled-sales-family', enabled: false }])
  expect((await f.resources.list()).find(row => row.id === 'disabled-sales-family')?.enabled).toBe(false)
  await expect(f.resources.select('disabled-sales-family', new AbortController().signal)).rejects.toThrow('AGENT_RESOURCE_DISABLED_OR_MISSING')
  expect(await readFile(resolve(f.home, 'selected-resources.json'))).toEqual(index)
  expect(await readFile(source)).toEqual(original)
  await releaseDisabled()
  await f.login()
  expect(JSON.stringify(await f.query())).toContain('42')
  await f.releaseResource()
  const withdrawn = await f.query()
  expect(withdrawn.isError).toBe(true)
  expect(JSON.stringify(withdrawn)).toContain('GEA MCP requires an enabled business Agent and current GEA identity')
  expect(f.ctx.tools.schemas(f.agent).map(row => row.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(f.network.filter(row => row.body.method === 'tools/call')).toHaveLength(1)
  await record(role.id + '-resource-owner', {
    disabledSelection: 'rejected',
    sourcePreserved: true,
    selectedIndexPreserved: true,
    withdrawnExecution: 'Cube source unavailable; schema hidden and execution denied'
  })
})

it('keeps the existing sales readonly validation scope and rejects write effects before transport', async () => {
  const input = await salesRoleInput('gea-readonly')
  const f = await baseInventoryHarness({
    ...input,
    sessionId: 'sales-readonly-protected',
    businessConfig: {
      workbenchCapability: { readonlyValidation: { maxRequests: 1, periods: 0, list: 1, detail: 0, versionSkus: 0, workflowSql: 0, maxWorkflowRows: 1, metadata: 0 } }
    }
  })
  await completion(f.ctx)
  await f.login(false)
  const value = await f.business.workbenchQuery({ kind: 'list', query: { periodId: 'offline-period', orderType: 'M' } }, new AbortController().signal)
  expect(JSON.stringify(value)).toContain('offline-plan')
  const before = f.network.length
  await expect(f.business.salesPlanSubmit({}, new AbortController().signal)).rejects.toThrow('本次只读验证未开放草稿或业务写入')
  await expect(f.business.salesPlanAction({}, new AbortController().signal)).rejects.toThrow('本次只读验证未开放草稿或业务写入')
  expect((await f.execute('todo_write', { todos: [] })).isError).toBe(false)
  expect(f.network).toHaveLength(before)
  await record('sales-readonly-protected', {
    value,
    allowedConsumer: 'sales_forecast',
    submit: 'GEA_SALES_READONLY_EFFECT',
    approve: 'GEA_SALES_READONLY_EFFECT',
    network: f.network
  })
})

it.each(salesRoles)('$name gives actual child Sessions the same business preset without undeclared Consumer access', async role => {
  const f = await baseInventoryHarness({ ...(await salesRoleInput(role.id)), sessionId: role.id + '-parent' })
  await completion(f.ctx)
  await f.login()
  const children: unknown[] = []
  const release = f.ctx.on(
    'agent/pre-step',
    async ({ agent }, next) => {
      if (agent !== f.agent) {
        const preset = f.ctx.sessionProjections.stateOf(agent.session, 'agentPreset')
        const denied = await f.execute('mcp__gea-gateway__query_business_data', { consumerCode: 'dealer-inventory-replenishment' }, agent)
        const allowed = await f.query(undefined, agent)
        children.push({ preset, denied, allowed })
      }
      return next()
    },
    { global: true }
  )
  try {
    const result = await f.execute('subagent', { description: '核对原销售范围', prompt: 'Continue with the original Consumer scope and evidence.', run_in_background: false })
    expect(result.isError).toBe(false)
    expect(children).toEqual([expect.objectContaining({ preset: role.id })])
    expect(JSON.stringify(children)).toContain('GEA_MCP_PLATFORM_ARGUMENT_REJECTED')
    expect(JSON.stringify(children)).toContain('42')
    expect(f.network.filter(row => row.path === '/ai/gateway/session').every(row => row.body.consumerCode === role.consumer)).toBe(true)
    await record(role.id + '-child-inheritance', { children, result })
  } finally {
    release()
  }
})
