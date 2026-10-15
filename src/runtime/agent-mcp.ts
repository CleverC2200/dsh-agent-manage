import { standingMountFor } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { AgentSourceBaseline } from '../contracts/agent-sources.js'
import type { AgentMcpView } from '../contracts/agent-mcp.js'
import type { UserAgentConfig } from '../contracts/user-agents.js'
import type { RuntimeManagement } from '../application/runtime-management.js'
import { USER_MCP_SOURCE, USER_MCP_SUITE } from './mcp-direct-config.js'
import { deriveServerName } from './mcp-config.js'
import { validateServerMcp } from './server-config.js'

const definition = z
  .object({ connectionId: z.uuid(), serverId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/), name: z.string().trim().min(1).max(160), sourceAgentId: z.uuid().optional() })
  .strict()
const association = z.object({ agentId: z.uuid(), connectionId: z.uuid(), enabled: z.boolean(), retired: z.boolean().optional() }).strict()
const stored = z.object({ version: z.literal(1), definitions: z.array(definition), associations: z.array(association) }).strict()
const save = definition.omit({ connectionId: true, sourceAgentId: true }).extend({ agentId: z.uuid(), connectionId: z.uuid().optional(), config: z.unknown() }).strict()
const target = association.omit({ enabled: true }).strict()
const suiteId = USER_MCP_SUITE
type Definition = z.infer<typeof definition>
type Association = z.infer<typeof association>

/** Personal MCP membership, persistence and scoped execution share this owner.
 * Definitions use Catalog.runtime; every managed namespace is masked before tools register. A mutation
 * only accepts personal Agent IDs known by UserAgents, never caller provenance.
 */
export class AgentMcp {
  private definitions: Definition[] = []
  private associations: Association[] = []
  private agents: readonly UserAgentConfig[] = []
  private sourceAvailable: (source: AgentSourceBaseline) => boolean = () => true
  private closed = false
  private queue: Promise<unknown> = Promise.resolve()
  private masks = new Map<ReturnType<Context['agents']['list']>[number], () => void>()
  private readonly stop: Array<() => void>

  constructor(
    private readonly ctx: Context,
    private readonly dataRoot: string,
    private readonly runtime: RuntimeManagement
  ) {
    this.stop = [
      ctx.tools.guard(exec => {
        const connection = this.definitions.find(row => exec.name.startsWith(this.prefix(row)))
        if (exec.name.startsWith('mcp__user-mcp__') && (!connection || !exec.agent || !this.permits(exec.agent, connection.connectionId))) return 'AGENT_MCP_NOT_SELECTED'
        return undefined
      })
    ]
    ctx.effect(() => () => {
      this.stop.forEach(stop => stop())
      this.masks.forEach(stop => stop())
      this.masks.clear()
    })
    for (const event of ['tools/change', 'agent/created', 'agent/disposed', 'agent-preset/selected'] as const) this.stop.push(ctx.on(event, () => this.syncMasks()))
  }

