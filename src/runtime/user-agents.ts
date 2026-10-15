import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { AgentSourceBaseline } from '../contracts/agent-sources.js'
import type { UserAgentConfig, UserAgentView, UserAgentSkillOption } from '../contracts/user-agents.js'
import type { RuntimeManagement } from '../application/runtime-management.js'
import { AgentMcp } from './agent-mcp.js'
import { composeStandardPreset } from './standard-preset.js'

const fields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  prompt: z.string().trim().min(1).max(48_000),
  enabled: z.boolean()
}
export const agentSkills = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('reference'),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        provider: z.string().min(1),
        path: z.string().optional(),
        enabled: z.boolean(),
        content: z.string().trim().min(1).max(96000).optional()
      }),
      z.object({
        kind: z.literal('personal'),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().trim().min(1).max(1000),
        content: z.string().trim().min(1).max(96000),
        enabled: z.boolean()
      })
    ])
  )
  .max(200)
  .refine(skills => new Set(skills.map(skill => skill.name)).size === skills.length, 'DUPLICATE_AGENT_SKILL')
const sourceBaseline = z.object({
  sourceId: z.string(),
  suiteId: z.string(),
  resourceKey: z.string(),
  url: z.string(),
  kind: z.enum(['git', 'local', 'archive']),
  lockCommit: z.string().optional(),
  version: z.string().optional(),
  importPending: z.boolean().optional(),
  mcpReferences: z
    .array(z.object({ serverKey: z.string(), serverId: z.string(), connectionId: z.uuid(), removed: z.boolean().optional(), baseMissing: z.boolean().optional() }))
    .optional(),
  base: z.object({ name: fields.name, description: fields.description, prompt: fields.prompt, skills: agentSkills.default([]) })
})
const savedAgent = z.object({
  ...fields,
  id: z.uuid(),
  skills: agentSkills.default([]),
  revision: z.number().int().positive(),
  source: sourceBaseline.optional(),
  deletedAt: z.iso.datetime().optional()
})
const saveAgent = z.object({ ...fields, id: z.uuid().optional() })
const document = z.object({ version: z.literal(1), agents: z.array(savedAgent) })

/** Owns durable personal configurations and their official preset publication.
 * Writes are serialized; the registry retains old revisions for live Sessions.
 * Saving records the editable configuration even if its publication fails.
 */
export class UserAgents {
  private agents: UserAgentConfig[] = []
  private releases = new Map<string, () => Promise<void>>()
  private retiredReleases = new Set<() => Promise<void>>()
  private published = new Map<string, UserAgentConfig>()
  private errors = new Map<string, string>()
  private pending: Promise<unknown> = Promise.resolve()
  private closed = false
  private readonly listeners = new Set<() => void>()

  readonly mcp?: AgentMcp

  constructor(
    private readonly ctx: Context,
    private readonly file: string,
    runtime?: RuntimeManagement
  ) {
    if (runtime) this.mcp = new AgentMcp(ctx, dirname(file), runtime)
  }

