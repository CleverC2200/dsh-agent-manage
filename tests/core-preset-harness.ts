/** Fixed official libraries and production Loader/Session; only completion is local. */
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, relative, resolve, join } from 'node:path'
import { onTestFinished } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as company from '../src/runtime/standard-preset.js'
import { BusinessResources } from '../src/runtime/business-resources.js'
import { core, officialModulePath } from './official-core-input.js'

export { core }
export async function official(name: string) {
  return import(/* @vite-ignore */ officialModulePath(name))
}

export interface PresetHarnessOptions {
  /** Read the ordinary Manage bundle patch or omit company plugins entirely. */
  companyBundle?: 'manage' | 'absent'
  /** Existing user UI preference; null means a genuinely fresh profile. */
  selectedDefault?: string | null
  /** Full production Manage entry; the default keeps existing preset tests narrow. */
  fullManage?: boolean
  /** Ordinary shipped config is passed through the real Loader Config parser. */
  manageConfig?: Record<string, unknown>
  /** Failure tests observe missing routes instead of waiting for publication. */
  waitForResources?: boolean
  /** Retain public Logger diagnostics even when app-boot rejects. */
  startupMessages?: { type: string; args: string[] }[]
  /** Owned by an independent caller so DSH_HOME is set before this module loads. */
  home?: string
  /** Loader's module-import boundary, used only to control real module loading order. */
  importModule?: (name: string, runtime: Context) => Promise<unknown>
}

