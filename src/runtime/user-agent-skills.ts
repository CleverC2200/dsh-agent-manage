import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import type { UserAgentSkill } from '../contracts/user-agents.js'

export const inject = ['skills']
/** Mounted by the official preset Loader, so every contribution belongs to its revision scope.
 * Provider references are resolved afresh; overrides never modify their source files.
 */
export function apply(ctx: Context, config: { skills: UserAgentSkill[] }): void {
  const provider = 'user-agent-skills'
  const selected = new Map(config.skills.map(skill => [skill.name, skill]))
  ctx.skills.registerProvider(() => ({
    name: provider,
    async list(options) {
      // Explicitly read the global source layer, never recursively read this preset scope.
      const sources = await ctx.skills.list({ cwd: options.cwd, signal: options.signal })
      const candidates: SkillCandidate[] = sources.map(source => {
        const choice = selected.get(source.name)
        const enabled = choice?.enabled === true && choice.kind === 'reference' && choice.provider === source.provider && (choice.path === undefined || source.path === choice.path)
        return { ...source, provider, rank: -1000, locator: source.name, invocation: enabled ? source.invocation : { modelInvocable: false, userInvocable: false } }
      })
      for (const choice of config.skills) {
        if (choice.kind === 'reference') {
          if (
            choice.enabled &&
            !sources.some(source => source.name === choice.name && source.provider === choice.provider && (choice.path === undefined || source.path === choice.path))
          )
            throw Error(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
          continue
        }
        const existing = candidates.findIndex(skill => skill.name === choice.name)
        if (existing >= 0) candidates.splice(existing, 1)
        candidates.push({
          name: choice.name,
          description: choice.description,
          source: 'custom',
          provider,
          rank: -1000,
          locator: choice.name,
          invocation: { modelInvocable: choice.enabled, userInvocable: choice.enabled }
        })
      }
      return candidates
    },
    async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
      const choice = selected.get(candidate.name)
      if (!choice?.enabled) return { ...candidate, content: '' }
      if (choice.kind === 'personal') return { ...candidate, content: choice.content }
      const source = await ctx.skills.get(choice.name, { cwd: options.cwd, signal: options.signal })
      if (!source || source.provider !== choice.provider || (choice.path !== undefined && source.path !== choice.path)) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
      return { ...source, provider, invocation: candidate.invocation, content: choice.content ?? source.content }
    }
  }))
}