  async load(agents: readonly UserAgentConfig[]): Promise<void> {
    this.agents = agents
    try {
      const value = stored.parse(JSON.parse(await readFile(join(this.dataRoot, 'agent-mcp.json'), 'utf8')))
      this.definitions = value.definitions
      if (
        new Set(this.definitions.map(row => row.connectionId)).size !== this.definitions.length ||
        new Set(this.definitions.map(row => row.serverId)).size !== this.definitions.length
      )
        throw Error('DUPLICATE_MCP_CONNECTION')
      if (value.associations.some(row => !this.definitions.some(connection => connection.connectionId === row.connectionId))) throw Error('MCP_CONNECTION_NOT_FOUND')
      this.associations = value.associations.map(row =>
        this.definitions.find(connection => connection.connectionId === row.connectionId)?.sourceAgentId === row.agentId
          ? {
              ...row,
              retired:
                !agents.find(agent => agent.id === row.agentId)?.source?.importPending &&
                !agents.find(agent => agent.id === row.agentId)?.source?.mcpReferences?.some(reference => reference.connectionId === row.connectionId)
            }
          : row
      )
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    this.syncMasks()
  }

  /** Catalog owns availability. Re-evaluate it on source changes and every dispatch. */
  setSourceAvailability(read: (source: AgentSourceBaseline) => boolean): void {
    this.sourceAvailable = read
    this.sourceAvailabilityChanged()
  }
  sourceAvailabilityChanged(): void {
    this.syncMasks()
  }

  async agentsChanged(agents: readonly UserAgentConfig[]): Promise<void> {
    this.agents = agents
    this.syncMasks()
  }

  async list(agentId: string): Promise<AgentMcpView[]> {
    const agent = this.requireAgent(agentId)
    const status = await this.runtime.mcpStatus()
    return this.associations
      .filter(row => row.agentId === agentId && !row.retired)
      .map(row => {
        const connection = this.find(row.connectionId)
        const entry = status.entries.find(item => item.id === this.runtimeId(connection))
        const enabled = row.enabled && agent.enabled
        let state: AgentMcpView['state']
        if (!enabled) state = 'disabled'
        else if (entry?.connectionState) state = entry.connectionState
        else if (entry?.state === 'connected') state = 'connected'
        else if (entry?.state === 'needs-credentials') state = 'needs-credentials'
        else if (!entry || entry.state === 'disabled') state = 'saved'
        else state = 'failed'
        return {
          connectionId: connection.connectionId,
          serverId: connection.serverId,
          name: connection.name,
          owner: 'user',
          allowedOps: ['edit', 'toggle', 'remove'],
          enabled: row.enabled,
          config: entry?.config ?? {},
          state,
          canReauthorize: enabled && state !== 'needs-credentials' && entry?.canReauthorize === true,
          ...(entry?.reason ? { reason: entry.reason } : {})
        }
      })
  }

  available(agentId: string): Array<Pick<AgentMcpView, 'connectionId' | 'serverId' | 'name'>> {
    this.requireAgent(agentId)
    return this.definitions
      .filter(row => !this.associations.some(link => link.agentId === agentId && link.connectionId === row.connectionId))
      .map(({ connectionId, serverId, name }) => ({ connectionId, serverId, name }))
  }

  save(input: unknown): Promise<AgentMcpView> {
    return this.saveDefinition(save.parse(input))
  }

  /** Internal source import. Root comes from the Host's resolved checkout, never HTTP provenance. */
  importSource(input: {
    agentId: string
    connectionId?: string
    serverId: string
    name: string
    config: unknown
    source: { sourceId: string; suiteId: string; serverKey: string; root: string }
  }): Promise<AgentMcpView> {
    const { source, ...value } = input
    return this.saveDefinition(save.parse(value), source.root, input.agentId)
  }

  private saveDefinition(value: z.infer<typeof save>, sourceRoot?: string, sourceAgentId?: string): Promise<AgentMcpView> {
    return this.write(async () => {
      this.requireAgent(value.agentId)
      const previous = value.connectionId ? this.associated(value.agentId, value.connectionId) : undefined
      if (previous && previous.serverId !== value.serverId) throw Error('MCP_SERVER_ID_IMMUTABLE')
      if (this.definitions.some(row => row.serverId === value.serverId && row.connectionId !== previous?.connectionId)) throw Error('MCP_SERVER_ID_EXISTS')
      // Validate creates before exposing membership. Edits use runtime's redacted merge.
      const config = previous ? value.config : await validateServerMcp(sourceRoot ?? this.dataRoot, value.serverId, value.config)
      const connection: Definition = {
        connectionId: previous?.connectionId ?? randomUUID(),
        serverId: value.serverId,
        name: value.name,
        ...(sourceAgentId ? { sourceAgentId } : previous?.sourceAgentId ? { sourceAgentId: previous.sourceAgentId } : {})
      }
      const definitions = previous ? this.definitions.map(row => (row.connectionId === connection.connectionId ? connection : row)) : [...this.definitions, connection]
      const associations = previous ? this.associations : [...this.associations, { agentId: value.agentId, connectionId: connection.connectionId, enabled: true }]
      const previousDefinitions = this.definitions
      const previousAssociations = this.associations
      // Reserve the namespace fail-closed before runtime can register its first tool.
      this.definitions = definitions
      this.associations = associations
      try {
        await this.persist(definitions, associations)
        if (previous) await this.runtime.saveServerConfig('mcp', this.runtimeId(previous), config)
        else await this.runtime.addMcpServer(value.serverId, config, sourceRoot)
      } catch (error) {
        this.definitions = previousDefinitions
        this.associations = previousAssociations
        await this.persist(previousDefinitions, previousAssociations)
        throw error
      } finally {
        this.syncMasks()
      }
      return (await this.list(value.agentId)).find(row => row.connectionId === connection.connectionId)!
    })
  }

  /** Raw comparison stays Host-side; the original direct definition is the upstream baseline. */
  async sourceConfig(connectionId: string) {
    await this.queue
    return this.runtime.sourceSyncConfig(this.runtimeId(this.find(connectionId)))
  }

  /** Retired source definitions remain mounted for the Core revisions that still retain them. */
  sourceRevision(agentId: string, connectionIds: string[]): Promise<void> {
    return this.write(async () => {
      const associations = this.associations.map(row =>
        row.agentId === agentId && this.find(row.connectionId).sourceAgentId === agentId ? { ...row, retired: !connectionIds.includes(row.connectionId) } : row
      )
      await this.persist(this.definitions, associations)
      this.associations = associations
      this.syncMasks()
    })
  }

  associate(input: unknown): Promise<AgentMcpView[]> {
    const value = association.parse(input)
    return this.write(async () => {
      this.requireAgent(value.agentId)
      this.find(value.connectionId)
      const associations = [...this.associations.filter(row => row.agentId !== value.agentId || row.connectionId !== value.connectionId), value]
      await this.persist(this.definitions, associations)
      this.associations = associations
      this.syncMasks()
      return this.list(value.agentId)
    })
  }

  setEnabled(input: unknown): Promise<AgentMcpView[]> {
    const value = association.parse(input)
    this.associated(value.agentId, value.connectionId)
    return this.associate(value)
  }

  remove(input: unknown): Promise<AgentMcpView[]> {
    const value = target.parse(input)
    return this.write(async () => {
      this.associated(value.agentId, value.connectionId)
      const associations = this.associations.filter(row => row.agentId !== value.agentId || row.connectionId !== value.connectionId)
      await this.persist(this.definitions, associations)
      this.associations = associations
      this.syncMasks()
      return this.list(value.agentId)
    })
  }

  reauthorize(input: unknown): Promise<AgentMcpView[]> {
    const value = target.parse(input)
    return this.write(async () => {
      const connection = this.associated(value.agentId, value.connectionId)
      const entry = (await this.list(value.agentId)).find(row => row.connectionId === connection.connectionId)
      if (!entry?.canReauthorize) throw Error('MCP_REAUTHORIZE_UNAVAILABLE')
      await this.runtime.reauthorizeMcpServer(deriveServerName(suiteId, connection.serverId))
      return this.list(value.agentId)
    })
  }

  async cancelAuthorization(input: unknown): Promise<AgentMcpView[]> {
    const value = target.parse(input)
    const connection = this.associated(value.agentId, value.connectionId)
    this.runtime.cancelMcpAuthorization(deriveServerName(suiteId, connection.serverId))
    return this.list(value.agentId)
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.syncMasks()
    await this.queue
    // Keep masks and dispatch guard until Host teardown: shared runtime mounts
    // can outlive UserAgents while its preset releases are still settling.
  }

  private requireAgent(id: string): UserAgentConfig {
    const agent = this.agents.find(row => row.id === id)
    if (!agent) throw Error('USER_AGENT_NOT_FOUND')
    if (agent.deletedAt) throw Error('USER_AGENT_DELETED: restore configuration before editing connections')
    return agent
  }
  private find(id: string): Definition {
    const connection = this.definitions.find(row => row.connectionId === id)
    if (!connection) throw Error('MCP_CONNECTION_NOT_FOUND')
    return connection
  }
  private associated(agentId: string, connectionId: string): Definition {
    this.requireAgent(agentId)
    if (!this.associations.some(row => row.agentId === agentId && row.connectionId === connectionId)) throw Error('MCP_ASSOCIATION_NOT_FOUND')
    return this.find(connectionId)
  }
  private runtimeId(connection: Definition): string {
    return `plugin:${USER_MCP_SOURCE}/${USER_MCP_SUITE}/${connection.serverId}`
  }
  private prefix(connection: Definition): string {
    return `mcp__${deriveServerName(suiteId, connection.serverId)}__`
  }
  private permits(agent: ReturnType<Context['agents']['list']>[number], connectionId: string): boolean {
    const preset = this.ctx.agentPresets.composedPreset(agent.ctx)
    const connection = this.find(connectionId)
    const selected = this.agents.find(row => row.enabled && !row.deletedAt && preset === `user-agent-${row.id}`)
    if (this.closed || !selected || (selected.source && !this.sourceAvailable(selected.source))) return false
    const link = this.associations.find(row => row.agentId === selected.id && row.connectionId === connectionId)
    if (!link?.enabled) return false
    if (connection.sourceAgentId === selected.id) {
      const mount = standingMountFor(agent.ctx)
      const declaration = mount && [...mount.tree.entries()].find(row => row.options.name === 'dsh-agent-manage/user-agent-skills')
      const references = declaration?.options.config?.sourceMcpConnections
      return Array.isArray(references) && references.includes(connectionId)
    }
    return !link.retired
  }
  private syncing = false
  private syncMasks(): void {
    if (this.syncing) return
    this.syncing = true
    try {
      const agents = new Set(this.ctx.agents.list())
      for (const [agent, stop] of this.masks)
        if (!agents.has(agent)) {
          this.masks.delete(agent)
          stop()
        }
      const tools = this.ctx.tools.schemas().map(row => row.name)
      for (const agent of agents) {
        const deny = tools.filter(
          name => name.startsWith('mcp__user-mcp__') && !this.definitions.some(row => name.startsWith(this.prefix(row)) && this.permits(agent, row.connectionId))
        )
        const old = this.masks.get(agent)
        this.masks.set(agent, agent.ctx.tools.restrict({ deny }))
        old?.()
      }
    } finally {
      this.syncing = false
    }
  }
  private write<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      if (this.closed) throw Error('AGENT_MCP_DISPOSED')
      return operation()
    })
    this.queue = result.catch(() => {})
    return result
  }
  private async persist(definitions: Definition[], associations: Association[]): Promise<void> {
    await mkdir(this.dataRoot, { recursive: true })
    const file = join(this.dataRoot, 'agent-mcp.json')
    await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, definitions, associations }, null, 2), { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }
}
