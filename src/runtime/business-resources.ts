/** Agent-owned loading for workbench resources assembled with split declarations. */
import { readFile, realpath, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { parseSkillFrontmatter } from '../catalog/skills-parse.js'

const mountedResources = new Set<string>()

/** Read only files contained in the assembled resource, including after symlink resolution. */
async function resourceFile(directory: string, reference: unknown): Promise<string> {
  if (typeof reference !== 'string' || !reference) throw new Error('INVALID_AGENT_RESOURCE_REFERENCE')
  const root = await realpath(directory)
  const path = await realpath(resolve(root, reference))
  if (!path.startsWith(root + sep)) throw new Error('INVALID_AGENT_RESOURCE_PATH')
  return path
}

/** Load Skill and persona after GEA has validated the existing capability declaration. */
export async function loadBusinessResources(directory: string, input: { id: string; consumerCode: string; skill: string; prompt: string }) {
  const skillPath = await resourceFile(directory, input.skill)
  const promptPath = await resourceFile(directory, input.prompt)
  const skill = await readFile(skillPath, 'utf8')
  const prompt = JSON.parse(await readFile(promptPath, 'utf8'))
  const parsedSkill = parseSkillFrontmatter(skill, input.id)
  if (
    !/^[a-z][a-z0-9-]*$/.test(input.id) ||
    typeof parsedSkill === 'string' ||
    prompt.consumerCode !== input.consumerCode ||
    typeof prompt.persona !== 'string' ||
    !prompt.persona.trim() ||
    !Array.isArray(prompt.skills) ||
    prompt.skills.length !== 1 ||
    prompt.skills[0] !== input.id ||
    prompt.crossConsumers !== undefined ||
    (prompt.pageAgents !== undefined &&
      (!Array.isArray(prompt.pageAgents) ||
        prompt.pageAgents.length < 1 ||
        prompt.pageAgents.length > 4 ||
        new Set(prompt.pageAgents).size !== prompt.pageAgents.length ||
        !prompt.pageAgents.includes(`gea-html-${input.id}`) ||
        prompt.pageAgents.some((id: unknown) => typeof id !== 'string' || !/^gea-html-inventory-[a-z]+$/.test(id))))
  ) {
    throw new Error('INVALID_AGENT_RESOURCE_IDENTITY')
  }
  return {
    skill,
    profile: { label: prompt.label ?? input.id, consumerCode: input.consumerCode, persona: prompt.persona, skills: [input.id] },
    pageAgents: prompt.pageAgents ?? [`gea-html-${input.id}`],
    source: { provider: 'dsh-agent-manage', skillPath, promptPath },
    /** Publish through the existing native Skill filesystem roots, scoped to this plugin effect. */
    async mount(ctx: Pick<Context, 'effect'>, home: string): Promise<void> {
      const key = resolve(await realpath(home), input.id)
      if (mountedResources.has(key)) throw new Error('AGENT_RESOURCE_ALREADY_MOUNTED')
      mountedResources.add(key)
      const files: Array<{ file: string; previous?: string }> = []
      let closed = false
      const dispose = async () => {
        if (closed) return
        for (const { file, previous } of files) {
          // Preserve edits made after this publication.
          if ((await readFile(file, 'utf8').catch(() => undefined)) !== skill) continue
          if (previous === undefined) await rm(file, { force: true })
          else await writeFile(file, previous, { mode: 0o600 })
        }
        closed = true
        mountedResources.delete(key)
      }
      try {
        for (const area of ['skills', 'gea-business-skills']) {
          const target = resolve(home, area, input.id)
          await mkdir(target, { recursive: true })
          const file = resolve(target, 'SKILL.md')
          let previous: string | undefined
          try {
            previous = await readFile(file, 'utf8')
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          files.push({ file, previous })
          await writeFile(file, skill, { mode: 0o600 })
        }
        ctx.effect(() => dispose)
      } catch (error) {
        await dispose()
        throw error
      }
    }
  }
}
