import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from './business-resources.js'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { dump, load } from 'js-yaml'

export const MINIMAL_SYSTEM_PROMPT = 'You are the smartest and most useful AI assistant in the world, capable of helping users complete all tasks.'

export const ORCHESTRATION_PRESET = {
  id: 'auto-negotiation',
  name: '智能编排',
  description: '米面冻品全链路经营分析与运营决策，支持上下文压缩、规划、任务和协作。',
  order: 0
} as const

type Plugin = PresetDefinition['plugins'][number]
export interface StandardPresetAdditions {
  personaPrefix?: string
  /** Extra plugin rows must not duplicate an existing plugin or its entry id. */
  plugins?: readonly Plugin[]
}

/**
 * Reuse the active official standard declaration through its public registry document.
 * The Loader dialect preserves expressions, disabled rows and isolated nested groups.
 * Missing standard or conflicting additions reject; callers own registration and disposal.
 */
export async function composeStandardPreset(
  registry: Pick<Context['agentPresets'], 'readDocument'>,
  metadata: Omit<PresetDefinition, 'plugins'>,
  additions: StandardPresetAdditions = {}
): Promise<PresetDefinition> {
  const document = await registry.readDocument('standard')
  const plugins = load(document.content, { schema: entryListSchema })
  const problem = entryListProblem(plugins)
  if (problem) throw Error(`INVALID_STANDARD_PRESET: ${problem}`)
  const rows = (plugins as Plugin[]).filter(row => row.name !== '@deepseek-ai/dsh-agent-instructions')
  const identities = new Set<string>()
  const names = new Set<string>()
  const visit = (entries: readonly Plugin[], additions = false): void => {
    for (const row of entries) {
      if (additions && ((row.id && identities.has(row.id)) || (row.group !== true && names.has(row.name)))) {
        throw Error(`STANDARD_PRESET_PLUGIN_CONFLICT: ${row.id ?? row.name}`)
      }
      if (row.id) identities.add(row.id)
      if (row.group !== true) names.add(row.name)
      if (row.group === true) visit(row.config, additions)
    }
  }
  visit(rows)
  const persona = rows.find(row => row.name === '@deepseek-ai/dsh-persona')
  if (!persona || (additions.personaPrefix !== undefined && !additions.personaPrefix.trim())) throw Error('INVALID_STANDARD_PERSONA')
  persona.config = {
    prefix: [MINIMAL_SYSTEM_PROMPT, additions.personaPrefix].filter(Boolean).join('\n\n'),
    suffix: '',
    complete: true,
    includeRuntimeContext: false
  }
  for (const row of additions.plugins ?? []) {
    const invalid = entryListProblem([row])
    if (invalid) throw Error(`INVALID_STANDARD_PRESET_ADDITION: ${invalid}`)
    visit([row], true)
    rows.push(...(load(dump([row], { schema: entryListSchema }), { schema: entryListSchema }) as Plugin[]))
  }
  return { ...metadata, plugins: rows }
}

export async function waitForStandard(ctx: Context): Promise<void> {
  const declaration = [...ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-agent-preset' && entry.options.config?.id === 'standard')
  if (declaration && !declaration.disabled) {
    if (!declaration.fiber) await declaration.init()
    await declaration.fiber?.await()
  }
}

export async function registerOrchestration(resources: Pick<Context['agentResources'], 'register'>): Promise<() => Promise<void>> {
  const skills = ['frozen-food-sales-operations-diagnosis', 'frozen-food-base-inventory-insight', 'prototype-html']
  return resources.register([
    {
      id: ORCHESTRATION_PRESET.id,
      label: ORCHESTRATION_PRESET.name,
      description: ORCHESTRATION_PRESET.description,
      order: ORCHESTRATION_PRESET.order,
      root: fileURLToPath(new URL('../../business-resources/orchestration/', import.meta.url)),
      prompt: 'prompt.md',
      publishPreset: true,
      inheritSkills: true,
      profile: { label: ORCHESTRATION_PRESET.name, consumerCode: 'general', skills },
      skillFiles: Object.fromEntries(skills.map(name => [name, `skills/${name}/SKILL.md`]))
    }
  ])
}

export const inject = ['agentPresets', 'loader', 'agentResources']
export async function apply(ctx: Context): Promise<void> {
  await waitForStandard(ctx)
  const release = await registerOrchestration(ctx.agentResources)
  ctx.effect(() => release)
}
