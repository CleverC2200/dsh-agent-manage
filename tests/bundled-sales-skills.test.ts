/** Cold-start production Manage registration without external marketplace/Home assets. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, realpath } from 'node:fs/promises'
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
  const { agentOn, completion, presetHarness } = await import('./core-preset-harness.js')
  const { ctx } = await presetHarness({ fullManage: true, home: isolatedHome })
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
  const release = await ctx.agentResources.register([{ id: 'gea-readonly', label: profile.label, root, prompt: 'presets/prompt-policy.json', profileKey: 'gea-readonly', profile }])
  onTestFinished(release)
  const sales = (await ctx.agentResources.list(options)).find(resource => resource.id === 'gea-readonly')
  expect(sales?.missingSkills).toBeUndefined()
  expect(sales?.enabled).toBe(true)
  const selection = await ctx.agentResources.select('gea-readonly', options.signal, isolatedHome)
  expect(selection.profile?.consumerCode).toBe('sales_forecast')
  await completion(ctx)
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
})
