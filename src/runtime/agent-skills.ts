import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { UserAgentSkill } from '../contracts/user-agents.js'

const snapshot = z.object({ root: z.string().min(1), bundle: z.string().min(1), entry: z.string() }).strict()
const directory = snapshot.extend({ id: z.uuid(), previous: snapshot.optional() }).strict()

export const agentSkills = z
  .array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('reference'),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        provider: z.string().min(1),
        path: z.string().optional(),
        enabled: z.boolean(),
        content: z.string().trim().min(1).max(96000).optional(),
        directory: directory.optional()
      }),
      z.object({
        kind: z.literal('personal'),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().trim().min(1).max(1000),
        content: z.string().trim().min(1).max(96000),
        enabled: z.boolean(),
        directory: directory.optional()
      })
    ])
  )
  .max(200)
  .refine(skills => new Set(skills.map(skill => skill.name)).size === skills.length, 'DUPLICATE_AGENT_SKILL')

export async function captureAgentSkills(ctx: Pick<Context, 'skills'>, skills: UserAgentSkill[]): Promise<UserAgentSkill[]> {
  return Promise.all(
    skills.map(async skill => {
      if (skill.directory || skill.kind !== 'reference' || !skill.enabled) return skill
      const source = await ctx.skills.get(skill.name)
      if (!source || source.provider !== skill.provider || (skill.path !== undefined && source.path !== skill.path)) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${skill.name}`)
      return { ...skill, content: skill.content ?? source.content }
    })
  )
}

export function ownedSkillEdits(incoming: UserAgentSkill[], previous: UserAgentSkill[]): UserAgentSkill[] {
  return incoming.map(skill => {
    const old = previous.find(row => row.name === skill.name)
    if (skill.directory && !isDeepStrictEqual(skill.directory, old?.directory))
      throw Error(skill.directory.id === old?.directory?.id ? 'SKILL_EDIT_CONFLICT' : 'SKILL_DIRECTORY_OWNER_MISMATCH')
    if (!skill.directory && old?.directory) {
      if (skill.kind === 'reference' && skill.content === undefined) return skill
      if (old.content !== skill.content || (old.kind === 'personal' && skill.kind === 'personal' && old.description !== skill.description))
        throw Error('SKILL_EDIT_BASELINE_REQUIRED')
      return { ...skill, directory: old.directory }
    }
    return skill
  })
}
