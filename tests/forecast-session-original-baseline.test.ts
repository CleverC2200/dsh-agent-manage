import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { Catalog } from '../src/application/catalog.js'
import { stripFrontmatter } from '../src/catalog/skills-parse.js'
import { forecastInputHash, forecastBaselineHash } from '../src/runtime/forecast-source.js'
import * as Manage from '../src/index.js'

import { official } from './core-preset-harness.js'
const { Context } = await official('@deepseek-ai/cordis')
const { default: Tools } = await official('@deepseek-ai/dsh-tools')
const { default: SystemPrompt } = await official('@deepseek-ai/dsh-system-prompt')
const { default: Skills } = await official('@deepseek-ai/dsh-skill')
const { createScope } = await official('@deepseek-ai/dsh-scope')
const { Session, SessionId } = await official('@deepseek-ai/dsh-session')
const { createUserMessage } = await official('@deepseek-ai/dsh-llm')

test('Manage entry registers pure calculation for an official Session and the unchanged original baseline suite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'forecast-original-session-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  vi.stubEnv('DSH_HOME', root)
  t.onTestFinished(() => vi.unstubAllEnvs())
  let network = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    network++
    throw Error('No network allowed in pure Session calculation')
  })
  t.onTestFinished(() => vi.restoreAllMocks())
  const source = fileURLToPath(new URL('../business-resources/sinian-demand-forecast/', import.meta.url))
  const provenance = JSON.parse(await readFile(join(source, 'SOURCE.json'), 'utf8'))
  assert.equal(provenance.commit, '374a0ab62eee184d3edb3a99e594836ee685534f')
  for (const [file, hash] of Object.entries(provenance.files)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(source, file)))
        .digest('hex'),
      hash,
      file
    )
  }
  const skillPath = join(source, 'skills/sinian-demand-baseline/SKILL.md')
  const original = await readFile(skillPath, 'utf8')
  const originalHash = createHash('sha256').update(original).digest('hex')
  const catalog = new Catalog({ userRoot: join(root, 'agent-plugins'), dataRoot: join(root, 'agent-plugins/data'), onChanged: () => {} })
  await catalog.load()
  await catalog.mergeSources([{ id: 'original-company', url: source, local: true }])
  await catalog.install('original-company', 'sinian-demand-forecast')

  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  await ctx.plugin(Skills)
  t.onTestFinished(() => ctx.fiber.dispose())
  // Inert host services complete the normal Manage entry injection. No GEA, LLM or Agent Task is mounted.
  ctx.provide('commands', { register: () => () => {} })
  ctx.provide('agentPresets', { register: async () => async () => {}, resolve: async () => undefined })
  ctx.provide('connection', { fetch: { register: () => () => {} } })
  ctx.provide('fs', {})
  await ctx.plugin(Manage, { geaMcp: false, sources: [{ id: 'original-company', url: source, local: true }] })
  const id = SessionId('session-44444444-4444-4444-8444-444444444444')
  const agent = { id, ctx: undefined as unknown, session: Session.create(id, [], { ...Session.create(id).header, cwd: root }) }
  agent.ctx = createScope(ctx, agent).ctx
  const baseline = await ctx.skills.get('sinian-demand-baseline', { scope: agent, cwd: root })
  assert.ok(baseline)
  assert.equal(baseline.content, stripFrontmatter(original))
  assert.equal(baseline.path, skillPath)
  const reference = JSON.parse(await readFile(new URL('./fixtures/forecast-v2-reference.json', import.meta.url), 'utf8'))
  const input = structuredClone(reference.cases[0].input)
  for (const row of input.records)
    for (const field of ['base_plan_qty', 'base_actual_to_cutoff_qty', 'prior_base_actual_qty', 'prior_target_actual_qty', 'target_yoy_growth', 'target_mom_growth'])
      row[field] = String(row[field])
  const execute = async (args = input, signal = new AbortController().signal) => {
    const response = await ctx.tools.execute({ callId: 'original-baseline-pure', name: 'forecast_compute', arguments: args, agent, signal })
    assert.equal(response.isError, false, JSON.stringify(response))
    return JSON.parse(response.content.find(block => block.type === 'text').text)
  }
  const noMessage = await execute()
  assert.equal(noMessage.source.userInputVerified, false)
  agent.session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'fixture' }, content: [{ type: 'text', text: JSON.stringify(input) }] }), {
    surfaceOp: 'append'
  })
  assert.equal((await execute()).source.userInputVerified, false)
  const event = agent.session.append(
    'user/message',
    createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '按此 mock 输入做纯计算，不连接系统。\n' + JSON.stringify(input) }] }),
    { surfaceOp: 'append' }
  )
  const result = await execute()
  assert.equal(result.source.userInputVerified, true)
  assert.equal(result.source.inputHash, forecastInputHash(input))
  assert.equal(result.source.baselineHash, forecastBaselineHash(baseline))
  assert.equal(result.source.businessAuthorization, false)
  assert.equal(result.source_verified_by_calculator, false)
  assert.equal(result.calculator_version, 'gea-v2-5.5-decimal-1')
  assert.equal(result.rows.length, input.records.length)
  assert.deepEqual(result.rows, noMessage.rows)
  assert.equal(result.rows[0].forecast1, '1500')
  assert.equal(result.rows[0].forecast2, '1260')
  assert.equal(result.external_writes, false)
  assert.equal(agent.session.snapshotEvents().find(item => item.seq === event.seq).data.source.kind, 'user')
  const changed = structuredClone(input)
  changed.records[0].base_plan_qty = '1001'
  assert.equal((await execute(changed)).source.userInputVerified, false)
  const controller = new AbortController()
  controller.abort()
  const cancelled = await ctx.tools.execute({ callId: 'cancelled-pure', name: 'forecast_compute', arguments: input, agent, signal: controller.signal })
  assert.equal(cancelled.isError, true)
  assert.equal(network, 0)
  assert.equal(
    createHash('sha256')
      .update(await readFile(skillPath, 'utf8'))
      .digest('hex'),
    originalHash
  )
  assert.equal(agent.session.header.cwd, root)
})
