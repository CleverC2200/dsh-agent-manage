import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBusinessResources } from '../src/runtime/business-resources.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'stock-resource-'))
  roots.push(root)
  await mkdir(join(root, 'skills'))
  await writeFile(join(root, 'skills/SKILL.md'), '---\nname: inventory-fc\ndescription: 库存规则\n---\n缺失不按零处理\n')
  await writeFile(join(root, 'prompt.json'), JSON.stringify({ consumerCode: 'branch-inventory', persona: '分仓分析', skills: ['inventory-fc'] }))
  const input = { id: 'inventory-fc', consumerCode: 'branch-inventory', skill: 'skills/SKILL.md', prompt: 'prompt.json' }
  return { root, input }
}
describe('Agent-owned workbench resources', () => {
  it('loads the assembled Skill and persona with their file sources', async () => {
    const { root, input } = await fixture()
    const result = await loadBusinessResources(root, input)
    expect(result.skill).toContain('缺失不按零处理')
    expect(result.profile.persona).toBe('分仓分析')
    expect(result.source.provider).toBe('dsh-agent-manage')
    expect(await readFile(result.source.skillPath, 'utf8')).toBe(result.skill)
  })
  it('refuses a different Consumer or cross-Consumer permission', async () => {
    const { root, input } = await fixture()
    await expect(loadBusinessResources(root, { ...input, consumerCode: 'other' })).rejects.toThrow('INVALID_AGENT_RESOURCE_IDENTITY')
    await writeFile(join(root, 'prompt.json'), JSON.stringify({ consumerCode: 'branch-inventory', persona: '分仓分析', skills: ['inventory-fc'], crossConsumers: ['other'] }))
    await expect(loadBusinessResources(root, input)).rejects.toThrow('INVALID_AGENT_RESOURCE_IDENTITY')
  })
  it('refuses resource paths escaping through a symlink', async () => {
    const { root, input } = await fixture()
    const external = await fixture()
    await symlink(join(external.root, 'skills/SKILL.md'), join(root, 'outside.md'))
    await expect(loadBusinessResources(root, { ...input, skill: 'outside.md' })).rejects.toThrow('INVALID_AGENT_RESOURCE_PATH')
  })
})
