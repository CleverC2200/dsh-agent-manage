import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import type { UserAgentSkill } from '../contracts/user-agents.js'

export const inject = ['skills']
export function apply(ctx: Context, config: { skills: UserAgentSkill[]; inheritSkills?: boolean }): void {
  const provider = 'user-agent-skills'
  const selected = new Map(config.skills.map(skill => [skill.name, skill]))
  ctx.skills.registerProvider(control => {
    const directories = config.skills
      .filter(skill => skill.directory)
      .map(
        skill =>
          new FileSystemSkillProvider(ctx, control, {
            providerName: `directory-${skill.directory!.id}`,
            includeDefaultRoots: false,
            customSkillDirs: [skill.directory!.root],
            watch: false
          })
      )
    return {
      name: provider,
      async list(options) {
        // Explicitly read the global source layer, never recursively read this preset scope.
        const sources = await ctx.skills.list({ cwd: options.cwd, signal: options.signal })
        let complete = true
        const candidates: SkillCandidate[] = sources.map(source => {
          const choice = selected.get(source.name)
          const enabled =
            (!choice && config.inheritSkills && source.provider !== 'business-resource') ||
            (!choice?.directory &&
              choice?.enabled === true &&
              choice.kind === 'reference' &&
              choice.provider === source.provider &&
              (choice.path === undefined || source.path === choice.path))
          return { ...source, provider, rank: -1000, locator: source.name, invocation: enabled ? source.invocation : { modelInvocable: false, userInvocable: false } }
        })
        for (const choice of config.skills) {
          if (choice.directory) {
            if (!choice.enabled) continue
            try {
              if (
                choice.kind === 'reference' &&
                !sources.some(source => source.name === choice.name && source.provider === choice.provider && (choice.path === undefined || source.path === choice.path))
              )
                throw Error(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
              const directory = directories.find(row => row.name === `directory-${choice.directory!.id}`)!
              const listed = await directory.list(options)
              if (!Array.isArray(listed) && !listed.complete) complete = false
              const entries = Array.isArray(listed) ? listed : listed.candidates
              const entryFile = await realpath(join(choice.directory.bundle, 'tree', choice.directory.entry, 'SKILL.md'))
              const entry = entries.find(row => row.name === choice.name && row.path === entryFile)
              if (!entry) throw Error(`AGENT_SKILL_DIRECTORY_INVALID: ${choice.name}`)
              const index = candidates.findIndex(row => row.name === choice.name)
              if (index >= 0) candidates.splice(index, 1)
              candidates.push({ ...entry, provider, rank: -1000 })
            } catch (error) {
              options.signal?.throwIfAborted()
              control.signal.throwIfAborted()
              complete = false
              ctx.logger.warn(`AGENT_SKILL_DIRECTORY_INVALID: ${choice.name}`, error)
            }
            continue
          }
          if (choice.kind === 'reference') {
            if (
              choice.enabled &&
              !sources.some(source => source.name === choice.name && source.provider === choice.provider && (choice.path === undefined || source.path === choice.path))
            ) {
              complete = false
              ctx.logger.warn(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
            }
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
        return { candidates, complete }
      },
      async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
        const choice = selected.get(candidate.name)
        if (!choice && config.inheritSkills && (candidate.invocation.modelInvocable || candidate.invocation.userInvocable)) {
          const source = await ctx.skills.get(candidate.name, { cwd: options.cwd, signal: options.signal })
          if (source && source.provider !== 'business-resource') return { ...source, provider }
        }
        if (!choice?.enabled) return { ...candidate, content: '' }
        if (choice.directory) {
          if (choice.kind === 'reference') {
            const source = await ctx.skills.get(choice.name, { cwd: options.cwd, signal: options.signal })
            if (!source || source.provider !== choice.provider || (choice.path !== undefined && source.path !== choice.path))
              throw Error(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
          }
          const directory = directories.find(row => row.name === `directory-${choice.directory!.id}`)!
          const loaded = await directory.get(candidate, options)
          return loaded && { ...loaded, provider, invocation: candidate.invocation }
        }
        if (choice.kind === 'personal') throw Error(`AGENT_SKILL_DIRECTORY_REQUIRED: ${choice.name}`)
        const source = await ctx.skills.get(choice.name, { cwd: options.cwd, signal: options.signal })
        if (!source || source.provider !== choice.provider || (choice.path !== undefined && source.path !== choice.path)) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${choice.name}`)
        return { ...source, provider, invocation: candidate.invocation, content: source.content }
      }
    }
  })
}
