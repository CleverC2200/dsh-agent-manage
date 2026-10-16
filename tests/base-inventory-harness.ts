/** Production Manage and GEA modules; only the external gateway is replaced. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { onTestFinished, vi } from 'vitest'
import type { BusinessResourceDefinition } from '../src/runtime/business-resources.js'
import type { Deployment } from 'preset-integration-gea/host/business'
import type { CapabilityContract } from 'preset-integration-gea/capability/contract'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { UserAgents } from '../src/runtime/user-agents.js'
import { mountGeaMcp } from '../src/runtime/gea-mcp.js'
import { agentOn, presetHarness, official } from './core-preset-harness.js'

export interface BusinessPresetHarnessInput {
  resource?: BusinessResourceDefinition
  additionalResources?: readonly BusinessResourceDefinition[]
  businessConfig?: Partial<Deployment>
  /** Additional external API responses; actual Business transport and authorization remain unchanged. */
  externalResponse?: (url: URL, init?: RequestInit) => Promise<Response | undefined>
  contract?: CapabilityContract
  seed?: readonly unknown[]
  sessionId?: string
  cwd?: string
  personalAgents?: boolean
}

export async function baseInventoryResource(): Promise<BusinessResourceDefinition> {
  const { profileFor } = await import('preset-integration-gea/host/prompt-policy')
  const profile = profileFor('gea-html-inventory-aqkc')!
  return {
    id: 'gea-html-inventory-aqkc',
    label: '基地库存',
    presetName: profile.presetName,
    description: profile.description,
    root: resolve(import.meta.dirname, '../business-resources/inventory-aqkc'),
    prompt: 'prompt.json',
    capability: 'capability.json',
    profile,
    skillFiles: Object.fromEntries(profile.skills.map(name => [name, `skills/${name === 'inventory-aqkc' ? 'aqkc' : name}/SKILL.md`]))
  }
}

