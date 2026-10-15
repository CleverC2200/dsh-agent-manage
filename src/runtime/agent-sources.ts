import { z } from 'zod'
import type { Catalog } from '../application/catalog.js'
import { componentPath, defaultMarkdownResources, resourceText } from '../catalog/component-files.js'
import { canonicalGitUrl } from '../catalog/scan-resolvers.js'
import { expandHome } from '../catalog/paths.js'
import type { AgentSourceBaseline, AgentSourceCandidate, AgentSourceView } from '../contracts/agent-sources.js'
import type { UserAgentSkill } from '../contracts/user-agents.js'
import { resolveSourceKind, type Suite } from '../model/types.js'
import { parseAgentRole } from './agent-role-router.js'
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

/** Source acquisition/discovery uses Catalog; editable snapshots and publication belong to UserAgents. */
export class AgentSources {
  private pending: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly catalog: Catalog,
    private readonly agents: UserAgents
  ) {}

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
      const source = existing ?? (await this.catalog.addSource(value))
      signal?.throwIfAborted()
      return (await this.list()).find(row => row.id === source.id)!
    })
    this.pending = result.catch(() => {})
    return result
  }

  async import(input: unknown, signal?: AbortSignal) {
    const value = selection.parse(input)
    signal?.throwIfAborted()
    const existing = (await this.agents.list()).find(
      agent => agent.source?.sourceId === value.sourceId && agent.source?.suiteId === value.suiteId && agent.source?.resourceKey === value.resourceKey
    )
    if (existing) return existing
    const source = (await this.list()).find(row => row.id === value.sourceId)
    if (!source) throw Error('AGENT_SOURCE_NOT_FOUND')
    const suite = (await this.catalog.readUserCatalog()).suites.find(row => row.sourceId === source.id && row.id === value.suiteId)
    if (!suite) throw Error('AGENT_SOURCE_SUITE_NOT_FOUND')
    const candidate = (await this.discover(suite)).find(row => row.resourceKey === value.resourceKey)
    if (!candidate?.base) throw Error(candidate?.error ?? 'AGENT_SOURCE_CONFIGURATION_NOT_FOUND')
    const skills: UserAgentSkill[] = []
    if (suite.skills.length) {
      const card = (await this.catalog.overview()).suites.find(row => row.sourceId === suite.sourceId && row.suiteId === suite.id)!
      if (card.installed && (!card.enabled || card.surfaceToggles?.skills === false)) throw Error('AGENT_SOURCE_SKILLS_DISABLED')
      if (!card.installed)
        await this.catalog.install(suite.sourceId, suite.id, {
          surfaces: { skills: true, mcp: false, hooks: false, commands: false, agents: false, lsp: false },
          configurationOnly: true
        })
      const available = await this.agents.skillCatalog()
      for (const skill of suite.skills) {
        const reference = available.find(row => row.name === skill.name && row.provider === 'agent-plugin' && row.path === skill.file)
        if (!reference) throw Error(`AGENT_SOURCE_SKILL_UNAVAILABLE: ${skill.name}`)
        skills.push({ kind: 'reference', name: reference.name, provider: reference.provider, path: reference.path, enabled: true })
      }
    }
    const base = { ...candidate.base, skills }
    signal?.throwIfAborted()
    return this.agents.importSource(
      { ...base, enabled: true },
      {
        sourceId: source.id,
        suiteId: suite.id,
        resourceKey: candidate.resourceKey,
        url: source.url,
        kind: source.kind,
        ...(source.lockCommit ? { lockCommit: source.lockCommit } : {}),
        ...(suite.manifest.version ? { version: suite.manifest.version } : {}),
        base
      }
    )
  }

  private async discover(suite: Suite): Promise<Discovered[]> {
    if (suite.remote)
      return [
        { suiteId: suite.id, resourceKey: 'suite', name: suite.manifest.name, description: suite.manifest.description ?? '', error: 'AGENT_SOURCE_REMOTE_REQUIRES_OWN_SOURCE' }
      ]
    const common = { suiteId: suite.id, name: suite.manifest.name, description: suite.manifest.description ?? '' }
    if (suite.errors.length) return [{ ...common, resourceKey: 'suite', error: suite.errors.join('; ') }]
    const result: Discovered[] = []
    const unsupported = suite.surfaces.mcp
      ? 'AGENT_SOURCE_MEMBERS_REQUIRE_IMPORT_SUPPORT'
      : suite.surfaces.hooks || suite.surfaces.commands || suite.surfaces.lsp
        ? 'AGENT_SOURCE_UNSUPPORTED_COMPONENTS'
        : undefined
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
