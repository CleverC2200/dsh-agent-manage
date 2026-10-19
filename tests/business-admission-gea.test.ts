/** Real Core Sessions and tool assembly; no business transport or real model is used. */
import { expect, it, onTestFinished } from 'vitest'
import { resolve } from 'node:path'
import { agentOn, completion, official, presetHarness, record, turn } from './core-preset-harness.js'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { baseInventoryResource } from './base-inventory-harness.js'

async function fixture() {
  const { mountBusinessPrompts } = await import('preset-integration-gea/host/prompt-runtime')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const { defineTool } = await official('@deepseek-ai/dsh-tools')
  const { ctx, home } = await presetHarness({ companyBundle: 'absent', selectedDefault: 'minimal' })
  const resources = new BusinessResources(ctx, resolve(home, 'selected-resources.json'))
  ctx.provide('agentResources', resources)
  onTestFinished(() => resources.dispose())
  await resources.register([await baseInventoryResource()])
  const calls: string[] = []
  for (const name of ['gea_page', 'gea_visible_workbench_context', 'mcp__gea-gateway__query_business_data', 'mcp__cube_new_test__query_business_data'])
    onTestFinished(
      ctx.tools.register(
        defineTool({
          name,
          description: name,
          parameters: {},
          output: { schema: { type: 'string' }, render: (_args: unknown, value: string) => [{ type: 'text', text: value }] },
          isConcurrencySafe: () => true,
          execute: async () => {
            calls.push(name)
            return '{}'
          }
        })
      )
    )
  const business = {
    config: { runtimeDir: home, analysisAgentCode: 'sales_forecast' },
    watchIdentity: () => () => {},
    status: () => ({ authenticated: false }),
    surfaceFor: () => undefined,
    currentPageIdentity: () => undefined,
    readTurnRevision: () => 0,
    assertExecutionAllowed: () => {},
    turnStopKind: () => undefined
  }
  onTestFinished(mountBusinessPrompts(ctx, business as never, createCapabilityRegistry([])))
  const execute = (name: string, agent?: Awaited<ReturnType<typeof agentOn>>) =>
    ctx.tools.execute({ callId: name as never, name, arguments: {}, agent, signal: new AbortController().signal })
  return { ctx, home, resources, calls, execute }
}

it('ordinary Skill Sessions hide gated GEA tools, retain independent MCP and report their actual preset', async () => {
  const f = await fixture()
  const requests = await completion(f.ctx)
  const agent = await agentOn(f.ctx, 'ordinary-business-question', 'standard')
  const defaultBefore = f.ctx.agentPresets.defaultId
  const skill = await f.ctx.skills.get('inventory-aqkc', { scope: agent, cwd: f.home })
  expect(skill?.content).toContain('先确定任务和可用证据')
  await turn(f.ctx, agent, 'Explain the safe-stock metric without business data.')
  const names = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(names).toContain('todo_write')
  expect(names).toContain('gea_runtime_diagnose')
  expect(names).toContain('mcp__cube_new_test__query_business_data')
  expect(names).not.toContain('gea_page')
  expect(names).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain('当前实际会话预设未声明 GEA 业务身份')
  const diagnostic = await f.execute('gea_runtime_diagnose', agent)
  expect(JSON.parse(String(diagnostic.value))).toMatchObject({ preset: 'standard', businessProfileDeclared: false })
  expect(diagnostic.isError).toBe(false)
  expect(JSON.stringify(await f.execute('gea_page', agent))).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(f.calls).toEqual([])
  expect(f.ctx.agentPresets.defaultId).toBe(defaultBefore)
  await record('ordinary-business-admission', { names, diagnostic, realBusinessQueries: 0 })
})

