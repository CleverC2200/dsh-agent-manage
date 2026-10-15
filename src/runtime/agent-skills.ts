import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { UserAgentSkill } from '../contracts/user-agents.js'

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

/** Capture only the selected body; references and scripts keep their source directory. */
export async function captureAgentSkills(ctx: Pick<Context, 'skills'>, skills: UserAgentSkill[]): Promise<UserAgentSkill[]> {
  return Promise.all(
    skills.map(async skill => {
      if (skill.kind !== 'reference' || !skill.enabled) return skill
      const source = await ctx.skills.get(skill.name)
      if (!source || source.provider !== skill.provider || (skill.path !== undefined && source.path !== skill.path)) throw Error(`AGENT_SKILL_SOURCE_MISSING: ${skill.name}`)
      return { ...skill, content: skill.content ?? source.content }
    })
  )
}
