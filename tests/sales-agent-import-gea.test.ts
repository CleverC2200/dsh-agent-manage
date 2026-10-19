/** Original user assets cross configuration import, native publication and actual GEA gates. */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { AgentSources } from '../src/runtime/agent-sources.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { mountSkillReferenceReader } from '../src/runtime/skill-reference.js'
import { baseInventoryHarness } from './base-inventory-harness.js'
import { agentOn, completion, turn } from './core-preset-harness.js'
import { salesRoleInput } from './sales-role-input.js'

it('imports the original sales instructions and selected Skill into a personal Core Session with only its explicit trusted Cube', async () => {
  const f = await baseInventoryHarness({ ...(await salesRoleInput('gea-readonly')), personalAgents: true })
  const agents = f.userAgents!
  const root = resolve('business-resources/sales-plan')
  const catalog = new Catalog({ userRoot: join(f.home, 'catalog'), dataRoot: join(f.home, 'data'), onChanged: () => {} })
  await catalog.load()
  f.ctx.skills.registerProvider(() => new SuiteSkillProvider(catalog))
  mountSkillReferenceReader(f.ctx)
  const sources = new AgentSources(catalog, agents)
  const discovered = await sources.acquire({ url: root, kind: 'local' })
  const imported = await sources.import({ sourceId: discovered.id, suiteId: 'sales-plan', resourceKey: 'agent:sales-plan' })
  expect(imported).toMatchObject({ origin: 'user', publication: 'ready', customized: false })
  expect(imported.cube).toBeUndefined()
  expect(imported.skills.map(skill => skill.name)).toEqual(['sales-plan-qa'])
  expect(imported.prompt).toContain('预算＝按销售组织核定的组织级月度预算')
  expect(imported.prompt).toContain('历史月份，仅复盘')
  const sourcePrompt = await readFile(join(root, 'agents/sales-plan.md'), 'utf8')
  const sourceSkill = await readFile(join(root, 'skills/sales-plan-qa/SKILL.md'), 'utf8')
  expect(imported.prompt).toBe(sourcePrompt.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim())
  const templates = (await readdir(join(root, 'skills/sales-plan-qa/templates'))).sort()
  expect(templates).toHaveLength(5)
  const previous = await agentOn(f.ctx, 'sales-import-previous', (await agents.select(imported.id)).preset, undefined, f.home)
  const defaultId = f.ctx.agentPresets.defaultId
  await agents.save({ ...imported, prompt: imported.prompt + '\n用户定制：只看华南。' })
  const configured = await agents.saveCube(imported.id, { sourceRef: f.selection.id, enabled: true })
  const personal = await agentOn(f.ctx, 'sales-import-configured', (await agents.select(imported.id)).preset, undefined, f.home)
  const requests = await completion(f.ctx, 262_144, false, undefined, {
    tools: [
      { name: 'skill', arguments: { name: 'sales-plan-qa' } },
      { name: 'skill_reference_read', arguments: { skill: 'sales-plan-qa', path: 'references/cube-query.md' } },
      ...templates.map(file => ({ name: 'skill_reference_read', arguments: { skill: 'sales-plan-qa', path: `templates/${file}`, limit: 2 } })),
      { name: 'mcp__gea-gateway__inspect_cube_model', arguments: {} },
      {
        name: 'mcp__gea-gateway__query_business_data',
        arguments: { action: 'query', response_mode: 'inline_complete', queries: [{ name: 'inv', query: { measures: ['inv.row_count'], limit: 3 } }] }
      }
    ],
    checkpoint: 'Sales Q&A remains read-only.'
  })
  await f.login(false)
  await turn(f.ctx, personal, '按原销售口径读取所选问数 Skill 与查询约定，再查询授权数据。')
  expect(requests[0]?.tools?.map(tool => tool.name)).toEqual(
    expect.arrayContaining(['read', 'write', 'todo_write', 'subagent', 'mcp__gea-gateway__inspect_cube_model', 'mcp__gea-gateway__query_business_data'])
  )
  const transcript = JSON.stringify(requests)
  expect(transcript).toContain('用户定制：只看华南。')
  expect(transcript).toContain('逾期＝未完成全流程审批')
  expect(transcript).toContain('不硬编码旧的 8 条/1000 行约定')
  for (const file of templates) {
    const title = (await readFile(join(root, 'skills/sales-plan-qa/templates', file), 'utf8')).split(/\r?\n/)[0]!
    expect(transcript).toContain(title)
  }
  expect(transcript).toContain('42')
  expect(transcript).not.toContain('fixture-identity-secret')
  expect(f.ctx.tools.schemas(personal).find(tool => tool.name === 'mcp__gea-gateway__query_business_data')?.parameters).toEqual({
    type: 'object',
    properties: { queries: { type: 'array' } }
  })
  expect(new Set(f.network.filter(row => row.path === '/ai/gateway/session').map(row => row.body.consumerCode))).toEqual(new Set(['sales_forecast', 'workbench']))
  expect(f.network.filter(row => row.body.method === 'tools/call').map(row => row.body.params)).toEqual([
    expect.objectContaining({ name: 'inspect_cube_model', arguments: {} }),
    expect.objectContaining({
      name: 'query_business_data',
      arguments: { action: 'query', response_mode: 'inline_complete', queries: [{ name: 'inv', query: { measures: ['inv.row_count'], limit: 3 } }] }
    })
  ])
  expect(f.ctx.tools.schemas(previous).map(tool => tool.name)).not.toContain('mcp__gea-gateway__query_business_data')
  expect(JSON.stringify(await f.execute('gea_workbench_apply', {}, personal))).toContain('GEA_BUSINESS_PROFILE_REQUIRED')
  expect(f.ctx.agentPresets.defaultId).toBe(defaultId)
  expect(configured.customized).toBe(true)
  expect((await sources.import({ sourceId: discovered.id, suiteId: 'sales-plan', resourceKey: 'agent:sales-plan' })).prompt).toContain('用户定制：只看华南。')
  expect(await readFile(join(root, 'agents/sales-plan.md'), 'utf8')).toBe(sourcePrompt)
  expect(await readFile(join(root, 'skills/sales-plan-qa/SKILL.md'), 'utf8')).toBe(sourceSkill)
})
