import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { AgentSourceBaseline } from '../contracts/agent-sources.js'
import type { UserAgentConfig, UserAgentView } from '../contracts/user-agents.js'
import { composeStandardPreset } from './standard-preset.js'

const fields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  prompt: z.string().trim().min(1).max(48_000),
  enabled: z.boolean()
}
const sourceBaseline = z.object({
  sourceId: z.string(),
  suiteId: z.string(),
  resourceKey: z.string(),
  url: z.string(),
  kind: z.enum(['git', 'local', 'archive']),
  lockCommit: z.string().optional(),
  version: z.string().optional(),
  base: z.object({ name: fields.name, description: fields.description, prompt: fields.prompt })
})
const savedAgent = z.object({ ...fields, id: z.uuid(), revision: z.number().int().positive(), source: sourceBaseline.optional() })
const saveAgent = z.object({ ...fields, id: z.uuid().optional() })
const document = z.object({ version: z.literal(1), agents: z.array(savedAgent) })

/** Owns durable personal configurations and their official preset publication.
 * Writes are serialized; the registry retains old revisions for live Sessions.
 * Saving records the editable configuration even if its publication fails.
 */
export class UserAgents {
  private agents: UserAgentConfig[] = []
  private releases = new Map<string, () => Promise<void>>()
  private published = new Map<string, UserAgentConfig>()
  private errors = new Map<string, string>()
  private pending: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    private readonly ctx: Pick<Context, 'agentPresets'>,
    private readonly file: string
  ) {}

  async load(): Promise<void> {
    try {
      this.agents = document.parse(JSON.parse(await readFile(this.file, 'utf8'))).agents
      if (new Set(this.agents.map(agent => agent.id)).size !== this.agents.length) throw Error('DUPLICATE_USER_AGENT')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    // During Host activation only register, never await the whole Loader tree.
    // Actual availability is audited by list/select after the Host has settled.
    for (const agent of this.agents) if (agent.enabled) await this.publish(agent, false)
  }

  async list(): Promise<UserAgentView[]> {
    await this.pending
    return Promise.all(this.agents.map(agent => this.view(agent)))
  }

  save(input: unknown): Promise<UserAgentView> {
    const value = saveAgent.parse(input)
    return this.write(async () => {
      const previous = value.id ? this.find(value.id) : undefined
      const agent: UserAgentConfig = {
        ...value,
        id: previous?.id ?? randomUUID(),
        revision: (previous?.revision ?? 0) + 1,
        ...(previous?.source ? { source: previous.source } : {})
      }
      const next = previous ? this.agents.map(row => (row.id === agent.id ? agent : row)) : [...this.agents, agent]
      await this.persist(next)
      this.agents = next
      if (agent.enabled) await this.publish(agent, true)
      else await this.withdraw(agent.id)
      return this.view(agent)
    })
  }

  /** Imports only Host-discovered configuration; repeat imports preserve user customization. */
  importSource(input: unknown, source: AgentSourceBaseline): Promise<UserAgentView> {
    const value = saveAgent.omit({ id: true }).parse(input)
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
      if (agent.enabled) await this.publish(agent, true)
      return this.view(agent)
    })
  }

  setEnabled(id: string, enabled: boolean): Promise<UserAgentView> {
    return this.write(async () => {
      const agent = { ...this.find(id), enabled }
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      if (enabled) await this.publish(agent, true)
      else await this.withdraw(id)
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
    for (const id of this.releases.keys()) await this.withdraw(id)
  }

  private find(id: string): UserAgentConfig {
    const agent = this.agents.find(row => row.id === id)
    if (!agent) throw Error('USER_AGENT_NOT_FOUND')
    return agent
  }

  private write<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(() => {
      if (this.closed) throw Error('USER_AGENTS_DISPOSED')
      return action()
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

  private async register(agent: UserAgentConfig): Promise<() => Promise<void>> {
    return this.ctx.agentPresets.register(
      await composeStandardPreset(
        this.ctx.agentPresets,
        {
          id: this.preset(agent.id),
          name: agent.name,
          description: agent.description
        },
        { personaPrefix: agent.prompt }
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
    const preset = await this.ctx.agentPresets.resolve(this.preset(id))
    if (preset.broken) throw Error(preset.broken)
  }

  private async view(agent: UserAgentConfig): Promise<UserAgentView> {
    let error = this.errors.get(agent.id)
    if (agent.enabled && !error) {
      try {
        await this.assertReady(agent.id)
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
      }
    }
    return {
      ...agent,
      customized: agent.source !== undefined && (['name', 'description', 'prompt'] as const).some(key => agent[key] !== agent.source!.base[key]),
      origin: 'user',
      preset: this.preset(agent.id),
      publication: !agent.enabled ? 'disabled' : error ? 'failed' : 'ready',
      ...(error ? { error } : {})
    }
  }
}