export async function presetHarness(options: PresetHarnessOptions = {}) {
  if (options.fullManage || options.companyBundle === 'manage') {
    const root = process.env.DSH_HOME
    const agentsRoot = process.env.DSH_AGENTS_HOME
    if (!options.home || !root || !agentsRoot || resolve(root) === resolve(homedir(), '.dsh') || resolve(agentsRoot) !== resolve(root, 'agents'))
      throw Error('ISOLATED_MANAGE_HOME_REQUIRED')
    const path = relative(await realpath(root), await realpath(options.home))
    if (path === '..' || path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(path)) throw Error('ISOLATED_MANAGE_HOME_REQUIRED')
  }
  const home = await realpath(options.home ?? (await mkdtemp(join(tmpdir(), 'company-preset-'))))
  const manage = options.fullManage || options.companyBundle === 'manage' ? await import('../src/index.js') : undefined
  const dir = join(home, 'profiles', 'test')
  const { boot, initProfile, readProfilePatches } = await official('@deepseek-ai/dsh-app-boot')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await mkdir(join(dir, 'node_modules/@deepseek-ai'), { recursive: true })
  await symlink(join(core, 'packages/preset/agent-preset'), join(dir, 'node_modules/@deepseek-ai/dsh-agent-preset'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(home, 'package.json'), '{"name":"preset-test-installation"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  const base = load(await readFile(join(core, 'packages/bundle/base/cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as { insert: { id: string; config?: unknown }[] }[]
  // Host providers from the shipped base; all standard child rows remain unchanged.
  const providers = new Set([
    'timer',
    'typert',
    'credentials',
    'attachment-local',
    'session-query-sqlite',
    'storage',
    'storage-json',
    'storage-domain',
    'llm',
    'session',
    'session-persistence-jsonl',
    'session-projection',
    'user-questions',
    'agent',
    'agent-default-model',
    'jobs',
    'config-editor',
    'settings',
    'subprocess',
    'sandbox',
    'sandbox-policy',
    'bash-sandbox',
    'pwsh-sandbox',
    'approval',
    'shell-env',
    'fs-observation-policy',
    'skill',
    'commands',
    'goal',
    'token-meter',
    'subagent',
    'subagent-spawn-in-process',
    'subagent-fork-in-process',
    'ptc-runtime',
    'web',
    'tools',
    'system-prompt',
    'agent-loop',
    'plugin-manager',
    'fs-sandbox'
  ])
  const entries = base[0].insert
    .filter(row => providers.has(row.id))
    .map(row => {
      if (row.id === 'credentials') return { ...row, config: { path: join(home, '.credentials.yaml'), watch: false } }
      if (row.id === 'storage-json') return { ...row, config: { root: join(home, 'storages') } }
      if (row.id === 'sandbox-policy') return { ...row, config: { mode: 'danger-full-access', workspaceRoot: home } }
      if (row.id === 'approval') return { ...row, config: { policy: 'never' } }
      if (row.id === 'agent-default-model') return { ...row, config: { provider: 'local', model: 'test' } }
      if (row.id === 'session-persistence-jsonl') return { ...row, config: { root: join(home, 'sessions') } }
      return row
    })
  const webBase = load(await readFile(join(core, 'packages/bundle/web-app/cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as {
    insert?: { id: string; config?: Record<string, unknown> }[]
  }[]
  const webProviders = new Set(['workspace', 'file-upload', 'session-controller', 'schedule', 'cordis-host-runner', 'cordis-inspect-providers'])
  entries.push(...(webBase.flatMap(patch => patch.insert ?? []).filter(row => webProviders.has(row.id)) as never[]))
  entries.push({ id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { trustedHosts: [] } } as never)
  const officialRegistry = webBase.flatMap(patch => patch.insert ?? []).find(row => row.id === 'agent-preset-registry')!
  entries.push(
    (options.companyBundle === undefined
      ? { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'auto-negotiation' } }
      : officialRegistry) as never
  )
  entries.push({ id: 'subagent-model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings' } as never)
  for (const id of ['standard', 'minimal', 'ptc', 'cordis']) {
    const rows = load(await readFile(join(core, `packages/bundle/web-app/presets/${id}.patch.yml`), 'utf8'), { schema: entryListSchema }) as { insert: never[] }[]
    entries.push(...rows[0].insert)
  }
  if (options.companyBundle === undefined) {
    if (options.fullManage) entries.push({ id: 'dsh-agent-manage', name: 'cordis:company-manage', config: { geaMcp: false, sources: [], ...options.manageConfig } } as never)
    else if (process.env.PRESET_RED_BASELINE !== '1') entries.push({ id: 'company-presets', name: 'cordis:company-presets' } as never)
  }
  const { dump } = await import('js-yaml')
  const managePatch =
    options.companyBundle === 'manage' ? (load(await readFile(resolve(import.meta.dirname, '../cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as unknown[]) : []
  await writeFile(join(bundle, 'cordis.patch.yml'), dump([{ insert: entries }, ...managePatch], { schema: entryListSchema }))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  await writeFile(
    join(dir, 'cordis.patch.yml'),
    JSON.stringify([
      ...(options.companyBundle === undefined
        ? [{ id: 'agent-preset-registry', config: { default: 'auto-negotiation', selectedDefault: 'minimal' } }]
        : options.selectedDefault
          ? [{ id: 'agent-preset-registry', config: { ...officialRegistry.config, selectedDefault: options.selectedDefault } }]
          : []),
      ...(options.companyBundle === 'manage' ? [{ id: 'dsh-agent-manage', config: { geaMcp: false, sources: [], ...options.manageConfig } }] : []),
      { id: 'agent-default-model', config: { provider: 'local', model: 'preserved' } }
    ])
  )
  const profile = {
    name: 'test',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined
  }
  const startupMessages: { type: string; args: string[] }[] = options.startupMessages ?? []
  let ctx: Context
  const start = async (): Promise<Context> => {
    let resourcesReady: Promise<void> | undefined
    ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (runtime: Context) => {
      if (options.fullManage && options.waitForResources !== false)
        resourcesReady = new Promise<void>((resolveReady, rejectReady) => {
          runtime.inject(['agentResources', 'connection'], async host => {
            try {
              const response = await host.connection
                .createSharedFetchHandler('/api')
                .fetch(new Request(`http://localhost/api/agent-manage/resources?cwd=${encodeURIComponent(home)}`))
              if (response.status !== 200) throw Error(`MANAGE_RESOURCE_ROUTE_UNAVAILABLE: ${response.status}`)
              resolveReady()
            } catch (error) {
              rejectReady(error)
              throw error
            }
          })
        })
      if (options.fullManage)
        runtime.logger.exporter({
          levels: { default: 2 },
          export: ({ type, args }) => {
            if (type === 'warn' || type === 'error')
              startupMessages.push({ type, args: args.map(value => (value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : String(value))) })
          }
        })
      runtime.provide('profileContext', profile as never)
      runtime.provide('appReady', {
        onReady(listener: () => void) {
          listener()
          return () => {}
        }
      } as never)
      runtime.loader.builtins['company-presets'] = {
        inject: ['agentPresets', 'loader', 'skills'],
        async apply(host: Context) {
          await company.waitForStandard(host)
          const resources = new BusinessResources(host, join(home, 'selected-resources.json'))
          await resources.load()
          host.provide('agentResources', resources)
          host.effect(() => () => resources.dispose())
          await company.apply(host)
        }
      }
      if (manage) runtime.loader.builtins['company-manage'] = manage
      runtime.loader.internal = {
        version: 'v2',
        import: (name: string) =>
          name === 'dsh-agent-manage/user-agent-skills'
            ? import('../src/runtime/user-agent-skills.js')
            : name === 'dsh-agent-manage' && manage
              ? Promise.resolve(manage)
              : options.importModule
                ? options.importModule(name, runtime)
                : official(name)
      } as never
    })
    await resourcesReady
    return ctx
  }
  onTestFinished(async () => {
    await ctx?.fiber.dispose()
    if (!options.home) await rm(home, { recursive: true, force: true })
  })
  return { ctx: await start(), start, home, profile, startupMessages }
}

export async function agentOn(ctx: Context, id: string, preset?: string, seed?: readonly unknown[], cwd = core) {
  const { SessionId } = await official('@deepseek-ai/dsh-session')
  const selected = (await ctx.agentPresets.resolve(preset)).id
  return (
    await ctx.agents.create({
      sessionId: SessionId(id),
      meta: { cwd, agentPreset: selected },
      agentOptions: { provider: 'local', model: 'test' },
      ...(seed ? { seed: seed as never } : {}),
      setup: async agentCtx => {
        await ctx.agentPresets.mount(agentCtx, preset)
      }
    })
  ).agent
}

/** Scripted model tool calls still run through the production Agent loop and guards. */
export interface CompletionToolStep {
  name: string
  arguments: Record<string, unknown>
}

export async function completion(
  ctx: Context,
  contextWindow = 262_144,
  firstToolStep = false,
  pause?: Promise<void>,
  scenario?: { tools: readonly CompletionToolStep[]; checkpoint: string; beforeToolStep?: (step: number) => Promise<void> }
) {
  const { LlmAdapter } = await official('@deepseek-ai/dsh-llm')
  const requests: { messages: { content: { type: string; text?: string }[] }[]; tools?: { name: string }[] }[] = []
  const steps = scenario?.tools ?? (firstToolStep ? [{ name: 'todo_write', arguments: { todos: [{ content: 'Continue original task', status: 'in_progress' }] } }] : [])
  class LocalCompletion extends LlmAdapter {
    private nextTool = 0
    async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model, context: contextWindow ? { contextWindow } : {} }
    }
    async *stream(options: (typeof requests)[number]) {
      requests.push(options)
      await pause
      const summary = options.messages.at(-1)?.content.some(block => block.text?.includes('acting as a compaction engine'))
      if (!summary && this.nextTool < steps.length) {
        await scenario?.beforeToolStep?.(this.nextTool)
        const tool = steps[this.nextTool++]
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield {
          type: 'block-end',
          index: 0,
          block: {
            type: 'tool-call',
            id: scenario ? `scripted-task-step-${this.nextTool}` : 'first-task-step',
            name: tool.name,
            arguments: JSON.stringify(tool.arguments)
          }
        }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'text',
          text: summary
            ? (scenario?.checkpoint ?? 'CHECKPOINT: preserve original task, read-only Consumer scope and user decisions.')
            : 'Continued original task from the checkpoint.'
        }
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['local'], new LocalCompletion())
  return requests
}

export async function history(repetitions: number, task = '') {
  const { Session, SessionId } = await official('@deepseek-ai/dsh-session')
  const { createUserMessage, createMessage } = await official('@deepseek-ai/dsh-llm')
  const session = Session.create(SessionId('seed'))
  for (let turn = 1; turn <= 3; turn++) {
    session.append('turn/start', { turn })
    session.append(
      'user/message',
      createUserMessage({
        content: [{ type: 'text', text: `Original task turn ${turn}. ${task}${'Keep read-only Consumer scope and preserve user decisions. '.repeat(repetitions)}` }],
        source: { kind: 'user' }
      }),
      { surfaceOp: 'append' }
    )
    session.append('step/start', { turn, step: 1 })
    session.append(
      'assistant/message',
      {
        stream: [],
        turn,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: 'Verified original task evidence. '.repeat(repetitions) }],
          source: { kind: 'model', provider: 'local', model: 'test' }
        })
      },
      { surfaceOp: 'append' }
    )
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return session.snapshotEvents()
}

export async function turn(ctx: Context, agent: Awaited<ReturnType<typeof agentOn>>, prompt: string) {
  const { createUserMessage } = await official('@deepseek-ai/dsh-llm')
  const idle = new Promise<void>(resolveIdle => {
    const release = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        release()
        resolveIdle()
      }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
  await idle
}

/** Save only compact execution observations; fixture histories stay in temporary profiles. */
export async function record(name: string, observation: unknown): Promise<void> {
  if (process.env.PRESET_EVIDENCE_DIR) await writeFile(join(process.env.PRESET_EVIDENCE_DIR, `${name}.json`), JSON.stringify(observation, null, 2) + '\n')
}

/** Legacy lifecycle fixtures read the same shipped declaration; Session acceptance uses the registry above. */
export async function officialStandardDocument() {
  const { dump } = await import('js-yaml')
  const rows = load(await readFile(join(core, 'packages/bundle/web-app/presets/standard.patch.yml'), 'utf8'), { schema: entryListSchema }) as {
    insert: { config: { plugins: unknown } }[]
  }[]
  return { content: dump(rows[0].insert[0].config.plugins, { schema: entryListSchema }) }
}