it('selected inventory Sessions hide Cube without a current identity and diagnose an unbound page and absent calling Agent separately', async () => {
  const f = await fixture()
  const selection = await f.resources.select('gea-html-inventory-aqkc', new AbortController().signal)
  const agent = await agentOn(f.ctx, 'inventory-unbound', selection.preset)
  const requests = await completion(f.ctx)
  await turn(f.ctx, agent, 'Explain the current page limitations.')
  const names = requests.at(-1)?.tools?.map(row => row.name) ?? []
  expect(names).not.toContain('mcp__gea-gateway__query_business_data')
  expect(names).not.toContain('gea_page')
  const diagnostic = await f.execute('gea_runtime_diagnose', agent)
  expect(JSON.parse(String(diagnostic.value))).toMatchObject({
    consumerCode: 'base-safety-stock',
    mcpAccess: { error: 'GEA_IDENTITY_REQUIRED' },
    pageBound: false,
    businessAuthorization: 'not-checked'
  })
  expect(JSON.stringify(await f.execute('gea_page', agent))).toContain('PAGE_NOT_BOUND')
  expect(JSON.stringify(await f.execute('gea_page'))).toContain('CALLING_AGENT_MISSING')
  expect(f.calls).toEqual([])
  await record('inventory-unbound-admission', { names, diagnostic, realBusinessQueries: 0 })
})

it('a named child of an ordinary Session inherits the actual ordinary preset and gains no business Consumer', async () => {
  const f = await fixture()
  await completion(f.ctx)
  const parent = await agentOn(f.ctx, 'ordinary-parent', 'standard')
  const children: unknown[] = []
  onTestFinished(
    f.ctx.on(
      'agent/pre-step',
      async ({ agent }, next) => {
        if (agent !== parent) children.push({ diagnostic: JSON.parse(String((await f.execute('gea_runtime_diagnose', agent)).value)), denied: await f.execute('gea_page', agent) })
        return next()
      },
      { global: true }
    )
  )
  const result = await f.ctx.tools.execute({
    callId: 'inventory-role-child' as never,
    name: 'subagent',
    arguments: { description: '基地库存经营分析 Agent', prompt: 'Explain the inventory rules.', run_in_background: false },
    agent: parent,
    signal: new AbortController().signal
  })
  expect(result.isError).toBe(false)
  expect(children).toHaveLength(1)
  expect(JSON.stringify(children)).toContain('"preset":"standard"')
  expect(JSON.stringify(children)).toContain('"parentSessionId":"ordinary-parent"')
  expect(JSON.stringify(children)).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(f.calls).toEqual([])
  await record('ordinary-child-business-admission', { children, realBusinessQueries: 0 })
})

it('a custom persona retains its preset and only sanitized tool error metadata is exposed', async () => {
  const f = await fixture()
  const { composeStandardPreset } = await import('../src/runtime/standard-preset.js')
  const document = await composeStandardPreset(
    f.ctx.agentPresets,
    { id: 'user-business-mode', name: '经营分析模式', description: 'User persona' },
    { personaPrefix: '你是基地库存经营分析 Agent。' }
  )
  onTestFinished(await f.ctx.agentPresets.register(document))
  const agent = await agentOn(f.ctx, 'custom-business-question', 'user-business-mode')
  const { createToolResultMessage } = await official('@deepseek-ai/dsh-llm')
  agent.session.append('tool/call', {
    turn: 1,
    step: 1,
    callId: 'external-error' as never,
    name: 'mcp__cube_new_test__query_business_data',
    arguments: '{"private":"hidden-parameters"}'
  })
  agent.session.append(
    'tool/result',
    {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: 'external-error' as never,
        content: [{ type: 'text', text: 'MCP_INVALID_ARGUMENTS: hidden-business-body; hidden-credential' }],
        isError: true
      })
    },
    { surfaceOp: 'append' }
  )
  const diagnostic = await f.execute('gea_runtime_diagnose', agent)
  const value = JSON.parse(String(diagnostic.value))
  expect(value).toMatchObject({
    preset: 'user-business-mode',
    consumerCode: null,
    businessProfileDeclared: false,
    recentToolErrors: [{ toolName: 'mcp__cube_new_test__query_business_data', code: 'MCP_INVALID_ARGUMENTS' }]
  })
  expect(String(diagnostic.value)).not.toMatch(/hidden-business-body|hidden-credential|hidden-parameters/)
  expect(JSON.stringify(await f.execute('gea_page', agent))).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(f.calls).toEqual([])
  await record('custom-preset-business-admission', { diagnostic: value, realBusinessQueries: 0 })
})
