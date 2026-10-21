import { it } from 'vitest'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountSkillReferenceReader } from '../src/runtime/skill-reference.js'
function fixture() {
  const tools = new Map<string, ReturnType<typeof defineTool>>()
  const reads: string[] = []
  const ctx = {
    effect: (f: () => unknown) => f(),
    inject: (_services: unknown, f: (ctx: unknown) => unknown) => f(ctx),
    tools: {
      register: (tool: ReturnType<typeof defineTool>) => {
        tools.set(tool.name, tool)
        return () => {}
      }
    },
    skills: {
      list: async (_options?: { cwd?: string }): Promise<Array<{ name: string; invocation: { modelInvocable: boolean } }>> => [],
      get: async (): Promise<{ invocation: { modelInvocable: boolean }; resourceBase: { kind: string; path: string }; content: string } | undefined> => ({
        invocation: { modelInvocable: true },
        resourceBase: { kind: 'directory', path: '/suite/skills/scope' },
        content: '先读 [规则](../../references/rules-and-conflicts.md)'
      })
    },
    fs: {
      processPathFromHostPath: (p: string) => p,
      resolve: async (p: string) => ({ displayPath: p }),
      readBytes: async (target: { displayPath: string }) => {
        reads.push(target.displayPath)
        return Buffer.from('规则：按实际期间查询。')
      }
    }
  }
  mountSkillReferenceReader(ctx as never)
  return { tools, reads, ctx }
}

it('forecast can read a Skill local reference without sending file URI to MCP', async () => {
  const { tools, reads } = fixture()
  const tool = tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }
  assert.ok(tool, 'Missing local Skill reference reader: model only has MCP resource reader')
  const result = await tool.execute(
    {
      skill: 'sinian-forecast-scope',
      path: '../../references/rules-and-conflicts.md'
    },
    {
      signal: new AbortController().signal,
      agent: { session: { header: { cwd: '/workspace' } } }
    }
  )
  assert.match(result, /规则：按实际期间查询/)
  assert.deepEqual(reads, ['/suite/references/rules-and-conflicts.md'])
  for (const path of ['../../secret.txt', 'file:///etc/passwd', 'https://example.com', 'data-artifact://gateway/id']) {
    await assert.rejects(() => tool.execute({ skill: 'sinian-forecast-scope', path }, { signal: new AbortController().signal }))
  }
  assert.equal(reads.length, 1)
})

it('reference reader respects current skill visibility, cancellation and paging', async () => {
  const { tools, reads, ctx } = fixture()
  const reader = tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }
  const args = {
    skill: 'reference-scope',
    path: '../../references/rules-and-conflicts.md'
  }
  const signal = new AbortController().signal
  for (const input of [{ offset: 0 }, { limit: 501 }]) await assert.rejects(() => reader.execute({ ...args, ...input }, { signal }))
  const get = ctx.skills.get
  ctx.skills.get = async () => ({
    ...(await get())!,
    invocation: { modelInvocable: false }
  })
  await assert.rejects(() => reader.execute(args, { signal }), /不可用/)
  assert.equal(reads.length, 0)
  ctx.skills.get = get
  ctx.fs.readBytes = async () => Buffer.from('第一行\n第二行\n第三行')
  const result = JSON.parse(await reader.execute({ ...args, offset: 2, limit: 1 }, { signal }))
  assert.equal(result.content, '2\t第二行')
  assert.equal(result.nextOffset, 3)
  assert.equal(result.totalLines, 3)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(() => reader.execute(args, { signal: controller.signal }))
})

it('reads the inline reference paths declared by the supplied inventory Skills', async () => {
  const { tools, ctx, reads } = fixture()
  const reader = tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }
  const signal = new AbortController().signal
  for (const [skill, path] of [
    ['aging-stagnation-monitoring', 'rules.md'],
    ['inventory-policy', 'rules/metric-catalog.md'],
    ['inventory-policy', 'rules/data-access-contract.md']
  ]) {
    const root = resolve('business-resources/inventory-aqkc/skills', skill)
    ctx.skills.get = async () => ({
      invocation: { modelInvocable: true },
      resourceBase: { kind: 'directory', path: root },
      content: await readFile(resolve(root, 'SKILL.md'), 'utf8')
    })
    ctx.fs.readBytes = async target => {
      reads.push(target.displayPath)
      return readFile(target.displayPath)
    }
    const result = JSON.parse(await reader.execute({ skill, path, limit: 10 }, { signal }))
    assert.equal(result.path, resolve(root, path))
    assert.ok(result.totalLines > 0)
    assert.ok(result.content.length > 0)
    const before = reads.length
    for (const denied of ['rules/not-declared.md', '../inventory-policy/rules/metric-catalog.md', '/etc/passwd', 'https://example.com/rules.md'])
      await assert.rejects(() => reader.execute({ skill, path: denied }, { signal }))
    assert.equal(reads.length, before)
  }
})

it('unknown skill gives the current visible catalog instead of another dead end', async () => {
  const { tools, reads, ctx } = fixture()
  ctx.skills.get = async () => undefined
  ctx.skills.list = async (options: { cwd?: string }) => {
    assert.equal(options.cwd, '/workspace')
    return [
      { name: 'sinian-forecast-scope', invocation: { modelInvocable: true } },
      { name: 'hidden-skill', invocation: { modelInvocable: false } }
    ]
  }
  await assert.rejects(
    () =>
      (tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }).execute(
        { skill: 'gea-sales-plan', path: 'SKILL.md' },
        { signal: new AbortController().signal, agent: { session: { header: { cwd: '/workspace' } } } }
      ),
    (error: Error) => /sinian-forecast-scope/.test(error.message) && !/hidden-skill/.test(error.message)
  )
  assert.equal(reads.length, 0)
})

it('does not return a reference after its installed Skill owner is withdrawn during a read', async () => {
  const { tools, ctx } = fixture()
  ctx.fs.readBytes = async () => {
    ctx.skills.get = async () => undefined
    return Buffer.from('old owner body')
  }
  await assert.rejects(
    () =>
      (tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }).execute(
        { skill: 'reference-scope', path: '../../references/rules-and-conflicts.md' },
        { signal: new AbortController().signal }
      ),
    /AGENT_RESOURCE_OWNER_CHANGED/
  )
})
it('rejects binary, invalid UTF8 and excessive selected reference contents', async () => {
  const { tools, ctx } = fixture()
  const reader = tools.get('skill_reference_read')! as unknown as { execute(args: unknown, exec: unknown): Promise<string> }
  const args = { skill: 'reference-scope', path: '../../references/rules-and-conflicts.md' }
  for (const content of [Buffer.from([0xff]), Buffer.from('binary\0body'), Buffer.from('x'.repeat(32001))]) {
    ctx.fs.readBytes = async () => content
    await assert.rejects(() => reader.execute(args, { signal: new AbortController().signal }))
  }
})
