import { officialStandardDocument } from './core-preset-harness.js'
import { expect, it } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SkillProvider, SkillProviderControl, SkillLookupOptions } from '@deepseek-ai/dsh-skill'
import { BusinessResources } from '../src/runtime/business-resources.js'

type NativeHost = ConstructorParameters<typeof BusinessResources>[0]
type Preset = Parameters<NativeHost['agentPresets']['register']>[0]
it('selects the received MPS persona and Skill, then withdraws only its installed resource contribution', async () => {
  const index = await mkdtemp(join(tmpdir(), 'mps-reception-'))
  const root = resolve('business-resources/inventory-mps')
  let provider: SkillProvider
  const presets = new Map<string, Preset>()
  const host = {
    skills: {
      registerProvider(create: (control: SkillProviderControl) => SkillProvider) {
        provider = create({ invalidate() {}, signal: new AbortController().signal })
        return () => {}
      },
      async list(options: SkillLookupOptions) {
        return provider.list(options)
      }
    },
    agentPresets: {
      readDocument: officialStandardDocument,
      async register(preset: Preset) {
        presets.set(preset.id, preset)
        return async () => {
          presets.delete(preset.id)
        }
      },
      async resolve(id: string) {
        return { id }
      }
    }
  }
  const resources = new BusinessResources(host as unknown as NativeHost, join(index, 'selected.json'))
  try {
    const otherRoot = resolve('business-resources/inventory-orderworkbench')
    const otherProfile = JSON.parse(await readFile(join(otherRoot, 'prompt.json'), 'utf8'))
    await resources.register([
      {
        id: 'gea-html-inventory-orderworkbench',
        label: otherProfile.label,
        root: otherRoot,
        prompt: 'prompt.json',
        profile: otherProfile,
        skillFiles: { 'inventory-orderworkbench': 'skills/orderworkbench/SKILL.md' }
      }
    ])
    const profile = JSON.parse(await readFile(join(root, 'prompt.json'), 'utf8'))
    const withdraw = await resources.register([
      { id: 'gea-html-inventory-mps', label: profile.label, root, prompt: 'prompt.json', profile, skillFiles: { 'inventory-mps': 'skills/inventory-mps/SKILL.md' } }
    ])
    const selected = await resources.select('gea-html-inventory-mps', new AbortController().signal)
    expect(selected.profile?.consumerCode).toBe('mps-prototype')
    expect((presets.get(selected.preset)!.plugins[0].config as { prefix: string }).prefix).toContain(
      '所有页面数据、调整、保存、提交、结转和导出均为模拟。只解释当前页面的模拟上下文，不宣称真实计划已写入。切页或引用失效后重新读取，不操作旧页。正式计划仍以月计划编制流程为准。'
    )
    const candidate = (await provider.list({})).find(row => row.name === 'inventory-mps')
    if (!candidate) throw Error('MPS Skill missing')
    expect(candidate.path).toBe(join(root, 'skills/inventory-mps/SKILL.md'))
    expect((await provider.get(candidate, {})).content).toContain('上下文只覆盖当前挂载步骤')
    expect((await provider.get(candidate, {})).content).toContain('未发送文字')
    await withdraw()
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect((await resources.list()).map(row => row.id)).toEqual(['gea-html-inventory-orderworkbench', 'skill:inventory-orderworkbench'])
    expect((await provider.list({})).map(row => row.name)).toEqual(['inventory-orderworkbench'])
    expect(presets.has('gea-html-inventory-mps')).toBe(false)
    expect(await readFile(join(root, 'prompt.json'), 'utf8')).toContain('主生产计划Agent')
  } finally {
    await resources.dispose()
    await rm(index, { recursive: true, force: true })
  }
})
