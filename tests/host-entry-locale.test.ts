import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import { apply, Config } from '../src/index.js'
import { createUserPanelStores } from '../src/runtime/user-panels.js'

const roots: string[] = []
const cleanups: Array<() => void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

interface PersonalCommand {
  name: string
  handler(invocation: { agent: unknown; rawInput: string }): { kind: string; text: string }
}

async function mountPersonalPanel(locale: string): Promise<{ provider: SkillProvider; commands: Map<string, PersonalCommand> }> {
  const root = await mkdtemp(join(tmpdir(), 'manage-host-locale-'))
  roots.push(root)
  vi.stubEnv('DSH_HOME', root)
  await writeFile(join(root, 'settings.yaml'), `locale:\n  preference: '${locale}'\n`)
  const stores = createUserPanelStores(join(root, 'agent-plugins'))
  await stores.skills.create('personal-probe', '---\ndescription: Explain PROBE-RULE-42\n---\nPrivate rule body')
  await stores.commands.create('review', '---\ndescription: Review notes\n---\nReview $ARGUMENTS')
  const providers: SkillProvider[] = []
  const commands = new Map<string, PersonalCommand>()
  const context = {
    inject: () => {},
    commands: {
      register: (definition: PersonalCommand) => {
        commands.set(definition.name, definition)
        return () => commands.delete(definition.name)
      }
    },
    skills: {
      registerProvider: (create: (control: { signal: AbortSignal; invalidate(): void }) => SkillProvider) => {
        providers.push(create({ signal: new AbortController().signal, invalidate() {} }))
        return () => {}
      }
    },
    effect: (effect: () => () => void) => cleanups.push(effect()),
    on: () => () => {},
    logger: { warn() {} }
  }
  await apply(context as never, Config({ geaMcp: false, scanProjectLayouts: false, sources: [] }))
  return { provider: providers.find(provider => provider.name === 'user-panel')!, commands }
}

describe('host entry personal Skill metadata', () => {
  it.each([
    ['zh', '[用户技能] Explain PROBE-RULE-42'],
    ['en-US', '[user skill] Explain PROBE-RULE-42']
  ])('publishes the original description in the host language (%s)', async (locale, description) => {
    const { provider } = await mountPersonalPanel(locale)
    await expect.poll(async () => (await provider.list({})).map(candidate => candidate.description)).toEqual([description])
    const [candidate] = await provider.list({})
    expect((await provider.get(candidate!, {}))?.content).toBe('Private rule body')
  })
})

describe('host entry personal command messages', () => {
  it.each([
    ['zh', '[用户技能] Explain PROBE-RULE-42', '[用户快捷命令 /review]\n\nReview monthly notes', '/review 已转交模型执行'],
    ['en-US', '[user skill] Explain PROBE-RULE-42', '[User quick command /review]\n\nReview monthly notes', '/review forwarded to the model for execution']
  ])('keeps the command name in the title and acknowledgement (%s)', async (locale, description, message, acknowledgement) => {
    const { provider, commands } = await mountPersonalPanel(locale)
    await expect.poll(async () => (await provider.list({}))[0]?.description).toBe(description)
    await expect.poll(() => commands.has('review')).toBe(true)
    const messages: unknown[] = []
    const result = commands.get('review')!.handler({ agent: { followup: (value: unknown) => messages.push(value) }, rawInput: ' monthly notes ' })
    expect(messages).toEqual([{ content: [{ type: 'text', text: message }], source: { kind: 'plugin', plugin: 'dsh-agent-plugins-market' } }])
    expect(result).toEqual({ kind: 'success', text: acknowledgement })
  })
})