/** Other role tickets supply their actual package resource and contract; the external adapter remains shared. */
export async function baseInventoryHarness(input: BusinessPresetHarnessInput = {}) {
  const { installPromptProfile } = await import('preset-integration-gea/host/prompt-policy')
  const { Business } = await import('preset-integration-gea/host/business')
  const { mountBusinessPrompts } = await import('preset-integration-gea/host/prompt-runtime')
  const { registerGeaTools } = await import('preset-integration-gea/host/agent-tools')
  const { createGatewayMcpService } = await import('preset-integration-gea/host/gateway-mcp-service')
  const { createCapabilityRegistry } = await import('preset-integration-gea/capability/registry')
  const { ctx, home } = await presetHarness({
    importModule: name =>
      name === 'dsh-agent-manage/user-agent-cube'
        ? import('../src/runtime/user-agent-cube.js')
        : name === 'dsh-agent-manage/user-agent-skills'
          ? import('../src/runtime/user-agent-skills.js')
          : official(name)
  })
  const resource = input.resource ?? (await baseInventoryResource())
  const resources = new BusinessResources(ctx, resolve(home, 'selected-resources.json'))
  ctx.provide('agentResources', resources)
  onTestFinished(() => resources.dispose())
  onTestFinished(installPromptProfile(resource.id, resource.profile))
  const releaseResource = await resources.register([{ ...resource, cube: true }, ...(input.additionalResources ?? [])])
  const selection = await resources.select(resource.id, new AbortController().signal, input.cwd)
  const contract = input.contract ?? JSON.parse(await readFile(resolve(resource.root, 'capability.json'), 'utf8'))
  const capabilities = createCapabilityRegistry([
    contract,
    ...(contract.id === 'gea-workbench' ? [] : [{ id: 'gea-workbench', label: '销售计划', maxEffect: 'view' as const, layers: ['read' as const] }])
  ])
  const inputOptions = input
  const base = 'https://gea-fixture.invalid'
  const network: { path: string; body: Record<string, unknown> }[] = []
  let hold: Promise<void> | undefined
  let started: (() => void) | undefined
  vi.stubGlobal('fetch', async (input: string | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const path = url.pathname
    const body = JSON.parse(String(init?.body ?? '{}'))
    init?.signal?.throwIfAborted()
    network.push({ path, body })
    const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
    if (path === '/ai/gateway/session')
      return json({
        success: true,
        result: { accessDecision: { allowed: true }, gatewayContext: { ...body, sessionId: 'fixture-session' }, delegationToken: 'fixture-delegation-secret' }
      })
    if (path === '/ai/gateway/mcp/proxy/resources')
      return json({
        success: true,
        resources: [
          {
            capabilityCode: 'MCP_TOOL:cube:query_business_data',
            resourceCode: 'inv',
            resourceName: 'inv',
            resourceType: 'EXTERNAL_MCP',
            queryTarget: 'inv',
            version: '1',
            maxRows: 100,
            maxBytes: null
          }
        ]
      })
    if (path !== '/ai/gateway/mcp/proxy/mcp') {
      const response = await inputOptions.externalResponse?.(url, init)
      if (response) return response
      throw Error(`UNEXPECTED_EXTERNAL_REQUEST: ${path}`)
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    if (body.method === 'initialize')
      return json({
        jsonrpc: '2.0',
        id: body.id,
        result: { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      })
    if (body.method === 'tools/list')
      return json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'inspect_cube_model',
              description: 'Inspect the authorized model.',
              _meta: { sourceType: 'MCP', sourceCode: 'cube' },
              inputSchema: { type: 'object', properties: {} }
            },
            {
              name: 'query_business_data',
              description: 'Query the authorized model.',
              _meta: { sourceType: 'MCP', sourceCode: 'cube' },
              inputSchema: { type: 'object', properties: { queries: { type: 'array' } } }
            }
          ]
        }
      })
    if (body.method === 'tools/call') {
      started?.()
      if (hold) await Promise.race([hold, new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }))])
      init?.signal?.throwIfAborted()
      const text =
        body.params.name === 'inspect_cube_model'
          ? JSON.stringify({ semanticModel: [{ name: 'inv', measures: [{ name: 'inv.row_count', type: 'number' }] }] })
          : JSON.stringify({
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
                  fields: [{ name: 'inv.row_count', type: 'number' }],
                  rows: [{ 'inv.row_count': 42 }]
                }
              ]
            })
      return json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text }] } })
    }
    throw Error(`UNEXPECTED_MCP_REQUEST: ${body.method}`)
  })
  onTestFinished(() => vi.unstubAllGlobals())
  const business = new Business({
    geaBaseUrl: base,
    environment: 'test',
    geaEnvironments: { test: base, production: 'https://gea-production-fixture.invalid' },
    runtimeDir: home,
    pageSize: 50,
    periodPageSize: 50,
    requestTimeoutMs: 5000,
    modelRequestTimeoutMs: 5000,
    maxSnapshotBytes: 200000,
    analysisMode: 'receipt',
    analysisModel: 'test',
    analysisAgentCode: 'sales_forecast',
    analysisSource: 'receipt',
    cubeMcpCodes: { test: 'cube', production: 'cube' },
    inputByteBudget: 200000,
    ...input.businessConfig
  })
  business.setCapabilities(capabilities)
  onTestFinished(() => business.dispose())
  registerGeaTools(ctx, business, capabilities)
  const userAgents = input.personalAgents ? new UserAgents(ctx, resolve(home, 'user-agents.json')) : undefined
  if (userAgents) {
    ctx.provide('userAgents', userAgents)
    await userAgents.load()
    onTestFinished(() => userAgents.dispose())
  }
  const service = createGatewayMcpService(ctx, business)
  ctx.provide('geaMcp', service)
  await ctx.plugin({ apply: mountGeaMcp })
  const releasePrompts = mountBusinessPrompts(ctx, business, capabilities)
  onTestFinished(releasePrompts)
  const login = async (prepareTools = true) => {
    business.restorePersistentLogin({
      schema: 1,
      base,
      environment: 'test',
      auth: { token: 'fixture-identity-secret', tenantId: '0', id: 'fixture-user', name: 'Fixture', username: 'fixture' }
    })
    if (prepareTools) await ctx.systemPrompt.assemble({ scope: agent, agent } as never)
  }
  const agent = await agentOn(ctx, input.sessionId ?? 'authorized-base', selection.preset, input.seed, input.cwd)
  let call = 0
  const execute = (name: string, arguments_: unknown = {}, subject = agent) =>
    ctx.tools.execute({ callId: `base-${++call}` as never, name, arguments: arguments_, agent: subject, signal: new AbortController().signal })
  const query = (consumerCode?: string, subject = agent) =>
    execute(
      'mcp__gea-gateway__query_business_data',
      { ...(consumerCode ? { consumerCode } : {}), queries: [{ name: 'inv', query: { measures: ['inv.row_count'], limit: 3 } }] },
      subject
    )
  return {
    ctx,
    home,
    userAgents,
    resources,
    selection,
    releaseResource,
    business,
    contract,
    capabilities,
    agent,
    network,
    login,
    execute,
    query,
    block: (gate: Promise<void>, onStart: () => void) => {
      hold = gate
      started = onStart
    }
  }
}
