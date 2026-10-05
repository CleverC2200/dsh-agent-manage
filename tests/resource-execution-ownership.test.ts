import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Catalog } from '../src/application/catalog.js'
import { SuiteSkillProvider } from '../src/runtime/skills-provider.js'
import { createForecastTool } from '../src/runtime/forecast-compute.js'

// Use the registered standard artifacts directly; no historical Core alias or cross-repository build output.
const official = (path: string) => new URL(`../../../official-latest-standard/${path}`, import.meta.url).href
const { Context } = await import(official('vendor/cordis/lib/index.js'))
const { default: Tools } = await import(official('packages/core/tools/lib/index.js'))
const { default: SystemPrompt } = await import(official('packages/core/system-prompt/lib/index.js'))
const { default: Skills } = await import(official('packages/skill/skill/lib/index.js'))
const { createScope } = await import(official('packages/core/scope/lib/index.js'))
const { Session, SessionId } = await import(official('packages/core/session/lib/index.js'))

test('the fixed official Skill and tool registries execute Manage computation only for an actually enabled Catalog suite', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manage-actual-registry-'))
  t.onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(join(source, 'skills', 'sinian-demand-baseline'), {
    recursive: true
  })
  await writeFile(
    join(source, 'plugin.json'),
    JSON.stringify({
      name: 'forecast-fixture',
      version: '1.0.0',
      skills: './skills'
    })
  )
  const original = '---\nname: sinian-demand-baseline\ndescription: Known baseline\n---\nExact baseline fixture body\n'
  await writeFile(join(source, 'skills', 'sinian-demand-baseline', 'SKILL.md'), original)
  let control
  const catalog = new Catalog({
    userRoot: join(root, 'user'),
    dataRoot: join(root, 'data'),
    onChanged: () => control?.invalidate()
  })
  await catalog.load()
  await catalog.mergeSources([{ id: 'fixture', url: source, local: true }])
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  await ctx.plugin(Skills)
  t.onTestFinished(() => ctx.fiber.dispose())
  let runtime
  await ctx.plugin(
    Object.assign(
      host => {
        host.skills.registerProvider(current => {
          control = current
          return new SuiteSkillProvider(catalog)
        })
        host.tools.register(createForecastTool(host.skills))
        runtime = host
      },
      { inject: ['skills', 'tools'] }
    )
  )
  const id = SessionId('session-33333333-3333-4333-8333-333333333333')
  const agent = {
    id,
    ctx: undefined as unknown,
    session: Session.create(id, [], {
      ...Session.create(id).header,
      cwd: root
    })
  }
  agent.ctx = createScope(runtime, agent).ctx
  const reference = JSON.parse(await readFile(new URL('./fixtures/forecast-v2-reference.json', import.meta.url), 'utf8'))
  const input = structuredClone(reference.cases[0].input)
  for (const row of input.records)
    for (const field of ['base_plan_qty', 'base_actual_to_cutoff_qty', 'prior_base_actual_qty', 'prior_target_actual_qty', 'target_yoy_growth', 'target_mom_growth'])
      row[field] = String(row[field])
  const execute = () =>
    runtime.tools.execute({
      callId: 'pure-calculation',
      name: 'forecast_compute',
      arguments: input,
      agent,
      signal: new AbortController().signal
    })
  const absent = await execute()
  assert.equal(absent.isError, true)
  assert.match(JSON.stringify(absent), /FORECAST_CAPABILITY_DISABLED/)
  await catalog.install('fixture', 'forecast-fixture')
  assert.equal(
    (
      await runtime.skills.get('sinian-demand-baseline', {
        scope: agent,
        cwd: root
      })
    ).content,
    'Exact baseline fixture body\n'
  )
  const enabled = await execute()
  assert.equal(enabled.isError, false, JSON.stringify(enabled))
  const result = JSON.parse(enabled.content.find(block => block.type === 'text').text)
  assert.equal(result.source_verified_by_calculator, false)
  assert.equal(result.source.businessAuthorization, false)
  assert.equal(result.calculator_version, 'gea-v2-5.5-decimal-1')
  await catalog.setEnabled('fixture', 'forecast-fixture', false)
  assert.equal(
    await runtime.skills.get('sinian-demand-baseline', {
      scope: agent,
      cwd: root
    }),
    undefined
  )
  assert.equal((await execute()).isError, true)
})
