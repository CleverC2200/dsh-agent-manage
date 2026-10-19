/** Manage owns original resource loading, native publication and selected-id recovery. */
import { z } from 'zod'
import type { UserAgentSkill, UserAgentView } from '../contracts/user-agents.js'
import { SkillDirectories } from './skill-directories.js'
import { agentSkills, captureAgentSkills, ownedSkillEdits } from './agent-skills.js'
import { createHash } from 'node:crypto'
import { readFile, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve, sep, dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'
import { composeStandardPreset } from './standard-preset.js'
import { readSkillHeader } from '../catalog/skill-files.js'

export interface ExecutionProfile {
  label: string
  consumerCode: string
  skills: string[]
  crossConsumers?: string[]
}
export interface BusinessResourceDefinition {
  id: string
  label: string
  /** Agent catalog metadata; the business page keeps its separate title. */
  presetName?: string
  description?: string
  root: string
  prompt?: string
  /** Publish a validated preset when the enabled package registers, without selecting it or changing user defaults. */
  publishPreset?: boolean
  /** Owning capability declaration, for explicit references to existing analysis Skills. */
  capability?: string
  /** A policy JSON file may contain several original profiles. */
  profileKey?: string
  profile: ExecutionProfile
  /** Host-verified GEA Cube capability. Never populated from user/source imports. */
  cube?: boolean
  skillFiles?: Record<string, string>
  enabled?: boolean
  /** Existing scoped resource-reference plugin, when required by this resource. */
  plugins?: Array<{ id: string; name: string }>
}
export interface ResourceSummary {
  id: string
  label: string
  description?: string
  kind: 'prompt' | 'skill'
  installed: boolean
  enabled: boolean
  provider: string
  skills?: string[]
  /** Validated selected page choices; labels come from the corresponding resource summaries. */
  interpreters?: readonly string[]
  missingSkills?: string[]
  error?: string
}
export interface ResourceSelection {
  id: string
  preset: string
  skill?: string
  profile?: ExecutionProfile
  interpreters?: readonly string[]
}
interface Entry {
  sourceVersion?: string
  skillSnapshot?: UserAgentSkill[]
  instructions?: string
  interpreters?: readonly string[]
  definition: BusinessResourceDefinition
  owner: AbortController
  cube: AbortController
  error?: string
}
const customization = z
  .object({ prompt: z.string().trim().min(1).max(48000).optional(), skills: agentSkills.optional(), disabled: z.boolean().optional(), revision: z.number().int().positive() })
  .strict()
type Customization = z.infer<typeof customization>
const SKILL_PRESET = 'agent-resource-skill'

/** The registry and resource discovery project the same trusted Agent metadata. */
function promptDescription(definition: BusinessResourceDefinition): string {
  return definition.description ?? `${definition.profile.label}业务角色，支持上下文压缩、文件操作、规划、任务和协作；业务执行遵循当前身份与资源授权。`
}

/** Strict YAML and normalized Skill identity share one fail-closed metadata decision. */
function skillMetadata(text: string, name: string): Exclude<ReturnType<typeof parseSkillFrontmatter>, string> | undefined {
  const record = parseFrontmatterRecord(text)
  const parsed = parseSkillFrontmatter(text, name)
  if (typeof parsed === 'string') throw new Error(parsed)
  return record.disabled === true ? undefined : parsed
}

/** Resolve a source-controlled reference again at use time; symlinks cannot escape its owner. */
async function resourceFile(root: string, reference: string): Promise<string> {
  if (!reference) throw Error('INVALID_AGENT_RESOURCE_REFERENCE')
  const base = await realpath(root)
  const file = await realpath(resolve(base, reference))
  if (!file.startsWith(base + sep)) throw Error('INVALID_AGENT_RESOURCE_PATH')
  return file
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentResources: BusinessResources
  }
}

