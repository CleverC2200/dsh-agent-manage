/** Cold-start production Manage registration without external marketplace/Home assets. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'
import { stripFrontmatter } from '../src/catalog/skills-parse.js'

it('ships the unchanged complete sales suite and resolves its linked assets inside the package', async () => {
  const root = resolve('business-resources/sinian-demand-forecast')
  const source = JSON.parse(await readFile(join(root, 'SOURCE.json'), 'utf8'))
  expect(source.commit).toBe('374a0ab62eee184d3edb3a99e594836ee685534f')
  for (const [file, digest] of Object.entries(source.files)) {
    expect(
      createHash('sha256')
        .update(await readFile(join(root, file)))
        .digest('hex'),
      file
    ).toBe(digest)
    if (!file.endsWith('/SKILL.md')) continue
    const text = await readFile(join(root, file), 'utf8')
    for (const match of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
      const reference = match[1]!.split('#')[0]!
      if (/^[a-z][a-z\d+.-]*:/i.test(reference)) continue
      const target = await realpath(resolve(dirname(join(root, file)), reference))
      expect(target.startsWith(root + sep), reference).toBe(true)
    }
  }
  const { stdout } = await promisify(execFile)('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: resolve('.'), maxBuffer: 4 * 1024 * 1024 })
  const packaged = new Set(JSON.parse(stdout)[0].files.map((file: { path: string }) => file.path))
  for (const file of Object.keys(source.files)) expect(packaged.has(`business-resources/sinian-demand-forecast/${file}`), file).toBe(true)
  for (const file of (await readdir('business-resources/sales-plan', { recursive: true })).filter(file => file.endsWith('.md'))) {
    expect(packaged.has(`business-resources/sales-plan/${file}`), file).toBe(true)
  }
  for (const file of [
    'prompt.md',
    'skills/frozen-food-sales-operations-diagnosis/SKILL.md',
    'skills/frozen-food-base-inventory-insight/SKILL.md',
    'skills/prototype-html/SKILL.md',
    'skills/prototype-html/assets/example.html'
  ]) {
    expect(packaged.has(`business-resources/orchestration/${file}`), file).toBe(true)
  }
})

it('registers all four sales Skills at empty-home startup and selects the original GEA role with complete standard capabilities', async () => {
  const isolatedHome = process.env.MANAGE_SALES_HOME
  if (!isolatedHome) {
    const home = await mkdtemp(join(tmpdir(), 'manage-sales-'))
    onTestFinished(() => rm(home, { recursive: true, force: true }))
    const output = await promisify(execFile)(
      process.execPath,
      [resolve('node_modules/vitest/vitest.mjs'), 'run', 'tests/bundled-sales-skills.test.ts', '-t', 'registers all four'],
      {
        cwd: resolve('.'),
        env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), MANAGE_SALES_HOME: home },
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024
      }
    )
    expect(output.stdout).toContain('1 passed')
    return
  }
  const { agentOn, completion, presetHarness, turn } = await import('./core-preset-harness.js')
  const fixture = await presetHarness({ fullManage: true, home: isolatedHome })
  const { ctx } = fixture
  const request = async (path: string, value?: unknown) => {
    const response = await ctx.connection
      .createSharedFetchHandler('/api')
      .fetch(
        new Request(
          `http://localhost/api/agent-manage/agents${path}`,
          value === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
        )
      )
    expect(response.status).toBe(200)
    return response.json()
  }
  const configuration = (await request('/plugins')).find((row: { id: string }) => row.id === 'auto-negotiation')
  const originalPrompt = await readFile('business-resources/orchestration/prompt.md', 'utf8')
  expect(configuration).toMatchObject({ name: '智能编排', preset: 'auto-negotiation', origin: 'plugin', publication: 'ready', enabled: true, prompt: originalPrompt })
  expect(configuration.skills.map((skill: { name: string }) => skill.name).sort()).toEqual([
    'frozen-food-base-inventory-insight',
    'frozen-food-sales-operations-diagnosis',
    'prototype-html'
  ])
  expect(originalPrompt).toContain('`frozen-food-base-inventory-insight`技能进行基地库存诊断分析')
  expect(originalPrompt).toContain('`frozen-food-sales-operations-diagnosis`技能进行产销协同全环节诊断分析')
  const originalDefault = ctx.agentPresets.defaultId
  const sources = await ctx.connection.createSharedFetchHandler('/api').fetch(new Request('http://localhost/api/agent-manage/agent-sources'))
  expect(await sources.json()).toContainEqual(
    expect.objectContaining({
      id: 'bundled-sales-plan',
      kind: 'local',
      errors: [],
      candidates: [expect.objectContaining({ suiteId: 'sales-plan', resourceKey: 'agent:sales-plan', name: '销售计划助手' })]
    })
  )
  expect(await ctx.userAgents.list()).toEqual([])
  const root = resolve('../dsh-gea-plugin')
  const policy = JSON.parse(await readFile(join(root, 'presets/prompt-policy.json'), 'utf8'))
  const profile = policy.profiles['gea-readonly']
  expect(profile.skills).toHaveLength(4)
  const options = { cwd: isolatedHome, signal: new AbortController().signal }
  const listed = await ctx.skills.list(options)
  for (const name of profile.skills) {
    expect(listed.filter(skill => skill.name === name)).toHaveLength(1)
    const skill = await ctx.skills.get(name, options)
    const file = resolve(`business-resources/sinian-demand-forecast/skills/${name}/SKILL.md`)
    expect(skill?.content).toBe(stripFrontmatter(await readFile(file, 'utf8')))
    expect(skill?.resourceBase).toEqual({ kind: 'directory', path: dirname(file) })
  }
  await completion(ctx)
  const orchestration = await agentOn(ctx, 'orchestration-skills', 'auto-negotiation', undefined, isolatedHome)
  const scopedOptions = { ...options, scope: orchestration }
  const orchestrationSkills = await ctx.skills.list(scopedOptions)
  expect(listed.some(skill => skill.name === 'sinian-forecast-scope' && skill.invocation.modelInvocable)).toBe(true)
  expect(orchestrationSkills.filter(skill => skill.name === 'sinian-forecast-scope')).toHaveLength(1)
  expect(orchestrationSkills.find(skill => skill.name === 'sinian-forecast-scope')?.invocation.modelInvocable).toBe(false)
  for (const name of ['frozen-food-sales-operations-diagnosis', 'frozen-food-base-inventory-insight', 'prototype-html']) {
    expect(orchestrationSkills.filter(skill => skill.name === name)).toHaveLength(1)
    const file = resolve(`business-resources/orchestration/skills/${name}/SKILL.md`)
    const skill = await ctx.skills.get(name, scopedOptions)
    expect(skill?.content.replace(/\r\n/g, '\n').trim()).toBe(
      stripFrontmatter(await readFile(file, 'utf8'))
        .replace(/\r\n/g, '\n')
        .trim()
    )
    expect(skill?.resourceBase?.kind).toBe('directory')
    if (name === 'prototype-html' && skill?.resourceBase?.kind === 'directory') {
      expect(await readFile(join(skill.resourceBase.path, 'assets/example.html'), 'utf8')).toBe(
        await readFile(resolve('business-resources/orchestration/skills/prototype-html/assets/example.html'), 'utf8')
      )
    }
  }
  await turn(ctx, orchestration, '准备诊断当前范围。')
  const systemMessages = orchestration.session.snapshotEvents().filter(event => event.type === 'system/message')
  expect(JSON.stringify(systemMessages)).toContain('frozen-food-sales-operations-diagnosis')
  expect(JSON.stringify(systemMessages)).toContain('frozen-food-base-inventory-insight')
  expect(JSON.stringify(systemMessages)).toContain('prototype-html')
  expect(JSON.stringify(systemMessages)).toContain('米面冻品行业的专属COO')
  const release = await ctx.agentResources.register([{ id: 'gea-readonly', label: profile.label, root, prompt: 'presets/prompt-policy.json', profileKey: 'gea-readonly', profile }])
  onTestFinished(release)
  const sales = (await ctx.agentResources.list(options)).find(resource => resource.id === 'gea-readonly')
  expect(sales?.missingSkills).toBeUndefined()
  expect(sales?.enabled).toBe(true)
  const selection = await ctx.agentResources.select('gea-readonly', options.signal, isolatedHome)
  expect(selection.profile?.consumerCode).toBe('sales_forecast')
  const standard = await agentOn(ctx, 'sales-standard', 'standard', undefined, isolatedHome)
  const selected = await agentOn(ctx, 'sales-selected', selection.preset, undefined, isolatedHome)
  const tools = (agent: typeof standard) =>
    ctx.tools
      .schemas(agent)
      .map(tool => tool.name)
      .sort()
  expect(tools(selected)).toEqual(tools(standard))
  expect(tools(selected).length).toBeGreaterThan(20)
  expect(ctx.commands.list(selected)).toEqual(ctx.commands.list(standard))
  expect(ctx.commands.list(selected).map(command => command.name)).toContain('compact')
  expect(ctx.agentPresets.serviceFor(selected, 'compaction')?.constructor.name).toBe('BasicCompactionEngine')
  expect(tools(orchestration)).toEqual(tools(standard))
  const prototypeReference = await ctx.tools.execute({
    callId: 'orchestration-prototype-reference' as never,
    name: 'skill_reference_read',
    arguments: { skill: 'prototype-html', path: 'assets/example.html', limit: 2 },
    agent: orchestration,
    signal: options.signal
  })
  expect(prototypeReference.isError).toBe(false)
  expect(JSON.stringify(prototypeReference)).toContain('<!DOCTYPE html>')
  const reference = await ctx.tools.execute({
    callId: 'bundled-sales-reference' as never,
    name: 'skill_reference_read',
    arguments: { skill: 'sinian-forecast-scope', path: '../../references/rules-and-conflicts.md', limit: 2 },
    agent: selected,
    signal: options.signal
  })
  expect(reference.isError).toBe(false)
  expect(JSON.stringify(reference)).toContain('rules-and-conflicts.md')
  expect(JSON.stringify(reference)).toContain((await readFile(resolve('business-resources/sinian-demand-forecast/references/rules-and-conflicts.md'), 'utf8')).split('\n')[0])
  const personalizedPrompt = 'PERSONAL_ORCHESTRATION_PROMPT'
  expect(await request('/plugin/save', { id: 'auto-negotiation', prompt: personalizedPrompt })).toMatchObject({
    prompt: personalizedPrompt,
    customized: true,
    preset: 'auto-negotiation'
  })
  const edited = await agentOn(ctx, 'orchestration-personalized', 'auto-negotiation', undefined, isolatedHome)
  await turn(ctx, edited, '读取当前配置。')
  expect(JSON.stringify(edited.session.snapshotEvents())).toContain(personalizedPrompt)
  await turn(ctx, orchestration, '继续原会话。')
  expect(JSON.stringify(orchestration.session.snapshotEvents())).not.toContain(personalizedPrompt)
  const savedSkills = await request('/plugin/skills', {
    id: 'auto-negotiation',
    skills: configuration.skills.map((skill: { name: string }) => ({ ...skill, enabled: skill.name !== 'prototype-html' }))
  })
  expect(savedSkills.skills.find((skill: { name: string }) => skill.name === 'prototype-html').enabled).toBe(false)
  const scoped = await agentOn(ctx, 'orchestration-selected-skills', 'auto-negotiation', undefined, isolatedHome)
  expect(savedSkills).toMatchObject({ publication: 'ready' })
  await turn(ctx, scoped, '应用当前技能配置。')
  expect((await ctx.skills.get('prototype-html', { ...options, scope: scoped }))?.invocation.modelInvocable).toBe(false)
  expect(await request('/plugin/enabled', { id: 'auto-negotiation', enabled: false })).toMatchObject({ enabled: false, publication: 'disabled', prompt: personalizedPrompt })
  await expect(ctx.agentPresets.resolve('auto-negotiation')).rejects.toThrow('Unknown agent preset')
  expect(await request('/plugin/enabled', { id: 'auto-negotiation', enabled: true })).toMatchObject({ enabled: true, publication: 'ready', prompt: personalizedPrompt })
  expect(ctx.agentPresets.defaultId).toBe(originalDefault)
  await ctx.fiber.dispose()
  const restarted = await fixture.start()
  const restored = (await restarted.agentResources.pluginAgents()).find(row => row.id === 'auto-negotiation')!
  expect(restored).toMatchObject({ name: '智能编排', preset: 'auto-negotiation', prompt: personalizedPrompt, enabled: true, publication: 'ready' })
  expect(restored.skills.find(skill => skill.name === 'prototype-html')?.enabled).toBe(false)
  expect(restarted.agentPresets.defaultId).toBe(originalDefault)
})