  async load(): Promise<void> {
    try {
      this.agents = document.parse(JSON.parse(await readFile(this.file, 'utf8'))).agents
      if (new Set(this.agents.map(agent => agent.id)).size !== this.agents.length) throw Error('DUPLICATE_USER_AGENT')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    await this.mcp?.load(this.agents)
    // During Host activation only register, never await the whole Loader tree.
    // Actual availability is audited by list/select after the Host has settled.
    for (const agent of this.agents) if (agent.enabled && !agent.deletedAt) await this.publish(agent, false)
  }

  /** Observe committed lifecycle/configuration changes; listeners may start async reads.
   * Notifications are synchronous signals and are never awaited inside the write queue.
   */
  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async list(): Promise<UserAgentView[]> {
    await this.pending
    return Promise.all(this.agents.map(agent => this.view(agent)))
  }

  save(input: unknown): Promise<UserAgentView> {
    const value = saveAgent.parse(input)
    return this.write(async () => {
      const previous = value.id ? this.find(value.id) : undefined
      if (previous?.source?.importPending && value.enabled) throw Error('AGENT_SOURCE_IMPORT_INCOMPLETE')
      const agent: UserAgentConfig = {
        ...value,
        skills: previous?.skills ?? [],
        id: previous?.id ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        ...(previous?.source ? { source: previous.source } : {})
      }
      const next = previous ? this.agents.map(row => (row.id === agent.id ? agent : row)) : [...this.agents, agent]
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      if (agent.enabled) await this.publish(agent, true)
      else await this.withdraw(agent.id)
      return this.view(agent)
    })
  }

  /** Imports only Host-discovered configuration; repeat imports preserve user customization. */
  importSource(input: unknown, source: AgentSourceBaseline): Promise<UserAgentView> {
    const value = saveAgent
      .omit({ id: true })
      .extend({ skills: agentSkills.default([]) })
      .parse(input)
    const provenance = sourceBaseline.parse(source)
    return this.write(async () => {
      const existing = this.agents.find(
        agent => agent.source?.sourceId === source.sourceId && agent.source?.suiteId === source.suiteId && agent.source?.resourceKey === source.resourceKey
      )
      if (existing) return this.view(existing)
      const agent: UserAgentConfig = { ...value, id: randomUUID(), revision: 1, source: provenance }
      const next = [...this.agents, agent]
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      if (agent.enabled) await this.publish(agent, true)
      return this.view(agent)
    })
  }

  /** Complete a multi-resource import only after its external MCP associations exist. */
  finishSourceImport(id: string, mcpReferences: NonNullable<AgentSourceBaseline['mcpReferences']>): Promise<UserAgentView> {
    return this.write(async () => {
      const previous = this.find(id)
      if (!previous.source?.importPending) throw Error('AGENT_SOURCE_IMPORT_NOT_PENDING')
      const source = sourceBaseline.parse({ ...previous.source, importPending: false, mcpReferences })
      const agent = { ...previous, source, enabled: true }
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      await this.publish(agent, true)
      return this.view(agent)
    })
  }

  /** Commit an already resolved source candidate. Unlike ordinary edits, a failed sync
   * keeps the previous durable configuration and its usable declaration. */
  syncSource(id: string, expectedRevision: number, input: unknown, source: AgentSourceBaseline, signal?: AbortSignal): Promise<UserAgentView> {
    const value = savedAgent.parse(input)
    return this.write(async () => {
      const previous = this.find(id)
      if (previous.revision !== expectedRevision) throw Error('AGENT_SOURCE_PREVIEW_STALE')
      const agent = { ...value, id, revision: previous.revision + 1, enabled: previous.enabled, source: sourceBaseline.parse(source) }
      const next = this.agents.map(row => (row.id === id ? agent : row))
      let swapped = false
      try {
        signal?.throwIfAborted()
        for (const release of this.retiredReleases) {
          await release()
          this.retiredReleases.delete(release)
        }
        // The registry rejects duplicate ids. Audit the complete candidate under a
        // temporary identity before replacing the selectable stable identity.
        if (agent.enabled) {
          const candidateId = `${this.preset(id)}-candidate`
          const release = await this.register(agent, candidateId)
          this.retiredReleases.add(release)
          try {
            const candidate = await this.ctx.agentPresets.resolve(candidateId)
            if (candidate.broken) throw Error(candidate.broken)
          } finally {
            await release()
            this.retiredReleases.delete(release)
          }
        } else for (const skill of agent.skills) if (skill.kind === 'reference' && skill.enabled) await this.readSkill(skill.name, skill.provider, undefined, signal, skill.path)
        signal?.throwIfAborted()
        if (agent.enabled) {
          swapped = true
          await this.withdraw(id)
          this.releases.set(id, await this.register(agent))
          const candidate = await this.ctx.agentPresets.resolve(this.preset(id))
          if (candidate.broken) throw Error(candidate.broken)
        }
        signal?.throwIfAborted()
        await this.persist(next)
        this.agents = next
        if (agent.enabled) this.published.set(id, agent)
        this.errors.delete(id)
        await this.mcp?.agentsChanged(next)
        return this.view(agent)
      } catch (error) {
        if (swapped) {
          await this.withdraw(id)
          this.releases.set(id, await this.register(previous))
          this.published.set(id, previous)
        }
        // The failed candidate is not saved. The caller retains the preview for retry.
        throw error
      }
    })
  }

  async skillCatalog(cwd?: string, signal?: AbortSignal): Promise<UserAgentSkillOption[]> {
    return (await this.ctx.skills.list({ cwd, signal }))
      .filter(skill => skill.invocation.userInvocable || skill.invocation.modelInvocable)
      .map(({ name, description, provider, path }) => ({ name, description, provider, ...(path ? { path } : {}) }))
  }

  async readSkill(name: string, provider: string, cwd?: string, signal?: AbortSignal, path?: string): Promise<{ content: string }> {
    const skill = await this.ctx.skills.get(name, { cwd, signal })
    if (!skill || skill.provider !== provider || (path !== undefined && skill.path !== path)) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${name}`)
    return { content: skill.content }
  }

  saveSkills(id: string, input: unknown): Promise<UserAgentView> {
    const skills = agentSkills.parse(input)
    return this.write(async () => {
      const previous = this.find(id)
      const agent = { ...previous, skills, revision: previous.revision + 1 }
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      if (agent.enabled) await this.publish(agent, true)
      return this.view(agent)
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<UserAgentView> {
    return this.write(async () => {
      const agent = { ...this.find(id), enabled }
      if (enabled && agent.source?.importPending) throw Error('AGENT_SOURCE_IMPORT_INCOMPLETE')
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      if (enabled) await this.publish(agent, true)
      else await this.withdraw(id)
      return this.view(agent)
    })
  }

  /** Retire only the personal configuration. Core owns all Sessions and drafts. */
  remove(id: string): Promise<UserAgentView> {
    return this.write(async () => {
      const previous = this.find(id)
      const agent = { ...previous, enabled: false, deletedAt: new Date().toISOString() }
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      await this.withdraw(id)
      return this.view(agent)
    })
  }

  /** Restore configuration only; enabling its capabilities is a separate user action. */
  restore(id: string): Promise<UserAgentView> {
    return this.write(async () => {
      const deleted = this.find(id, true)
      if (!deleted.deletedAt) throw Error('USER_AGENT_NOT_DELETED')
      const agent = { ...deleted, enabled: false }
      delete agent.deletedAt
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      return this.view(agent)
    })
  }

  async select(id: string): Promise<{ preset: string }> {
    await this.pending
    const view = await this.view(this.find(id))
    if (view.publication !== 'ready') throw Error(view.error ?? 'USER_AGENT_DISABLED')
    return { preset: view.preset }
  }

  async dispose(): Promise<void> {
    this.closed = true
    await this.pending
    await this.mcp?.dispose()
    for (const id of this.releases.keys()) await this.withdraw(id)
    for (const release of this.retiredReleases) {
      await release()
      this.retiredReleases.delete(release)
    }
    this.listeners.clear()
  }

  private find(id: string, includeDeleted = false): UserAgentConfig {
    const agent = this.agents.find(row => row.id === id)
    if (!agent) throw Error('USER_AGENT_NOT_FOUND')
    if (agent.deletedAt && !includeDeleted) throw Error('USER_AGENT_DELETED: restore configuration before enabling')
    return agent
  }

  private write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => {
      if (this.closed) throw Error('USER_AGENTS_DISPOSED')
      return action().then(value => {
        for (const listener of this.listeners) listener()
        return value
      })
    })
    this.pending = result.catch(() => {})
    return result
  }

  private async persist(agents: UserAgentConfig[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, agents }, null, 2), { mode: 0o600 })
    await rename(temporary, this.file)
  }

  private preset(id: string): string {
    return `user-agent-${id}`
  }

  private async register(agent: UserAgentConfig, presetId = this.preset(agent.id)): Promise<() => Promise<void>> {
    for (const skill of agent.skills) if (skill.kind === 'reference' && skill.enabled) await this.readSkill(skill.name, skill.provider, undefined, undefined, skill.path)
    return this.ctx.agentPresets.register(
      await composeStandardPreset(
        this.ctx.agentPresets,
        {
          id: presetId,
          name: agent.name,
          description: agent.description
        },
        {
          personaPrefix: agent.prompt,
          plugins: [
            {
              id: 'user-agent-skills',
              name: 'dsh-agent-manage/user-agent-skills',
              config: { skills: agent.skills, sourceMcpConnections: agent.source?.mcpReferences?.filter(row => !row.removed).map(row => row.connectionId) ?? [] }
            }
          ]
        }
      )
    )
  }

  private async publish(agent: UserAgentConfig, audit: boolean): Promise<void> {
    const previous = this.published.get(agent.id)
    try {
      await this.withdraw(agent.id)
      this.releases.set(agent.id, await this.register(agent))
      if (audit) await this.assertReady(agent.id)
      this.published.set(agent.id, agent)
      this.errors.delete(agent.id)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      await this.withdraw(agent.id)
      // Keep the last usable declaration available to durable old Sessions.
      if (previous) {
        this.releases.set(agent.id, await this.register(previous))
        this.published.set(agent.id, previous)
      }
      this.errors.set(agent.id, reason)
    }
  }

  private async withdraw(id: string): Promise<void> {
    await this.releases.get(id)?.()
    this.releases.delete(id)
    this.published.delete(id)
    this.errors.delete(id)
  }

  private async assertReady(id: string): Promise<void> {
    for (const skill of this.find(id).skills) if (skill.kind === 'reference' && skill.enabled) await this.readSkill(skill.name, skill.provider, undefined, undefined, skill.path)
    const preset = await this.ctx.agentPresets.resolve(this.preset(id))
    if (preset.broken) throw Error(preset.broken)
  }

  private async view(agent: UserAgentConfig): Promise<UserAgentView> {
    let error = agent.source?.importPending ? 'AGENT_SOURCE_IMPORT_INCOMPLETE' : this.errors.get(agent.id)
    if (agent.enabled && !error) {
      try {
        await this.assertReady(agent.id)
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
      }
    }
    return {
      ...agent,
      customized:
        (agent.source !== undefined && (['name', 'description', 'prompt'] as const).some(key => agent[key] !== agent.source!.base[key])) ||
        (agent.source !== undefined && JSON.stringify(agent.skills) !== JSON.stringify(agent.source.base.skills)),
      origin: 'user',
      preset: this.preset(agent.id),
      publication: agent.deletedAt ? 'deleted' : agent.source?.importPending ? 'failed' : !agent.enabled ? 'disabled' : error ? 'failed' : 'ready',
      defaultUnavailable: this.ctx.agentPresets.defaultId === this.preset(agent.id) && (!agent.enabled || !!error || !!agent.deletedAt),
      ...(error ? { error } : {})
    }
  }
}