export class BusinessResources {
  private readonly listeners = new Set<() => void>()
  readonly directories: SkillDirectories
  private readonly customizations = new Map<string, Customization>()
  private readonly cubeDisabled = new Set<string>()
  private readonly entries = new Map<string, Entry>()
  private readonly mounted = new Map<string, () => Promise<void>>()
  private readonly versions = new Map<string, string>()
  private readonly selected = new Set<string>()
  private control?: SkillProviderControl
  private unregisterProvider: () => void
  private closed = false
  private readonly lifetime = new AbortController()
  private pending: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly ctx: Pick<Context, 'skills' | 'agentPresets'>,
    private readonly indexFile: string
  ) {
    this.directories = new SkillDirectories(
      ctx,
      `${indexFile}.skills`,
      id => this.pluginAgent(id),
      (id, skills, revision) => this.saveDirectorySkills(id, skills, revision),
      async skill =>
        [...this.entries.values()].find(entry => {
          const file = entry.definition.skillFiles?.[skill.name]
          return file && skill.kind === 'reference' && skill.path === resolve(entry.definition.root, file)
        })?.definition.root
    )
    this.unregisterProvider = ctx.skills.registerProvider(control => {
      this.control = control
      return { name: 'business-resource', list: options => this.skillCandidates(options), get: (candidate, options) => this.skillBody(candidate, options) }
    })
  }
  async load(): Promise<void> {
    let value: unknown
    try {
      value = JSON.parse(await readFile(this.indexFile, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw Error('INVALID_SELECTED_RESOURCE_INDEX', { cause: error })
    }
    const state = value as { version?: unknown; selected?: unknown; cubeDisabled?: unknown; customizations?: unknown }
    if (state.version !== 1 || !Array.isArray(state.selected) || state.selected.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)))
      throw Error('INVALID_SELECTED_RESOURCE_INDEX')
    if (state.cubeDisabled !== undefined) {
      if (!Array.isArray(state.cubeDisabled) || state.cubeDisabled.some(id => typeof id !== 'string')) throw Error('INVALID_SELECTED_RESOURCE_INDEX')
      for (const id of state.cubeDisabled) this.cubeDisabled.add(id)
    }
    if (state.customizations !== undefined)
      for (const [id, value] of Object.entries(z.record(z.string(), customization).parse(state.customizations))) this.customizations.set(id, value)
    for (const id of state.selected) this.selected.add(id)
    if (this.selected.has(SKILL_PRESET)) await this.mountSkillPreset()
  }
  /** Called by a live installed plugin owner, never by an HTTP-provided directory. */
  async register(definitions: readonly BusinessResourceDefinition[]): Promise<() => Promise<void>> {
    if (this.closed) throw Error('AGENT_RESOURCES_DISPOSED')
    const owner = new AbortController()
    const ids = new Set<string>()
    for (const definition of definitions) {
      if (!/^[a-z][a-z0-9-]*$/.test(definition.id) || ids.has(definition.id) || this.entries.has(definition.id)) throw Error('DUPLICATE_AGENT_RESOURCE')
      ids.add(definition.id)
    }
    for (const definition of definitions) this.entries.set(definition.id, { definition, owner, cube: new AbortController() })
    this.control?.invalidate()
    for (const { id, publishPreset, enabled } of definitions)
      if (!this.customizations.get(id)?.disabled && (this.selected.has(id) || (publishPreset && enabled !== false))) {
        try {
          await this.serialize(() => this.mountPrompt(id, new AbortController().signal))
        } catch (error) {
          const entry = this.entries.get(id)
          if (entry) entry.error = String(error)
        }
      }
    this.changed()
    let released = false
    return async () => {
      owner.abort()
      this.changed()
      await this.serialize(async () => {
        if (released) return
        try {
          for (const id of ids)
            if (this.entries.get(id)?.owner === owner) {
              await this.unmount(id)
              this.entries.delete(id)
            }
          released = true
        } finally {
          this.control?.invalidate()
        }
      })
    }
  }

  /** Host-only projection; owner identity and Consumer never cross the UI interface. */
  cubeSource(id: string): { sourceRef: string; consumerCode: string; signal: AbortSignal } | undefined {
    const entry = this.entries.get(id)
    if (
      this.closed ||
      !entry?.definition.cube ||
      entry.definition.enabled === false ||
      this.customizations.get(id)?.disabled ||
      entry.error ||
      entry.owner.signal.aborted ||
      this.cubeDisabled.has(id) ||
      !this.versions.has(id)
    )
      return undefined
    return { sourceRef: id, consumerCode: entry.definition.profile.consumerCode, signal: entry.cube.signal }
  }
  cubeCatalog(): Array<{ sourceRef: string; name: string; enabled: boolean; available: boolean }> {
    return [...this.entries.values()]
      .filter(entry => entry.definition.cube && !entry.owner.signal.aborted)
      .map(({ definition }) => ({
        sourceRef: definition.id,
        name: definition.presetName ?? definition.label,
        enabled: !this.cubeDisabled.has(definition.id),
        available: !!this.cubeSource(definition.id)
      }))
  }
  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private fail(entry: Entry, reason: string): void {
    if (entry.error === reason) return
    entry.error = reason
    this.changed()
  }
  private changed(): void {
    for (const [id, entry] of this.entries) {
      if (this.closed || entry.owner.signal.aborted || entry.error || entry.definition.enabled === false || this.customizations.get(id)?.disabled || this.cubeDisabled.has(id))
        entry.cube.abort()
      else if (entry.cube.signal.aborted) entry.cube = new AbortController()
    }
    for (const listener of this.listeners) listener()
  }
  /** Plugin MCP membership is fixed; the only supported mutation is enabling it. */
  async setCubeEnabled(id: string, enabled: boolean): Promise<void> {
    await this.serialize(async () => {
      const entry = this.entries.get(id)
      if (!entry?.definition.cube || entry.owner.signal.aborted) throw Error('CUBE_SOURCE_UNAVAILABLE')
      const previous = this.cubeDisabled.has(id)
      if (previous === !enabled) return
      if (enabled) this.cubeDisabled.delete(id)
      else this.cubeDisabled.add(id)
      try {
        await this.persist()
      } catch (error) {
        if (previous) this.cubeDisabled.add(id)
        else this.cubeDisabled.delete(id)
        throw error
      }
      entry.cube.abort()
      entry.cube = new AbortController()
      this.changed()
    })
  }
  /** Explicit copy contains only original instructions and permitted resource references. */
  async copyable(id: string): Promise<{
    name: string
    description: string
    prompt: string
    skills: UserAgentSkill[]
    cube?: { sourceRef: string; enabled: boolean }
  }> {
    const entry = this.entries.get(id)
    if (!entry?.definition.prompt || entry.owner.signal.aborted) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
    if (this.customizations.get(id)?.disabled) entry.instructions = (await this.originalProfile(entry, entry.owner.signal)).profile.persona
    else await this.serialize(() => this.mountPrompt(id, new AbortController().signal))
    const d = entry.definition
    const skills = await this.ctx.skills.list()
    if (entry.owner.signal.aborted || entry.error || !entry.instructions) throw Error('CUBE_SOURCE_UNAVAILABLE')
    return {
      name: d.presetName ?? d.label,
      description: promptDescription(d),
      prompt: this.customizations.get(id)?.prompt ?? entry.instructions,
      skills:
        this.customizations.get(id)?.skills ??
        entry.skillSnapshot ??
        (await captureAgentSkills(
          this.ctx,
          d.profile.skills.map(name => {
            const skill = skills.find(skill => skill.name === name)
            if (!skill) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${name}`)
            return { kind: 'reference', name, provider: skill.provider, ...(skill.path ? { path: skill.path } : {}), enabled: true }
          })
        )),
      ...(d.cube ? { cube: { sourceRef: id, enabled: !!this.cubeSource(id) } } : {})
    }
  }
  /** All trusted prompt declarations, including non-Cube Agents, use their original preset identity. */
  async pluginAgents(): Promise<UserAgentView[]> {
    return Promise.all([...this.entries.values()].filter(entry => entry.definition.prompt && !entry.owner.signal.aborted).map(entry => this.pluginAgent(entry.definition.id)))
  }
  async pluginAgent(id: string): Promise<UserAgentView> {
    const entry = this.entries.get(id)
    if (!entry?.definition.prompt || entry.owner.signal.aborted) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
    const custom = this.customizations.get(id)
    const enabled = entry.definition.enabled !== false && !custom?.disabled
    try {
      if (enabled) await this.serialize(() => this.mountPrompt(id, new AbortController().signal))
      else entry.instructions = (await this.originalProfile(entry, entry.owner.signal)).profile.persona
    } catch (error) {
      entry.error = String(error)
    }
    const d = entry.definition
    const skills =
      custom?.skills ??
      entry.skillSnapshot ??
      (await captureAgentSkills(
        this.ctx,
        (await this.ctx.skills.list())
          .filter(skill => d.profile.skills.includes(skill.name))
          .map(skill => ({ kind: 'reference' as const, name: skill.name, provider: skill.provider, ...(skill.path ? { path: skill.path } : {}), enabled: true }))
      ))
    return {
      id,
      preset: id,
      name: d.presetName ?? d.label,
      description: promptDescription(d),
      prompt: custom?.prompt ?? entry.instructions ?? '',
      skills,
      enabled,
      revision: custom?.revision ?? 1,
      origin: 'plugin',
      customized: custom?.prompt !== undefined || custom?.skills !== undefined,
      pluginSource: { sourceRef: id, version: entry.sourceVersion ?? 'unavailable' },
      publication: !enabled ? 'disabled' : entry.error ? 'failed' : 'ready',
      defaultUnavailable: this.ctx.agentPresets.defaultId === id && !enabled,
      ...(d.cube ? { cube: { sourceRef: id, enabled: !this.cubeDisabled.has(id) } } : {}),
      ...(entry.error ? { error: entry.error } : {})
    }
  }
  async savePlugin(input: unknown): Promise<UserAgentView> {
    const value = z
      .object({ id: z.string().min(1), prompt: z.string().trim().min(1).max(48000).optional(), skills: agentSkills.optional() })
      .strict()
      .parse(input)
    if (!this.entries.get(value.id)?.definition.prompt) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
    const previous = this.customizations.get(value.id)?.skills ?? this.entries.get(value.id)?.skillSnapshot ?? []
    const incoming = value.skills && ownedSkillEdits(value.skills, previous)
    const revision = this.customizations.get(value.id)?.revision ?? 1
    const skills = incoming && (await this.directories.migrate(await captureAgentSkills(this.ctx, incoming), previous, this.entries.get(value.id)!.definition.root))
    await this.updatePlugin(value.id, { ...(value.prompt === undefined ? {} : { prompt: value.prompt }), ...(skills ? { skills } : {}) }, skills ? revision : undefined)
    return this.pluginAgent(value.id)
  }
  async saveDirectorySkills(id: string, skills: UserAgentSkill[], expectedRevision?: number): Promise<UserAgentView> {
    await this.updatePlugin(id, { skills: await this.directories.migrate(skills) }, expectedRevision)
    return this.pluginAgent(id)
  }
  async setPluginEnabled(id: string, enabled: boolean): Promise<UserAgentView> {
    await this.updatePlugin(id, { disabled: !enabled })
    return this.pluginAgent(id)
  }
  private async updatePlugin(id: string, patch: Partial<Customization>, expectedRevision?: number): Promise<void> {
    await this.serialize(async () => {
      const entry = this.entries.get(id)
      if (!entry?.definition.prompt || entry.owner.signal.aborted) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
      const previous = this.customizations.get(id)
      if (expectedRevision !== undefined && (previous?.revision ?? 1) !== expectedRevision) throw Error('SKILL_EDIT_CONFLICT')
      this.customizations.set(id, { ...previous, ...patch, revision: (previous?.revision ?? 1) + 1 })
      if (expectedRevision !== undefined) {
        try {
          if (this.customizations.get(id)?.disabled) await this.unmount(id)
          else await this.mountPrompt(id, new AbortController().signal)
          await this.persist()
          this.control?.invalidate()
          this.changed()
          return
        } catch (error) {
          if (previous) this.customizations.set(id, previous)
          else this.customizations.delete(id)
          await this.unmount(id)
          if (!previous?.disabled) await this.mountPrompt(id, new AbortController().signal)
          throw error
        }
      }
      try {
        await this.persist()
      } catch (error) {
        if (previous) this.customizations.set(id, previous)
        else this.customizations.delete(id)
        throw error
      }
      this.control?.invalidate()
      this.changed()
      if (this.customizations.get(id)?.disabled) await this.unmount(id)
      else {
        try {
          await this.mountPrompt(id, new AbortController().signal)
        } catch (error) {
          this.fail(entry, String(error))
        }
      }
    })
  }
  /** Only a selected, validated original profile can contribute extra page interpreters. */
  interpreters(id: string): readonly string[] {
    const entry = this.entries.get(id)
    return entry?.interpreters
      ? entry.interpreters.filter(choice => {
          const target = this.entries.get(choice)
          return target?.definition.prompt && target.definition.enabled !== false && !target.error
        })
      : [id]
  }
  async list(options: SkillLookupOptions = {}): Promise<ResourceSummary[]> {
    options.signal?.throwIfAborted()
    const skills = await this.ctx.skills.list(options)
    options.signal?.throwIfAborted()
    const available = new Set(skills.map(skill => skill.name))
    const prompts: ResourceSummary[] = [...this.entries.values()]
      .filter(entry => entry.definition.prompt)
      .map(({ definition: d, error, interpreters, owner }) => {
        const missingSkills = d.profile.skills.filter(name => !available.has(name))
        return {
          id: d.id,
          label: d.presetName ?? d.profile.label,
          kind: 'prompt',
          description: promptDescription(d),
          installed: true,
          enabled: d.enabled !== false && !this.customizations.get(d.id)?.disabled && !error && !owner.signal.aborted,
          provider: 'package',
          skills: [...d.profile.skills],
          ...(interpreters
            ? {
                interpreters: this.interpreters(d.id)
              }
            : {}),
          ...(missingSkills.length ? { missingSkills } : {}),
          ...(error ? { error } : {})
        }
      })
    return [
      ...prompts,
      ...skills
        .filter(skill => skill.invocation.userInvocable)
        .map(skill => ({
          id: `skill:${skill.name}`,
          label: skill.name,
          description: skill.description,
          kind: 'skill' as const,
          installed: true,
          enabled: true,
          provider: skill.provider
        }))
    ]
  }
  async select(id: string, signal: AbortSignal, cwd?: string): Promise<ResourceSelection> {
    signal = AbortSignal.any([signal, this.lifetime.signal])
    return this.serialize(async () => {
      signal.throwIfAborted()
      if (this.closed) throw Error('AGENT_RESOURCES_DISPOSED')
      const wasMounted = this.mounted.has(id.startsWith('skill:') ? SKILL_PRESET : id)
      const preset = id.startsWith('skill:') ? SKILL_PRESET : id
      const wasSelected = this.selected.has(preset)
      let mountCompleted = false
      try {
        let skill: string | undefined
        let profile: ExecutionProfile | undefined
        if (id.startsWith('skill:')) {
          skill = id.slice(6)
          const body = await this.ctx.skills.get(skill, { cwd, signal })
          if (!body?.invocation.userInvocable) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
          signal.throwIfAborted()
          await this.mountSkillPreset()
        } else {
          await this.mountPrompt(id, signal)
          profile = this.entries.get(id)!.definition.profile
        }
        mountCompleted = true
        signal.throwIfAborted()
        const added = !this.selected.has(preset)
        this.selected.add(preset)
        try {
          await this.persist()
        } catch (error) {
          if (added) this.selected.delete(preset)
          throw error
        }
        signal.throwIfAborted()
        return {
          id,
          preset,
          ...(skill ? { skill } : {}),
          ...(profile ? { profile } : {}),
          ...(this.entries.get(id)?.interpreters ? { interpreters: this.interpreters(id) } : {})
        }
      } catch (error) {
        if (!wasSelected && this.selected.delete(preset)) await this.persist()
        if (!wasMounted && !this.selected.has(preset) && mountCompleted) await this.unmount(preset)
        throw error
      }
    })
  }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.indexFile), { recursive: true })
    const temporary = this.indexFile + '.tmp'
    await writeFile(
      temporary,
      JSON.stringify({
        version: 1,
        selected: [...this.selected].sort(),
        ...(this.customizations.size ? { customizations: Object.fromEntries(this.customizations) } : {}),
        ...(this.cubeDisabled.size ? { cubeDisabled: [...this.cubeDisabled].sort() } : {})
      }) + '\n',
      { mode: 0o600 }
    )
    await rename(temporary, this.indexFile)
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation)
    this.pending = next.catch(() => {})
    return next
  }
  private async mountSkillPreset(): Promise<void> {
    if (!this.mounted.has(SKILL_PRESET)) {
      const dispose = await this.ctx.agentPresets.register(
        await composeStandardPreset(this.ctx.agentPresets, {
          id: SKILL_PRESET,
          name: 'Skill',
          description: '使用所选 Skill 开始新任务，保留完整标准工具、上下文压缩与协作能力。'
        })
      )
      this.mounted.set(SKILL_PRESET, dispose)
    }
    try {
      if (this.closed) throw Error('AGENT_RESOURCES_DISPOSED')
      const resolved = await this.ctx.agentPresets.resolve(SKILL_PRESET)
      if (resolved.broken) throw Error(resolved.broken)
    } catch (error) {
      await this.unmount(SKILL_PRESET)
      throw error
    }
  }
  private async originalProfile(entry: Entry, signal: AbortSignal) {
    const d = entry.definition
    const file = await resourceFile(d.root, d.prompt!)
    const raw = JSON.parse(await readFile(file, { encoding: 'utf8', signal }))
    const profile = d.profileKey ? raw.profiles?.[d.profileKey] : raw
    signal.throwIfAborted()
    if (
      !profile ||
      typeof profile.persona !== 'string' ||
      !profile.persona.trim() ||
      profile.consumerCode !== d.profile.consumerCode ||
      !Array.isArray(profile.skills) ||
      profile.skills.some((name: unknown) => typeof name !== 'string' || !d.profile.skills.includes(name)) ||
      new Set(profile.skills).size !== profile.skills.length ||
      Object.keys(d.skillFiles ?? {}).some(name => !profile.skills.includes(name)) ||
      (d.profileKey !== undefined && JSON.stringify(profile.skills) !== JSON.stringify(d.profile.skills)) ||
      (profile.crossConsumers !== undefined && JSON.stringify(profile.crossConsumers) !== JSON.stringify(d.profile.crossConsumers ?? []))
    )
      throw Error('INVALID_AGENT_RESOURCE_IDENTITY')
    if (d.capability) {
      const capabilityFile = await resourceFile(d.root, d.capability)
      const capability = JSON.parse(await readFile(capabilityFile, { encoding: 'utf8', signal }))
      const references = capability.resourceReferences
      if (references !== undefined) {
        if (!references || typeof references !== 'object' || Array.isArray(references) || Object.keys(references).some(key => !['skills', 'consumers'].includes(key)))
          throw Error('INVALID_AGENT_RESOURCE_REFERENCES')
        for (const [key, pattern, own] of [
          ['skills', /^[a-z][a-z0-9-]*$/, capability.id],
          ['consumers', /^[a-z][a-z0-9_-]*$/, d.profile.consumerCode]
        ] as const) {
          const names = references[key]
          if (
            !Array.isArray(names) ||
            names.length > 8 ||
            new Set(names).size !== names.length ||
            names.some((name: unknown) => typeof name !== 'string' || name.length > 80 || !pattern.test(name) || name === own)
          )
            throw Error('INVALID_AGENT_RESOURCE_REFERENCES')
        }
        if (
          capability.id !== d.id.replace(/^gea-html-/, '') ||
          capability.data?.consumerCode !== d.profile.consumerCode ||
          JSON.stringify(capability.skills) !== JSON.stringify([capability.id, ...references.skills]) ||
          JSON.stringify(profile.skills) !== JSON.stringify(capability.skills) ||
          JSON.stringify(profile.crossConsumers ?? []) !== JSON.stringify(references.consumers)
        )
          throw Error('INVALID_AGENT_RESOURCE_REFERENCES')
      }
    }
    const interpreters: unknown = profile.pageAgents
    if (
      interpreters !== undefined &&
      (!Array.isArray(interpreters) ||
        interpreters.length < 1 ||
        interpreters.length > 4 ||
        !interpreters.includes(d.id) ||
        new Set(interpreters).size !== interpreters.length ||
        interpreters.some(value => typeof value !== 'string' || !/^gea-html-inventory-[a-z]+$/.test(value)))
    )
      throw Error('INVALID_AGENT_RESOURCE_IDENTITY')
    entry.sourceVersion = createHash('sha256').update(JSON.stringify(profile)).digest('hex')
    return { profile, interpreters }
  }

  private async mountPrompt(id: string, signal: AbortSignal): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || !entry.definition.prompt || entry.definition.enabled === false || this.customizations.get(id)?.disabled) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
    signal = AbortSignal.any([signal, entry.owner.signal])
    signal.throwIfAborted()
    const d = entry.definition
    const { profile, interpreters } = await this.originalProfile(entry, signal)
    const override = this.customizations.get(id)
    const skills = override?.skills
      ? await this.directories.migrate(override.skills, [], d.root)
      : (entry.skillSnapshot ??
        (await this.directories.migrate(
          await captureAgentSkills(
            this.ctx,
            (await this.ctx.skills.list())
              .filter(skill => d.profile.skills.includes(skill.name))
              .map(skill => ({ kind: 'reference' as const, name: skill.name, provider: skill.provider, ...(skill.path ? { path: skill.path } : {}), enabled: true }))
          ),
          [],
          d.root
        )))
    if (!override?.skills) entry.skillSnapshot = skills
    if (override?.skills && skills.some((skill, index) => skill.directory !== override.skills![index]?.directory)) {
      this.customizations.set(id, { ...override, skills })
      await this.persist()
    }
    const version = createHash('sha256').update(JSON.stringify({ profile, override, skills })).digest('hex')
    if (this.mounted.has(id) && this.versions.get(id) === version && !entry.error) return
    await this.unmount(id)
    const definition = await composeStandardPreset(
      this.ctx.agentPresets,
      { id, name: d.presetName ?? d.profile.label, description: promptDescription(d) },
      {
        personaPrefix: override?.prompt ?? profile.persona,
        plugins: [...(d.plugins ?? []), { id: 'user-agent-skills', name: 'dsh-agent-manage/user-agent-skills', config: { skills } }]
      }
    )
    signal.throwIfAborted()
    const dispose = await this.ctx.agentPresets.register(definition)
    this.mounted.set(id, dispose)
    try {
      signal.throwIfAborted()
      if (this.closed || this.entries.get(id) !== entry) throw Error('AGENT_RESOURCE_OWNER_CHANGED')
      const resolved = await this.ctx.agentPresets.resolve(id)
      if (resolved.broken) throw Error(resolved.broken)
      signal.throwIfAborted()
      this.versions.set(id, version)
      entry.interpreters = interpreters as string[] | undefined
      delete entry.error
      entry.instructions = profile.persona
      this.changed()
    } catch (error) {
      this.fail(entry, String(error))
      await this.unmount(id)
      throw error
    }
  }
  private async skillCandidates(options: SkillLookupOptions): Promise<SkillCandidate[]> {
    const result: SkillCandidate[] = []
    for (const [id, entry] of this.entries) {
      if (entry.definition.enabled === false) continue
      for (const [name, reference] of Object.entries(entry.definition.skillFiles ?? {})) {
        options.signal?.throwIfAborted()
        try {
          const file = await resourceFile(entry.definition.root, reference)
          const header = await readSkillHeader(file, options.signal)
          options.signal?.throwIfAborted()
          if (this.closed || entry.owner.signal.aborted || this.entries.get(id) !== entry) continue
          const parsed = skillMetadata(header, name)
          if (!parsed) continue
          result.push({
            name: parsed.name,
            description: parsed.description,
            invocation: parsed.invocation,
            provider: 'business-resource',
            source: 'bundled',
            rank: 600,
            locator: { id, name },
            ...(parsed.whenToUse ? { whenToUse: parsed.whenToUse } : {}),
            path: file,
            resourceBase: { kind: 'directory', path: dirname(file) }
          })
        } catch (error) {
          options.signal?.throwIfAborted()
          this.fail(entry, `${name}: ${String(error)}`)
          continue
        }
      }
    }
    return result
  }
  private async skillBody(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted()
    const locator = candidate.locator as { id: string; name: string }
    const entry = this.entries.get(locator.id)
    if (!entry || entry.definition.enabled === false) return undefined
    const reference = entry.definition.skillFiles?.[locator.name]
    if (!reference) return undefined
    try {
      const file = await resourceFile(entry.definition.root, reference)
      const raw = await readFile(file, { encoding: 'utf8', signal: options.signal })
      options.signal?.throwIfAborted()
      if (this.closed || entry.owner.signal.aborted || this.entries.get(locator.id) !== entry) return undefined
      const parsed = skillMetadata(raw, locator.name)
      if (!parsed) return undefined
      return { ...candidate, content: stripFrontmatter(raw), invocation: parsed.invocation }
    } catch (error) {
      options.signal?.throwIfAborted()
      this.fail(entry, `${locator.name}: ${String(error)}`)
      return undefined
    }
  }
  /** Retain the disposer and resource owner until Core confirms release. */
  private async unmount(id: string): Promise<void> {
    const dispose = this.mounted.get(id)
    if (!dispose) return
    try {
      await dispose()
      this.mounted.delete(id)
      this.versions.delete(id)
    } catch (error) {
      const entry = this.entries.get(id)
      if (entry) entry.error = String(error)
      this.control?.invalidate()
      throw error
    }
  }
  async dispose(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      for (const entry of this.entries.values()) entry.cube.abort()
      this.changed()
      this.lifetime.abort()
      for (const entry of this.entries.values()) entry.owner.abort()
      this.unregisterProvider()
    }
    await this.serialize(async () => {
      for (const id of this.mounted.keys()) {
        await this.unmount(id)
        this.entries.delete(id)
      }
      this.entries.clear()
    })
  }
}
