import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { skillDirectoryFiles } from './skill-directories.js'
import type { Catalog } from '../application/catalog.js'
import { componentPath, defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { expandHome } from '../catalog/paths.js'
import type { AgentSourceBaseline, AgentSourceCandidate, AgentSourceView, AgentSourcePreview } from '../contracts/agent-sources.js'
import type { UserAgentConfig, UserAgentSkill } from '../contracts/user-agents.js'
import { resolveSourceKind, type Suite } from '../model/types.js'
import { redactMcpConfig } from './mcp-redaction.js'
import { restoreRedactedConfig } from './server-config.js'
import { agentSkills } from './user-agents.js'
import { parseAgentRole } from './agent-role-router.js'
import { sourceResolutions, sourceSyncEntry as entry, resolveSourceEntry, type SourceSyncEntry as SyncEntry } from './source-sync.js'
import type { UserAgents } from './user-agents.js'

const acquisition = z
  .object({
    url: z.string().trim().min(1),
    kind: z.enum(['git', 'local', 'archive']),
    branch: z.string().trim().min(1).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional()
  })
  .strict()
const selection = z.object({ sourceId: z.string().min(1), suiteId: z.string().min(1), resourceKey: z.string().min(1) }).strict()
type Discovered = AgentSourceCandidate & { base?: AgentSourceBaseline['base'] }

const syncTarget = z.object({ id: z.uuid() }).strict()
const syncToken = z.object({ token: z.uuid() }).strict()
const syncCommit = syncToken
  .extend({
    resolutions: sourceResolutions
  })
  .strict()
type SourceSnapshot = Awaited<ReturnType<Catalog['readSourceSnapshot']>> & { base: AgentSourceBaseline['base']; skillContents: Awaited<ReturnType<typeof skillDirectoryFiles>>[] }
type SyncPlan = {
  agent: UserAgentConfig
  source: AgentSourceBaseline
  snapshot: SourceSnapshot
  entries: SyncEntry[]
  root: string
  staged: Map<string, { connectionId: string; serverId: string }>
}
const same = isDeepStrictEqual

/** Source acquisition/discovery uses Catalog; editable snapshots and publication belong to UserAgents. */
export class AgentSources {
  private pending: Promise<unknown> = Promise.resolve()
  private plans = new Map<string, SyncPlan>()
  constructor(
    private readonly catalog: Catalog,
    private readonly agents: UserAgents
  ) {
    agents.mcp?.setSourceAvailability(source => catalog.sources.some(row => row.id === source.sourceId && row.url === source.url))
  }

  changed(): void {
    this.agents.mcp?.sourceAvailabilityChanged()
  }

  async list(): Promise<AgentSourceView[]> {
    const overview = await this.catalog.overview()
    const snapshot = await this.catalog.readUserCatalog()
    return Promise.all(
      overview.sources.map(async source => {
        const candidates = (await Promise.all(snapshot.suites.filter(suite => suite.sourceId === source.id).map(suite => this.discover(suite)))).flat()
        return {
          id: source.id,
          url: source.url,
          kind: resolveSourceKind(this.catalog.sources.find(row => row.id === source.id)!),
          ...(source.lockCommit ? { lockCommit: source.lockCommit } : {}),
          candidates: candidates.map(({ base: _base, ...candidate }) => candidate),
          errors: [...(source.error ? [source.error] : []), ...(source.scanNotes ?? [])]
        }
      })
    )
  }

  acquire(input: unknown, signal?: AbortSignal): Promise<AgentSourceView> {
    const value = acquisition.parse(input)
    const result = this.pending.then(async () => {
      signal?.throwIfAborted()
      const existing = this.catalog.sources.find(
        source =>
          resolveSourceKind(source) === value.kind &&
          (value.kind === 'git' ? canonicalGitUrl(source.url) === canonicalGitUrl(value.url) : expandHome(source.url) === expandHome(value.url)) &&
          source.branch === value.branch
      )
      if (existing && value.sha256 && existing.sha256 !== value.sha256) throw Error('AGENT_SOURCE_LOCK_MISMATCH')
      const source = existing ?? (await this.catalog.addSource(value))
      signal?.throwIfAborted()
      return (await this.list()).find(row => row.id === source.id)!
    })
    this.pending = result.catch(() => {})
    return result
  }

  import(input: unknown, signal?: AbortSignal) {
    const value = selection.parse(input)
    const result = this.pending.then(async () => {
      signal?.throwIfAborted()
      const existing = (await this.agents.list()).find(
        agent => agent.source?.sourceId === value.sourceId && agent.source?.suiteId === value.suiteId && agent.source?.resourceKey === value.resourceKey
      )
      if (existing && !existing.source?.importPending) return existing
      const source = (await this.list()).find(row => row.id === value.sourceId)
      if (!source) throw Error('AGENT_SOURCE_NOT_FOUND')
      const suite = (await this.catalog.readUserCatalog()).suites.find(row => row.sourceId === source.id && row.id === value.suiteId)
      if (!suite) throw Error('AGENT_SOURCE_SUITE_NOT_FOUND')
      const candidate = (await this.discover(suite)).find(row => row.resourceKey === value.resourceKey)
      if (!candidate?.base) throw Error(candidate?.error ?? 'AGENT_SOURCE_CONFIGURATION_NOT_FOUND')
      const skills = await this.sourceSkills(suite, signal)
      const base = { ...candidate.base, skills }
      signal?.throwIfAborted()
      const hasMcp = Object.keys(suite.mcp?.servers ?? {}).length > 0
      if (hasMcp && !this.agents.mcp) throw Error('AGENT_SOURCE_MCP_UNAVAILABLE')
      const agent =
        existing ??
        (await this.agents.importSource(
          { ...base, enabled: !hasMcp },
          {
            sourceId: source.id,
            suiteId: suite.id,
            resourceKey: candidate.resourceKey,
            url: source.url,
            kind: source.kind,
            ...(source.lockCommit ? { lockCommit: source.lockCommit } : {}),
            ...(suite.manifest.version ? { version: suite.manifest.version } : {}),
            base,
            ...(hasMcp ? { importPending: true } : {})
          }
        ))
      if (!hasMcp) return agent
      const mcp = this.agents.mcp!
      const associations = await mcp.list(agent.id)
      const references: NonNullable<AgentSourceBaseline['mcpReferences']> = []
      const servers = Object.entries(suite.mcp!.servers).sort(([a], [b]) => a.localeCompare(b))
      for (const [index, [serverKey, config]] of servers.entries()) {
        signal?.throwIfAborted()
        const serverId = `import-${agent.id.slice(0, 8)}-${index}-${serverKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 64)
        const previous = associations.find(row => row.serverId === serverId)
        const connection =
          previous ??
          (await mcp.importSource({
            agentId: agent.id,
            serverId,
            name: serverKey.slice(0, 160),
            config,
            source: { sourceId: suite.sourceId, suiteId: suite.id, serverKey, root: suite.mcp?.root ?? suite.root }
          }))
        references.push({ serverKey, serverId, connectionId: connection.connectionId })
      }
      signal?.throwIfAborted()
      return this.agents.finishSourceImport(agent.id, references)
    })
    this.pending = result.catch(() => {})
    return result
  }

  /** Capture old source and effective MCP values before Catalog may reset a checkout. */
  preview(input: unknown, signal?: AbortSignal): Promise<AgentSourcePreview> {
    const { id } = syncTarget.parse(input)
    return this.serialize(async () => {
      signal?.throwIfAborted()
      const agent = (await this.agents.list()).find(row => row.id === id && !row.deletedAt)
      if (!agent?.source || agent.source.importPending) throw Error('AGENT_SOURCE_NOT_IMPORTED')
      // Preview state never crosses restart and is superseded by a newer preview.
      for (const [token, plan] of this.plans) if (plan.agent.source?.sourceId === agent.source.sourceId) this.plans.delete(token)
      const mcp = new Map<string, { base: unknown; local: unknown }>()
      const associations = (await this.agents.mcp?.list(id)) ?? []
      for (const reference of agent.source.mcpReferences ?? []) {
        const current = associations.find(row => row.connectionId === reference.connectionId)
        const config = await this.agents.mcp!.sourceConfig(reference.connectionId)
        mcp.set(reference.serverKey, {
          base: reference.baseMissing ? null : { name: reference.serverKey.slice(0, 160), config: config.base, enabled: true },
          local: current ? { name: current.name, config: config.local, enabled: current.enabled } : null
        })
      }
      await this.catalog.refreshSource(agent.source.sourceId)
      signal?.throwIfAborted()
      const snapshot = await this.captureSource(agent.source, signal)
      const { suite } = snapshot
      const skills = await this.sourceSkills(suite, signal)
      const base = { ...snapshot.base, skills }
      const entries: SyncEntry[] = (['name', 'description', 'prompt'] as const).map(key => entry(key, agent.source!.base[key], agent[key], base[key]))
      const skillNames = new Set([...agent.source.base.skills, ...agent.skills, ...skills].map(skill => skill.name))
      for (const name of skillNames) {
        const baseSkill = agent.source.base.skills.find(row => row.name === name) ?? null
        const localSkill = agent.skills.find(row => row.name === name) ?? null
        const upstreamSkill = skills.find(row => row.name === name) ?? null
        const [baseValue, localValue, upstreamValue] = await Promise.all([baseSkill, localSkill, upstreamSkill].map(skill => this.agents.directories.comparison(skill)))
        entries.push({
          key: `skill:${name}`,
          base: baseSkill,
          local: localSkill,
          upstream: upstreamSkill,
          localChanged: !same(localValue, baseValue),
          upstreamChanged: !same(upstreamValue, baseValue),
          conflict: !same(localValue, baseValue) && !same(upstreamValue, baseValue) && !same(localValue, upstreamValue)
        })
      }
      for (const key of new Set([...mcp.keys(), ...Object.keys(suite.mcp?.servers ?? {})])) {
        const old = mcp.get(key)
        const upstream = suite.mcp?.servers[key]
        entries.push(entry(`mcp:${key}`, old?.base ?? null, old?.local ?? null, upstream ? { name: key.slice(0, 160), config: upstream, enabled: true } : null))
      }
      const provenance: AgentSourceBaseline = { ...agent.source, base, lockCommit: snapshot.lockCommit, version: suite.manifest.version }
      const token = randomUUID()
      signal?.throwIfAborted()
      await this.assertSourceSnapshot(provenance, snapshot, signal)
      this.plans.set(token, { agent, source: provenance, snapshot, entries, root: suite.mcp?.root ?? suite.root, staged: new Map() })
      return {
        token,
        agentId: id,
        changed: entries.some(row => row.upstreamChanged) || agent.source.lockCommit !== provenance.lockCommit || agent.source.version !== provenance.version,
        conflicts: entries
          .filter(row => row.conflict)
          .map(({ key, base, local, upstream }) => ({
            key,
            base: key.startsWith('mcp:') ? redactMcpConfig(base) : base,
            local: key.startsWith('mcp:') ? redactMcpConfig(local) : local,
            upstream: key.startsWith('mcp:') ? redactMcpConfig(upstream) : upstream
          })),
        version: provenance.version,
        lockCommit: provenance.lockCommit
      }
    })
  }

  cancel(input: unknown): Promise<{ cancelled: true }> {
    const { token } = syncToken.parse(input)
    return this.serialize(async () => {
      this.plans.delete(token)
      return { cancelled: true }
    })
  }

  commit(input: unknown, signal?: AbortSignal) {
    const { token, resolutions } = syncCommit.parse(input)
    return this.serialize(async () => {
      const plan = this.plans.get(token)
      if (!plan) throw Error('AGENT_SOURCE_PREVIEW_EXPIRED')
      const current = (await this.agents.list()).find(row => row.id === plan.agent.id && !row.deletedAt)
      if (!current || current.revision !== plan.agent.revision || current.enabled !== plan.agent.enabled) throw Error('AGENT_SOURCE_PREVIEW_STALE')
      const currentAssociations = (await this.agents.mcp?.list(current.id)) ?? []
      for (const reference of current.source?.mcpReferences ?? []) {
        const row = plan.entries.find(row => row.key === `mcp:${reference.serverKey}`)
        const association = currentAssociations.find(row => row.connectionId === reference.connectionId)
        const local = association ? { name: association.name, config: (await this.agents.mcp!.sourceConfig(reference.connectionId)).local, enabled: association.enabled } : null
        if (!same(row?.local, local)) throw Error('AGENT_SOURCE_PREVIEW_STALE')
      }
      await this.assertSourceSnapshot(plan.source, plan.snapshot, signal)
      if (
        plan.entries.every(row => !row.upstreamChanged) &&
        current.source?.lockCommit === plan.source.lockCommit &&
        current.source?.version === plan.source.version &&
        Object.keys(resolutions).length === 0
      ) {
        this.plans.delete(token)
        return current
      }
      const resolved = new Map(
        plan.entries.map(row => [
          row.key,
          resolveSourceEntry(row, resolutions[row.key], value => (row.key.startsWith('mcp:') ? restoreRedactedConfig(value, row.local ?? row.base) : value))
        ])
      )
      let skills = agentSkills.parse([...resolved].filter(([key, value]) => key.startsWith('skill:') && value !== null).map(([, value]) => value))
      for (const skill of skills) {
        const row = plan.entries.find(row => row.key === `skill:${skill.name}`)
        if (
          skill.directory &&
          ![row?.base, row?.local, row?.upstream].some(
            value => value !== null && value !== undefined && same(z.object({ directory: z.unknown().optional() }).parse(value).directory, skill.directory)
          )
        )
          throw Error('SKILL_DIRECTORY_OWNER_MISMATCH')
      }
      skills = skills.map(skill => {
        const local = current.skills.find(row => row.name === skill.name)
        return !skill.directory && local?.directory ? { ...skill, directory: local.directory } : skill
      })
      await this.agents.directories.preserveWork(current.skills, skills)
      skills = await this.agents.directories.migrate(skills, current.skills)
      const references: NonNullable<AgentSourceBaseline['mcpReferences']> = []
      const oldReferences = current.source?.mcpReferences ?? []
      const oldIds = oldReferences.filter(row => !row.removed).map(row => row.connectionId)
      try {
        for (const row of plan.entries.filter(row => row.key.startsWith('mcp:'))) {
          signal?.throwIfAborted()
          const serverKey = row.key.slice(4)
          const value = resolved.get(row.key)
          const removed = value === null
          if (removed && row.upstream === null) continue
          const selected = z
            .object({ name: z.string().trim().min(1).max(160), config: z.unknown(), enabled: z.boolean() })
            .strict()
            .parse(removed ? row.upstream : value)
          const previous = oldReferences.find(row => row.serverKey === serverKey)
          if (previous && same(value, row.local) && same(row.upstream, row.base)) {
            references.push({ ...previous, removed, baseMissing: row.upstream === null })
            continue
          }
          if (!this.agents.mcp) throw Error('AGENT_SOURCE_MCP_UNAVAILABLE')
          // Keep original upstream in the direct definition and user edits in its
          // existing override layer. Only changed connections get a new identity.
          const stagedKey = JSON.stringify([serverKey, value])
          let connection = plan.staged.get(stagedKey)
          if (!connection) {
            const serverId = `sync-${randomUUID().slice(0, 8)}-${serverKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`.slice(0, 64)
            const upstream = row.upstream === null ? selected : z.object({ config: z.unknown() }).parse(row.upstream)
            const imported = await this.agents.mcp.importSource({
              agentId: current.id,
              serverId,
              name: selected.name,
              staged: true,
              config: upstream.config,
              source: { sourceId: plan.source.sourceId, suiteId: plan.source.suiteId, serverKey, root: plan.root }
            })
            connection = { connectionId: imported.connectionId, serverId }
            if (!same(selected.config, upstream.config)) await this.agents.mcp.save({ agentId: current.id, ...connection, name: selected.name, config: selected.config })
            if (!selected.enabled) await this.agents.mcp.setEnabled({ agentId: current.id, connectionId: connection.connectionId, enabled: false })
            plan.staged.set(stagedKey, connection)
          }
          references.push({ serverKey, ...connection, ...(removed ? { removed: true } : {}), ...(row.upstream === null ? { baseMissing: true } : {}) })
        }
        signal?.throwIfAborted()
        await this.assertSourceSnapshot(plan.source, plan.snapshot, signal)
        // Persist membership first; revision-specific declarations keep old live
        // Sessions on their old connections while candidate publication settles.
        await this.agents.mcp?.sourceRevision(
          current.id,
          references.filter(row => !row.removed).map(row => row.connectionId)
        )
        const agent = await this.agents.syncSource(
          current.id,
          current.revision,
          { ...current, name: resolved.get('name'), description: resolved.get('description'), prompt: resolved.get('prompt'), skills },
          { ...plan.source, mcpReferences: references },
          signal
        )
        this.plans.delete(token)
        return agent
      } catch (error) {
        await this.agents.mcp?.sourceRevision(current.id, oldIds)
        throw error
      }
    })
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    this.pending = result.catch(() => {})
    return result
  }

  private async captureSource(source: AgentSourceBaseline, signal?: AbortSignal): Promise<SourceSnapshot> {
    signal?.throwIfAborted()
    const snapshot = await this.catalog.readSourceSnapshot(source.sourceId, source.suiteId)
    const candidate = (await this.discover(snapshot.suite)).find(row => row.resourceKey === source.resourceKey)
    if (!candidate?.base) throw Error(candidate?.error ?? 'AGENT_SOURCE_CONFIGURATION_NOT_FOUND')
    const skillContents: Awaited<ReturnType<typeof skillDirectoryFiles>>[] = []
    for (const skill of snapshot.suite.skills) {
      signal?.throwIfAborted()
      const errors: string[] = []
      const file = await componentPath(snapshot.suite.root, skill.file, errors)
      if (!file) throw Error(errors.join('; '))
      skillContents.push(await skillDirectoryFiles(dirname(file)))
    }
    signal?.throwIfAborted()
    return { ...snapshot, base: candidate.base, skillContents }
  }

  private async assertSourceSnapshot(source: AgentSourceBaseline, expected: SourceSnapshot, signal?: AbortSignal): Promise<void> {
    try {
      if (!same(await this.captureSource(source, signal), expected)) throw Error('AGENT_SOURCE_PREVIEW_STALE')
    } catch {
      signal?.throwIfAborted()
      throw Error('AGENT_SOURCE_PREVIEW_STALE')
    }
  }

  private async sourceSkills(suite: Suite, signal?: AbortSignal): Promise<UserAgentSkill[]> {
    if (!suite.skills.length) return []
    const card = (await this.catalog.overview()).suites.find(row => row.sourceId === suite.sourceId && row.suiteId === suite.id)!
    if (card.installed && (!card.enabled || card.surfaceToggles?.skills === false)) throw Error('AGENT_SOURCE_SKILLS_DISABLED')
    if (!card.installed)
      await this.catalog.install(suite.sourceId, suite.id, {
        surfaces: { skills: true, mcp: false, hooks: false, commands: false, agents: false, lsp: false },
        configurationOnly: true
      })
    const available = await this.agents.skillCatalog()
    const skills: UserAgentSkill[] = []
    for (const skill of suite.skills) {
      signal?.throwIfAborted()
      const found = available.find(row => row.name === skill.name && row.provider === 'agent-plugin' && row.path === skill.file)
      if (!found) throw Error(`AGENT_SOURCE_SKILL_UNAVAILABLE: ${skill.name}`)
      skills.push({
        kind: 'reference',
        name: found.name,
        provider: found.provider,
        path: found.path,
        enabled: true,
        content: (await this.agents.readSkill(found.name, found.provider, undefined, signal, found.path)).content
      })
    }
    return this.agents.directories.migrate(skills, [], suite.root)
  }

  private async discover(suite: Suite): Promise<Discovered[]> {
    if (suite.remote)
      return [
        { suiteId: suite.id, resourceKey: 'suite', name: suite.manifest.name, description: suite.manifest.description ?? '', error: 'AGENT_SOURCE_REMOTE_REQUIRES_OWN_SOURCE' }
      ]
    const common = { suiteId: suite.id, name: suite.manifest.name, description: suite.manifest.description ?? '' }
    if (suite.errors.length) return [{ ...common, resourceKey: 'suite', error: suite.errors.join('; ') }]
    const result: Discovered[] = []
    const unsupported = suite.surfaces.hooks || suite.surfaces.commands || suite.surfaces.lsp ? 'AGENT_SOURCE_UNSUPPORTED_COMPONENTS' : undefined
    if (suite.systemPrompt?.trim())
      result.push({ ...common, resourceKey: 'suite', base: { name: common.name, description: common.description, prompt: suite.systemPrompt, skills: [] } })
    const resources = suite.resources?.agents ?? (await defaultMarkdownResources(suite.root, 'agents'))
    for (const resource of resources) {
      const entry = { ...common, resourceKey: `agent:${resource.name}`, name: resource.name }
      try {
        const errors: string[] = []
        // Recheck containment on each import; discovery may precede local filesystem edits.
        if (!(await componentPath(suite.root, resource.file, errors))) throw Error(errors.join('; '))
        const role = parseAgentRole(await resourceText(resource))
        if (role.model || role.provider || role.reasoningEffort || role.tools || role.disallowedTools) throw Error('AGENT_SOURCE_ROLE_RESTRICTIONS_REQUIRE_MANUAL_CONFIGURATION')
        if (role.disabled) throw Error('AGENT_SOURCE_ROLE_DISABLED')
        if (!role.content.trim()) throw Error('AGENT_SOURCE_PROMPT_EMPTY')
        const base = { name: role.title ?? resource.name, description: role.description ?? common.description, prompt: role.content.trim(), skills: [] }
        result.push({ ...entry, name: base.name, description: base.description, base })
      } catch (error) {
        result.push({ ...entry, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return unsupported ? result.map(entry => ({ ...entry, base: undefined, error: unsupported })) : result
  }
}
