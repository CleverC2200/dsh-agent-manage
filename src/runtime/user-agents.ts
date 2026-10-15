import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
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
export const agentSkills = z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reference'), name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), provider: z.string().min(1), path: z.string().optional(), enabled: z.boolean(), content: z.string().trim().min(1).max(96000).optional() }),
  z.object({ kind: z.literal('personal'), name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().min(1).max(1000), content: z.string().trim().min(1).max(96000), enabled: z.boolean() })
])).max(200).refine(skills => new Set(skills.map(skill => skill.name)).size === skills.length, 'DUPLICATE_AGENT_SKILL')
const savedAgent = z.object({ ...fields, id: z.uuid(), skills: agentSkills.default([]), revision: z.number().int().positive() })
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

  readonly mcp?: AgentMcp

  constructor(
    private readonly ctx: Context,
    private readonly file: string,
    runtime?: RuntimeManagement
  ) { if (runtime) this.mcp = new AgentMcp(ctx, dirname(file), runtime) }

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
      const agent: UserAgentConfig = { ...value, skills: previous?.skills ?? [], id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1 }
      const next = previous ? this.agents.map(row => (row.id === agent.id ? agent : row)) : [...this.agents, agent]
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
      if (agent.enabled) await this.publish(agent, true)
      else await this.withdraw(agent.id)
      return this.view(agent)
    })
  }

  async skillCatalog(cwd?: string, signal?: AbortSignal): Promise<UserAgentSkillOption[]> {
    return (await this.ctx.skills.list({ cwd, signal })).filter(skill => skill.invocation.userInvocable || skill.invocation.modelInvocable)
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
      const next = this.agents.map(row => row.id === id ? agent : row)
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
      const next = this.agents.map(row => (row.id === id ? agent : row))
      await this.persist(next)
      this.agents = next
      await this.mcp?.agentsChanged(this.agents)
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
    await this.mcp?.dispose()
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
    for (const skill of agent.skills) if (skill.kind === 'reference' && skill.enabled) await this.readSkill(skill.name, skill.provider, undefined, undefined, skill.path)
    return this.ctx.agentPresets.register(
      await composeStandardPreset(
        this.ctx.agentPresets,
        {
          id: this.preset(agent.id),
          name: agent.name,
          description: agent.description
        },
        { personaPrefix: agent.prompt, plugins: [{ id: 'user-agent-skills', name: 'dsh-agent-manage/user-agent-skills', config: { skills: agent.skills } }] }
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
    let error = this.errors.get(agent.id)
    if (agent.enabled && !error) {
      try {
        await this.assertReady(agent.id)
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
      }
    }
    return { ...agent, origin: 'user', preset: this.preset(agent.id), publication: !agent.enabled ? 'disabled' : error ? 'failed' : 'ready', ...(error ? { error } : {}) }
  }
}
