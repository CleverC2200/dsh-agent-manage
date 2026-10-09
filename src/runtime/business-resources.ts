/** Manage owns original resource loading, native publication and selected-id recovery. */
import { createHash } from 'node:crypto'
import { readFile, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import { resolve, sep, dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProviderControl } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { parseSkillFrontmatter, stripFrontmatter } from '../catalog/skills-parse.js'
import { parseFrontmatterRecord } from './user-store.js'
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
  root: string
  prompt?: string
  /** Owning capability declaration, for explicit references to existing analysis Skills. */
  capability?: string
  /** A policy JSON file may contain several original profiles. */
  profileKey?: string
  profile: ExecutionProfile
  skillFiles?: Record<string, string>
  enabled?: boolean
  /** Existing scoped resource-reference plugin, when required by this resource. */
  plugins?: Array<{ id: string; name: string }>
}
export interface ResourceSummary {
  id: string
  label: string
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
  interpreters?: readonly string[]
  definition: BusinessResourceDefinition
  owner: AbortController
  error?: string
}
const SKILL_PRESET = 'agent-resource-skill'

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
    const state = value as { version?: unknown; selected?: unknown }
    if (state.version !== 1 || !Array.isArray(state.selected) || state.selected.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)))
      throw Error('INVALID_SELECTED_RESOURCE_INDEX')
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
    for (const definition of definitions) this.entries.set(definition.id, { definition, owner })
    this.control?.invalidate()
    for (const id of ids)
      if (this.selected.has(id)) {
        try {
          await this.serialize(() => this.mountPrompt(id, new AbortController().signal))
        } catch (error) {
          const entry = this.entries.get(id)
          if (entry) entry.error = String(error)
        }
      }
    let released = false
    return async () => {
      if (released) return
      released = true
      owner.abort()
      await this.pending.catch(() => {})
      for (const id of ids)
        if (this.entries.get(id)?.owner === owner) {
          this.entries.delete(id)
          const dispose = this.mounted.get(id)
          this.mounted.delete(id)
          await dispose?.()
        }
      this.control?.invalidate()
    }
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
      .map(({ definition: d, error, interpreters }) => {
        const missingSkills = d.profile.skills.filter(name => !available.has(name))
        return {
          id: d.id,
          label: d.label,
          kind: 'prompt',
          installed: true,
          enabled: d.enabled !== false && !error,
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
        .map(skill => ({ id: `skill:${skill.name}`, label: skill.name, kind: 'skill' as const, installed: true, enabled: true, provider: skill.provider }))
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
        if (!wasMounted && !this.selected.has(preset)) {
          const dispose = this.mounted.get(preset)
          this.mounted.delete(preset)
          await dispose?.()
        }
        throw error
      }
    })
  }
  private async persist(): Promise<void> {
    await mkdir(dirname(this.indexFile), { recursive: true })
    const temporary = this.indexFile + '.tmp'
    await writeFile(temporary, JSON.stringify({ version: 1, selected: [...this.selected].sort() }) + '\n', { mode: 0o600 })
    await rename(temporary, this.indexFile)
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.pending.then(operation)
    this.pending = next.catch(() => {})
    return next
  }
  private async mountSkillPreset(): Promise<void> {
    if (this.mounted.has(SKILL_PRESET)) return
    const dispose = await this.ctx.agentPresets.register({ id: SKILL_PRESET, name: 'Skill', plugins: [{ id: 'skill', name: '@deepseek-ai/dsh-tool-skill' }] })
    if (this.closed) {
      await dispose()
      throw Error('AGENT_RESOURCES_DISPOSED')
    }
    this.mounted.set(SKILL_PRESET, dispose)
  }
  private async mountPrompt(id: string, signal: AbortSignal): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || !entry.definition.prompt || entry.definition.enabled === false) throw Error('AGENT_RESOURCE_DISABLED_OR_MISSING')
    signal = AbortSignal.any([signal, entry.owner.signal])
    signal.throwIfAborted()
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
        !interpreters.includes(id) ||
        new Set(interpreters).size !== interpreters.length ||
        interpreters.some(value => typeof value !== 'string' || !/^gea-html-inventory-[a-z]+$/.test(value)))
    )
      throw Error('INVALID_AGENT_RESOURCE_IDENTITY')
    const version = createHash('sha256').update(JSON.stringify(profile)).digest('hex')
    if (this.mounted.has(id) && this.versions.get(id) === version) return
    const previous = this.mounted.get(id)
    if (previous) {
      this.mounted.delete(id)
      this.versions.delete(id)
      await previous()
    }
    const dispose = await this.ctx.agentPresets.register({
      id,
      name: d.label,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: profile.persona, suffix: '', complete: false, includeRuntimeContext: false } },
        { id: 'skill', name: '@deepseek-ai/dsh-tool-skill' },
        ...(d.plugins ?? [])
      ]
    })
    try {
      signal.throwIfAborted()
      if (this.closed || this.entries.get(id) !== entry) throw Error('AGENT_RESOURCE_OWNER_CHANGED')
      const resolved = await this.ctx.agentPresets.resolve(id)
      if (resolved.broken) throw Error(resolved.broken)
      signal.throwIfAborted()
      this.mounted.set(id, dispose)
      this.versions.set(id, version)
      entry.interpreters = interpreters as string[] | undefined
      delete entry.error
    } catch (error) {
      await dispose()
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
          entry.error = `${name}: ${String(error)}`
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
      entry.error = `${locator.name}: ${String(error)}`
      return undefined
    }
  }
  async dispose(): Promise<void> {
    this.closed = true
    this.lifetime.abort()
    for (const entry of this.entries.values()) entry.owner.abort()
    this.unregisterProvider()
    await this.pending.catch(() => {})
    for (const dispose of this.mounted.values()) await dispose()
    this.mounted.clear()
    this.versions.clear()
    this.entries.clear()
  }
}
